// @title 设备管理
import { useState, useCallback, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { withRouteGuard } from '@/components/RouteGuard'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/client/supabase'

interface Device {
  id: string
  device_name: string
  device_sn: string
  is_online: boolean
  last_seen_at: string | null
  firmware_version: string | null
  created_at: string
}

function DevicePage() {
  const { user } = useAuth()
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [showBindModal, setShowBindModal] = useState(false)
  const [bindSn, setBindSn] = useState('')
  const [bindName, setBindName] = useState('')
  const [binding, setBinding] = useState(false)

  const loadDevices = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (!error) setDevices(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [user])

  useEffect(() => { loadDevices() }, [loadDevices])

  const handleBind = useCallback(async () => {
    if (!bindSn.trim()) {
      Taro.showToast({ title: '请输入设备序列号', icon: 'none' })
      return
    }
    if (!bindName.trim()) {
      Taro.showToast({ title: '请输入设备名称', icon: 'none' })
      return
    }
    setBinding(true)
    const { error } = await supabase.from('devices').insert({
      user_id: user!.id,
      device_sn: bindSn.trim(),
      device_name: bindName.trim(),
      is_online: false,
    })
    setBinding(false)
    if (error) {
      Taro.showToast({ title: '绑定失败，序列号可能已存在', icon: 'none' })
    } else {
      Taro.showToast({ title: '设备绑定成功', icon: 'success' })
      setShowBindModal(false)
      setBindSn('')
      setBindName('')
      loadDevices()
    }
  }, [bindSn, bindName, user, loadDevices])

  const handleUnbind = useCallback((device: Device) => {
    Taro.showModal({
      title: '解绑设备',
      content: `确认解绑设备「${device.device_name}」？`,
      confirmText: '解绑',
      cancelText: '取消',
      confirmColor: '#DC2626',
      success: async (res) => {
        if (res.confirm) {
          const { error } = await supabase.from('devices').delete().eq('id', device.id)
          if (error) {
            Taro.showToast({ title: '解绑失败', icon: 'none' })
          } else {
            Taro.showToast({ title: '已解绑', icon: 'success' })
            loadDevices()
          }
        }
      }
    })
  }, [loadDevices])

  const formatTime = (val: string | null) => {
    if (!val) return '从未连接'
    const d = new Date(val)
    const now = new Date()
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 页头渐变区 */}
      <div className="bg-gradient-primary px-6 pt-8 pb-10">
        <div className="flex items-center gap-3 mb-1">
          <div className="i-mdi-devices text-white" style={{ fontSize: '28px' }} />
          <span className="text-3xl font-bold text-white">设备管理</span>
        </div>
        <p className="text-xl text-white/80 ml-1">管理已绑定的监护设备</p>
      </div>

      <div className="px-4 -mt-6">
        {/* 绑定新设备卡 */}
        <div
          className="bg-card rounded-2xl shadow-card px-5 py-4 mb-4 flex items-center justify-between"
          onClick={() => setShowBindModal(true)}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <div className="i-mdi-plus-circle-outline text-primary" style={{ fontSize: '22px' }} />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground">绑定新设备</p>
              <p className="text-xl text-muted-foreground">通过序列号添加STM32监护设备</p>
            </div>
          </div>
          <div className="i-mdi-chevron-right text-muted-foreground" style={{ fontSize: '22px' }} />
        </div>

        {/* 设备列表 */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="i-mdi-loading animate-spin text-primary mb-3" style={{ fontSize: '36px' }} />
            <span className="text-xl text-muted-foreground">加载中...</span>
          </div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="i-mdi-devices-off text-muted-foreground mb-4" style={{ fontSize: '56px' }} />
            <p className="text-2xl text-muted-foreground mb-2">暂无绑定设备</p>
            <p className="text-xl text-muted-foreground/70">点击上方按钮绑定设备</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {devices.map((device) => (
              <div key={device.id} className="bg-card rounded-2xl shadow-card px-5 py-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${device.is_online ? 'bg-success/10' : 'bg-muted'}`}>
                      <div className={`i-mdi-wifi ${device.is_online ? 'text-success' : 'text-muted-foreground'}`} style={{ fontSize: '20px' }} />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-foreground">{device.device_name}</p>
                      <p className="text-xl text-muted-foreground">SN: {device.device_sn}</p>
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full ${device.is_online ? 'bg-success/10' : 'bg-muted'}`}>
                    <span className={`text-xl font-medium ${device.is_online ? 'text-success' : 'text-muted-foreground'}`}>
                      {device.is_online ? '在线' : '离线'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 mb-4 pl-1">
                  <div className="flex items-center gap-2">
                    <div className="i-mdi-clock-outline text-muted-foreground" style={{ fontSize: '16px' }} />
                    <span className="text-xl text-muted-foreground">最后在线：{formatTime(device.last_seen_at)}</span>
                  </div>
                  {device.firmware_version && (
                    <div className="flex items-center gap-2">
                      <div className="i-mdi-chip text-muted-foreground" style={{ fontSize: '16px' }} />
                      <span className="text-xl text-muted-foreground">固件版本：{device.firmware_version}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    className="flex-1 flex items-center justify-center leading-none py-2 rounded-xl bg-primary/10 text-xl text-primary font-medium"
                    onClick={() => Taro.showToast({ title: '固件已是最新版本', icon: 'none' })}
                  >
                    <div className="i-mdi-update mr-1" style={{ fontSize: '16px' }} />
                    检查更新
                  </button>
                  <button
                    type="button"
                    className="flex-1 flex items-center justify-center leading-none py-2 rounded-xl bg-destructive/10 text-xl text-destructive font-medium"
                    onClick={() => handleUnbind(device)}
                  >
                    <div className="i-mdi-link-off mr-1" style={{ fontSize: '16px' }} />
                    解绑设备
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 绑定设备弹窗 */}
      {showBindModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full bg-card rounded-t-3xl px-6 pt-6 pb-10">
            <div className="flex items-center justify-between mb-6">
              <span className="text-2xl font-bold text-foreground">绑定新设备</span>
              <button type="button" className="flex items-center justify-center leading-none w-8 h-8" onClick={() => setShowBindModal(false)}>
                <div className="i-mdi-close text-muted-foreground" style={{ fontSize: '24px' }} />
              </button>
            </div>

            <div className="flex flex-col gap-4 mb-6">
              <div>
                <p className="text-xl text-muted-foreground mb-2">设备名称</p>
                <div className="border-2 border-input rounded-xl px-4 py-3 bg-background overflow-hidden">
                  <input
                    className="w-full text-xl text-foreground bg-transparent outline-none"
                    placeholder="如：客厅监护仪"
                    value={bindName}
                    onInput={(e) => { const ev = e as any; setBindName(ev.detail?.value ?? ev.target?.value ?? '') }}
                  />
                </div>
              </div>
              <div>
                <p className="text-xl text-muted-foreground mb-2">设备序列号（SN）</p>
                <div className="border-2 border-input rounded-xl px-4 py-3 bg-background overflow-hidden">
                  <input
                    className="w-full text-xl text-foreground bg-transparent outline-none"
                    placeholder="见设备背面标签"
                    value={bindSn}
                    onInput={(e) => { const ev = e as any; setBindSn(ev.detail?.value ?? ev.target?.value ?? '') }}
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              className={`w-full flex items-center justify-center leading-none rounded-2xl text-2xl font-semibold text-white ${binding ? 'bg-primary/50' : 'bg-gradient-primary'}`}
              onClick={handleBind}
            >
              <div style={{ padding: '14px 0' }}>
                {binding ? '绑定中...' : '确认绑定'}
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(DevicePage)
