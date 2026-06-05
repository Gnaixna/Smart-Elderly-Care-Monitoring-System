// @title 我的
import { useState, useCallback, useEffect } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { withRouteGuard } from '@/components/RouteGuard'
import { useAuth } from '@/contexts/AuthContext'
import { getUserProfile, updateUserThresholds, aliyunSetDeviceProperty, saveDeviceIotConfig, testAliyunDeviceConnection, getDevice } from '@/db/api'
import { DEFAULT_THRESHOLDS } from '@/db/types'

interface ThresholdForm {
  heart_rate_max: string
  heart_rate_min: string
  blood_oxygen_min: string
  temperature_max: string
  temperature_min: string
}

type ConnectStatus = 'idle' | 'testing' | 'connected' | 'failed'

function ProfilePage() {
  const { user, signOut, refreshProfile } = useAuth()
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [thresholds, setThresholds] = useState<ThresholdForm>({
    heart_rate_max: String(DEFAULT_THRESHOLDS.heart_rate_max),
    heart_rate_min: String(DEFAULT_THRESHOLDS.heart_rate_min),
    blood_oxygen_min: String(DEFAULT_THRESHOLDS.blood_oxygen_min),
    temperature_max: String(DEFAULT_THRESHOLDS.temperature_max),
    temperature_min: String(DEFAULT_THRESHOLDS.temperature_min),
  })

  // 设备连接状态
  const [productKey, setProductKey] = useState('')
  const [deviceNameIot, setDeviceNameIot] = useState('')
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>('idle')
  const [deviceOnline, setDeviceOnline] = useState<boolean | null>(null)
  const [connectErrMsg, setConnectErrMsg] = useState('')

  const loadProfile = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [data, deviceData] = await Promise.all([getUserProfile(user.id), getDevice()])
    setProfile(data)
    if (data) {
      setThresholds({
        heart_rate_max: String(data.heart_rate_max ?? DEFAULT_THRESHOLDS.heart_rate_max),
        heart_rate_min: String(data.heart_rate_min ?? DEFAULT_THRESHOLDS.heart_rate_min),
        blood_oxygen_min: String(data.blood_oxygen_min ?? DEFAULT_THRESHOLDS.blood_oxygen_min),
        temperature_max: String(data.temperature_max ?? DEFAULT_THRESHOLDS.temperature_max),
        temperature_min: String(data.temperature_min ?? DEFAULT_THRESHOLDS.temperature_min),
      })
    }
    // 加载已保存的设备连接配置
    if (deviceData) {
      if (deviceData.product_key) setProductKey(deviceData.product_key)
      if (deviceData.device_name_iot) setDeviceNameIot(deviceData.device_name_iot)
      if (deviceData.connect_status === 'connected') {
        setConnectStatus('connected')
        setDeviceOnline(deviceData.is_online ?? null)
      } else if (deviceData.connect_status === 'failed') {
        setConnectStatus('failed')
      }
    }
    setLoading(false)
  }, [user])

  useEffect(() => { loadProfile() }, [loadProfile])
  useDidShow(() => { loadProfile() })

  // 测试并保存设备连接
  const handleTestConnect = useCallback(async () => {
    if (!productKey.trim() || !deviceNameIot.trim()) {
      Taro.showToast({ title: '请填写 ProductKey 和设备名称', icon: 'none' })
      return
    }
    setConnectStatus('testing')
    setConnectErrMsg('')
    const result = await testAliyunDeviceConnection(productKey.trim(), deviceNameIot.trim())
    if (result.success) {
      setConnectStatus('connected')
      setDeviceOnline(result.online ?? false)
      await saveDeviceIotConfig({
        product_key: productKey.trim(),
        device_name_iot: deviceNameIot.trim(),
        connect_status: 'connected',
        is_online: result.online ?? false,
      })
      Taro.showToast({ title: result.online ? '设备在线，连接成功' : '连接成功（设备离线）', icon: 'success' })
    } else {
      setConnectStatus('failed')
      setConnectErrMsg(result.error || '连接失败')
      await saveDeviceIotConfig({
        product_key: productKey.trim(),
        device_name_iot: deviceNameIot.trim(),
        connect_status: 'failed',
      })
      Taro.showToast({ title: '连接失败，请检查配置', icon: 'error' })
    }
  }, [productKey, deviceNameIot])

  const handleSaveThresholds = useCallback(async () => {
    if (!user) return
    const max_hr = parseInt(thresholds.heart_rate_max)
    const min_hr = parseInt(thresholds.heart_rate_min)
    const min_bo = parseInt(thresholds.blood_oxygen_min)
    const max_temp = parseFloat(thresholds.temperature_max)
    const min_temp = parseFloat(thresholds.temperature_min)

    if (isNaN(max_hr) || isNaN(min_hr) || isNaN(min_bo) || isNaN(max_temp) || isNaN(min_temp)) {
      Taro.showToast({ title: '请输入有效数值', icon: 'none' })
      return
    }
    if (max_hr <= min_hr) {
      Taro.showToast({ title: '心率上限须大于下限', icon: 'none' })
      return
    }
    if (max_temp <= min_temp) {
      Taro.showToast({ title: '体温上限须大于下限', icon: 'none' })
      return
    }
    if (min_bo < 80 || min_bo > 100) {
      Taro.showToast({ title: '血氧下限应在80-100之间', icon: 'none' })
      return
    }

    setSaving(true)
    // 1. 保存到 Supabase（主流程，始终执行）
    await updateUserThresholds(user.id, {
      heart_rate_max: max_hr,
      heart_rate_min: min_hr,
      blood_oxygen_min: min_bo,
      temperature_max: max_temp,
      temperature_min: min_temp,
    })
    await refreshProfile()
    setSaving(false)

    // 2. 尝试同步下发到阿里云设备（辅助流程，失败不影响保存结果）
    const iotOpts = productKey && deviceNameIot
      ? { productKey: productKey.trim(), deviceName: deviceNameIot.trim() }
      : undefined

    const iotResult = await aliyunSetDeviceProperty({
      HeartRateMax: max_hr,
      HeartRateMin: min_hr,
      BloodOxygenMin: min_bo,
      TemperatureMax: max_temp,
      TemperatureMin: min_temp,
    }, iotOpts)

    if (iotResult.success) {
      Taro.showToast({ title: '已保存并下发至设备', icon: 'success' })
    } else if (!productKey || !deviceNameIot) {
      // 未配置设备时，只提示保存成功，不报错
      Taro.showToast({ title: '阈值设置已保存', icon: 'success' })
    } else {
      // 配置了设备但下发失败，Supabase 已保存成功
      Taro.showToast({ title: '已保存，设备同步失败', icon: 'none' })
    }
  }, [user, thresholds, refreshProfile])

  const handleSignOut = useCallback(async () => {
    Taro.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      cancelText: '取消',
      confirmColor: '#DC2626',
      success: async (res) => {
        if (res.confirm) {
          // 退出前清除保存的重定向路径，确保下次登录跳转到实时监测页
          Taro.removeStorageSync('loginRedirectPath')
          await signOut()
          Taro.reLaunch({ url: '/pages/login/index' })
        }
      }
    })
  }, [signOut])

  const displayName = profile?.nickname || profile?.username || profile?.phone || user?.email?.split('@')[0] || '用户'
  const displayPhone = profile?.phone || user?.phone || '--'

  return (
    <div className="min-h-screen bg-background">
      {/* 用户信息头部 */}
      <div className="bg-gradient-hero px-5 pt-6 pb-8">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} className="w-full h-full rounded-full" style={{ objectFit: 'cover' }} />
            ) : (
              <div className="i-mdi-account-circle text-white" style={{ fontSize: '56px' }} />
            )}
          </div>
          <div className="flex-1">
            <p className="text-white text-2xl font-bold">{displayName}</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="i-mdi-phone text-white/70" style={{ fontSize: '16px' }} />
              <span className="text-xl text-white/80">{displayPhone}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="i-mdi-shield-account text-white/70" style={{ fontSize: '16px' }} />
              <span className="text-xl text-white/80">{profile?.role === 'admin' ? '管理员' : '家属用户'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* STM32 设备连接配置 */}
        <div className="bg-card rounded-2xl overflow-hidden shadow-card">
          <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            <div className="i-mdi-chip text-primary" style={{ fontSize: '22px' }} />
            <span className="text-2xl font-bold text-foreground">STM32 设备连接</span>
            {/* 连接状态徽标 */}
            {connectStatus === 'connected' && (
              <div className="ml-auto flex items-center gap-1 px-3 py-1 rounded-full" style={{ backgroundColor: '#D1FAE5' }}>
                <div className="w-2 h-2 rounded-full breathe" style={{ backgroundColor: '#10B981' }} />
                <span className="text-xl font-medium" style={{ color: '#065F46' }}>
                  {deviceOnline === true ? '在线' : deviceOnline === false ? '已绑定（离线）' : '已连接'}
                </span>
              </div>
            )}
            {connectStatus === 'failed' && (
              <div className="ml-auto flex items-center gap-1 px-3 py-1 rounded-full" style={{ backgroundColor: '#FEE2E2' }}>
                <div className="i-mdi-alert-circle-outline" style={{ fontSize: '14px', color: '#DC2626' }} />
                <span className="text-xl font-medium" style={{ color: '#991B1B' }}>连接失败</span>
              </div>
            )}
            {connectStatus === 'testing' && (
              <div className="ml-auto flex items-center gap-1 px-3 py-1 rounded-full" style={{ backgroundColor: 'hsl(var(--muted))' }}>
                <div className="i-mdi-loading text-muted-foreground" style={{ fontSize: '14px' }} />
                <span className="text-xl text-muted-foreground">连接中...</span>
              </div>
            )}
          </div>

          <div className="px-4 py-4 flex flex-col gap-4">
            <p className="text-xl text-muted-foreground">
              在阿里云物联网平台找到您的设备，填入以下信息完成绑定。
            </p>

            {/* ProductKey */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="i-mdi-key-outline text-primary" style={{ fontSize: '16px' }} />
                <span className="text-xl font-medium text-foreground">产品 ProductKey</span>
              </div>
              <div className="border border-border rounded-xl px-4 py-3 bg-background overflow-hidden">
                <input
                  className="w-full text-xl text-foreground bg-transparent outline-none"
                  placeholder="例如：a1BcXxXxxxX"
                  value={productKey}
                  onInput={(e) => { const ev = e as any; setProductKey(ev.detail?.value ?? ev.target?.value ?? '') }}
                />
              </div>
              <p className="text-xl text-muted-foreground mt-1">IoT 控制台 → 产品 → 产品详情 → ProductKey</p>
            </div>

            {/* DeviceName */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="i-mdi-devices text-primary" style={{ fontSize: '16px' }} />
                <span className="text-xl font-medium text-foreground">设备名称 DeviceName</span>
              </div>
              <div className="border border-border rounded-xl px-4 py-3 bg-background overflow-hidden">
                <input
                  className="w-full text-xl text-foreground bg-transparent outline-none"
                  placeholder="例如：device-001"
                  value={deviceNameIot}
                  onInput={(e) => { const ev = e as any; setDeviceNameIot(ev.detail?.value ?? ev.target?.value ?? '') }}
                />
              </div>
              <p className="text-xl text-muted-foreground mt-1">IoT 控制台 → 设备管理 → 设备 → DeviceName</p>
            </div>

            {/* 连接失败错误信息 */}
            {connectStatus === 'failed' && connectErrMsg && (
              <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                <div className="i-mdi-alert-circle-outline flex-shrink-0 mt-0.5" style={{ fontSize: '20px', color: '#DC2626' }} />
                <div className="flex-1">
                  <p className="text-xl font-medium" style={{ color: '#991B1B' }}>连接失败</p>
                  <p className="text-xl" style={{ color: '#B91C1C' }}>{connectErrMsg}</p>
                  <p className="text-xl text-muted-foreground mt-1">请检查：① ProductKey/DeviceName 是否正确 ② 阿里云密钥是否已在后台配置</p>
                </div>
              </div>
            )}

            {/* 连接成功信息 */}
            {connectStatus === 'connected' && (
              <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                <div className="i-mdi-check-circle-outline flex-shrink-0" style={{ fontSize: '22px', color: '#16A34A' }} />
                <div className="flex-1">
                  <p className="text-xl font-medium" style={{ color: '#15803D' }}>设备已成功绑定</p>
                  <p className="text-xl" style={{ color: '#166534' }}>
                    {deviceOnline === true ? '设备当前在线，数据实时同步中' : '设备当前离线，上线后将自动同步数据'}
                  </p>
                </div>
              </div>
            )}

            {/* 测试连接按钮 */}
            <button
              type="button"
              className="w-full rounded-xl text-2xl font-bold flex items-center justify-center leading-none btn-press"
              style={{
                background: connectStatus === 'testing' ? 'hsl(var(--muted))' : 'var(--gradient-primary)',
                color: connectStatus === 'testing' ? 'hsl(var(--muted-foreground))' : 'white',
                padding: 0,
              }}
              onClick={connectStatus === 'testing' ? undefined : handleTestConnect}
            >
              <div className="py-4 flex items-center gap-2">
                {connectStatus === 'testing'
                  ? <><div className="i-mdi-loading" style={{ fontSize: '22px' }} /><span>连接测试中...</span></>
                  : connectStatus === 'connected'
                  ? <><div className="i-mdi-refresh" style={{ fontSize: '22px' }} /><span>重新测试连接</span></>
                  : <><div className="i-mdi-connection" style={{ fontSize: '22px' }} /><span>测试连接设备</span></>
                }
              </div>
            </button>
          </div>
        </div>
        <div className="bg-card rounded-2xl overflow-hidden shadow-card">
          <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            <div className="i-mdi-tune text-primary" style={{ fontSize: '22px' }} />
            <span className="text-2xl font-bold text-foreground">预警阈值设置</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="i-mdi-loading text-primary" style={{ fontSize: '32px' }} />
            </div>
          ) : (
            <div className="px-4 py-4 flex flex-col gap-4">
              {/* 心率阈值 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="i-mdi-heart-pulse" style={{ fontSize: '18px', color: '#EF4444' }} />
                  <span className="text-xl font-medium text-foreground">心率 (次/分)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <span className="text-xl text-muted-foreground">下限</span>
                    <div className="border border-border rounded-xl px-3 py-2 bg-background overflow-hidden mt-1">
                      <input
                        className="w-full text-xl text-foreground bg-transparent outline-none"
                        type="number"
                        value={thresholds.heart_rate_min}
                        onInput={(e) => { const ev = e as any; setThresholds(p => ({ ...p, heart_rate_min: ev.detail?.value ?? ev.target?.value ?? '' })) }}
                        placeholder="50"
                      />
                    </div>
                  </div>
                  <span className="text-2xl text-muted-foreground mt-6">~</span>
                  <div className="flex-1">
                    <span className="text-xl text-muted-foreground">上限</span>
                    <div className="border border-border rounded-xl px-3 py-2 bg-background overflow-hidden mt-1">
                      <input
                        className="w-full text-xl text-foreground bg-transparent outline-none"
                        type="number"
                        value={thresholds.heart_rate_max}
                        onInput={(e) => { const ev = e as any; setThresholds(p => ({ ...p, heart_rate_max: ev.detail?.value ?? ev.target?.value ?? '' })) }}
                        placeholder="110"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 血氧阈值 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="i-mdi-water-percent" style={{ fontSize: '18px', color: '#0EA5E9' }} />
                  <span className="text-xl font-medium text-foreground">血氧饱和度 (%)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <span className="text-xl text-muted-foreground">下限</span>
                    <div className="border border-border rounded-xl px-3 py-2 bg-background overflow-hidden mt-1">
                      <input
                        className="w-full text-xl text-foreground bg-transparent outline-none"
                        type="number"
                        value={thresholds.blood_oxygen_min}
                        onInput={(e) => { const ev = e as any; setThresholds(p => ({ ...p, blood_oxygen_min: ev.detail?.value ?? ev.target?.value ?? '' })) }}
                        placeholder="92"
                      />
                    </div>
                  </div>
                  <span className="text-2xl text-muted-foreground mt-6">~</span>
                  <div className="flex-1">
                    <div className="border border-border rounded-xl px-3 py-2 bg-muted overflow-hidden mt-6">
                      <span className="text-xl text-muted-foreground">100 (固定)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 体温阈值 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="i-mdi-thermometer" style={{ fontSize: '18px', color: '#F97316' }} />
                  <span className="text-xl font-medium text-foreground">体温 (°C)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <span className="text-xl text-muted-foreground">下限</span>
                    <div className="border border-border rounded-xl px-3 py-2 bg-background overflow-hidden mt-1">
                      <input
                        className="w-full text-xl text-foreground bg-transparent outline-none"
                        type="number"
                        value={thresholds.temperature_min}
                        onInput={(e) => { const ev = e as any; setThresholds(p => ({ ...p, temperature_min: ev.detail?.value ?? ev.target?.value ?? '' })) }}
                        placeholder="36.0"
                      />
                    </div>
                  </div>
                  <span className="text-2xl text-muted-foreground mt-6">~</span>
                  <div className="flex-1">
                    <span className="text-xl text-muted-foreground">上限</span>
                    <div className="border border-border rounded-xl px-3 py-2 bg-background overflow-hidden mt-1">
                      <input
                        className="w-full text-xl text-foreground bg-transparent outline-none"
                        type="number"
                        value={thresholds.temperature_max}
                        onInput={(e) => { const ev = e as any; setThresholds(p => ({ ...p, temperature_max: ev.detail?.value ?? ev.target?.value ?? '' })) }}
                        placeholder="37.5"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 保存按钮 */}
              <button
                type="button"
                className="w-full py-4 rounded-xl text-2xl font-bold flex items-center justify-center leading-none btn-press mt-2"
                style={{
                  background: saving ? 'hsl(var(--muted))' : 'var(--gradient-primary)',
                  color: saving ? 'hsl(var(--muted-foreground))' : 'white',
                }}
                onClick={saving ? undefined : handleSaveThresholds}
              >
                {saving ? '保存中...' : '保存阈值设置'}
              </button>
            </div>
          )}
        </div>

        {/* 设备管理 */}
        <div className="bg-card rounded-2xl overflow-hidden shadow-card">
          <div
            className="px-4 py-4 flex items-center justify-between"
            onClick={() => Taro.navigateTo({ url: '/pages/device/index' })}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <div className="i-mdi-devices text-primary" style={{ fontSize: '22px' }} />
              </div>
              <span className="text-2xl text-foreground">设备管理</span>
            </div>
            <div className="i-mdi-chevron-right text-muted-foreground" style={{ fontSize: '22px' }} />
          </div>
        </div>

        {/* 消息通知设置 */}
        <div className="bg-card rounded-2xl overflow-hidden shadow-card">
          <div
            className="px-4 py-4 flex items-center justify-between"
            onClick={() => Taro.navigateTo({ url: '/pages/notification/index' })}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <div className="i-mdi-bell-outline text-primary" style={{ fontSize: '22px' }} />
              </div>
              <span className="text-2xl text-foreground">消息通知设置</span>
            </div>
            <div className="i-mdi-chevron-right text-muted-foreground" style={{ fontSize: '22px' }} />
          </div>
        </div>

        {/* 关于 */}
        <div className="bg-card rounded-2xl overflow-hidden shadow-card">
          <div
            className="px-4 py-4 flex items-center justify-between"
            onClick={() => Taro.showModal({ title: '关于本系统', content: '智慧养老健康监护系统 v1.0\n基于多传感器融合的居家老人安全健康监测解决方案', showCancel: false })}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <div className="i-mdi-information-outline text-primary" style={{ fontSize: '22px' }} />
              </div>
              <span className="text-2xl text-foreground">关于系统</span>
            </div>
            <div className="i-mdi-chevron-right text-muted-foreground" style={{ fontSize: '22px' }} />
          </div>
        </div>

        {/* 退出登录 */}
        <button
          type="button"
          className="w-full py-4 rounded-2xl text-2xl font-medium flex items-center justify-center leading-none btn-press"
          style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}
          onClick={handleSignOut}
        >
          <div className="i-mdi-logout mr-2" style={{ fontSize: '22px' }} />
          退出登录
        </button>

        <div className="flex items-center justify-center py-2">
          <span className="text-xl text-muted-foreground">智慧养老健康监护系统 v1.0</span>
        </div>
      </div>
    </div>
  )
}

export default withRouteGuard(ProfilePage)
