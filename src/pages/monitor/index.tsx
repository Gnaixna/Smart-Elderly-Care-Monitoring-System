// @title 实时监测
import { useState, useCallback, useEffect, useRef } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { withRouteGuard } from '@/components/RouteGuard'
import { useAuth } from '@/contexts/AuthContext'
import {
  getLatestHealthRecord,
  getDevice,
  getUnconfirmedAlarms,
  confirmAlarm,
  insertAlarmRecord,
  insertHealthRecord,
  aliyunGetDeviceInfo,
  aliyunGetDeviceProperty,
} from '@/db/api'
import type { HealthRecord, Device, AlarmRecord, AlarmType } from '@/db/types'
import { ALARM_TYPE_LABELS, DEFAULT_THRESHOLDS } from '@/db/types'

// 模拟心率波动（开发演示用）
function simulateHeartRate(base: number): number {
  return base + Math.floor(Math.random() * 6) - 3
}
function simulateBloodOxygen(base: number): number {
  return Math.min(100, Math.max(90, base + Math.floor(Math.random() * 3) - 1))
}
function simulateTemp(base: number): number {
  return Math.round((base + (Math.random() * 0.2 - 0.1)) * 10) / 10
}

interface AlarmModalData {
  alarm: AlarmRecord
}

function MonitorPage() {
  const { profile } = useAuth()
  const [device, setDevice] = useState<Device | null>(null)
  const [health, setHealth] = useState<HealthRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [alarmModal, setAlarmModal] = useState<AlarmModalData | null>(null)
  const [pendingAlarms, setPendingAlarms] = useState<AlarmRecord[]>([])
  const [alarmIndex, setAlarmIndex] = useState(0)
  const [aliyunOnline, setAliyunOnline] = useState<boolean | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const alarmCheckRef = useRef(false)
  // 记录上次从阿里云同步的数据时间戳，避免重复写入
  const lastIotTimestampRef = useRef<number>(0)

  const thresholds = {
    heart_rate_max: profile?.heart_rate_max ?? DEFAULT_THRESHOLDS.heart_rate_max,
    heart_rate_min: profile?.heart_rate_min ?? DEFAULT_THRESHOLDS.heart_rate_min,
    blood_oxygen_min: profile?.blood_oxygen_min ?? DEFAULT_THRESHOLDS.blood_oxygen_min,
    temperature_max: profile?.temperature_max ?? DEFAULT_THRESHOLDS.temperature_max,
    temperature_min: profile?.temperature_min ?? DEFAULT_THRESHOLDS.temperature_min,
  }

  // 检查是否异常
  const checkAbnormal = useCallback((rec: HealthRecord) => {
    const alarms: { type: AlarmType; value: string; level: 'low' | 'medium' | 'high' }[] = []
    if (rec.fall_detected) alarms.push({ type: 'fall', value: '跌倒检测', level: 'high' })
    if (rec.smoke_alarm) alarms.push({ type: 'smoke', value: '烟雾超标', level: 'high' })
    if (rec.heart_rate && rec.heart_rate > thresholds.heart_rate_max)
      alarms.push({ type: 'heart_rate_high', value: `${rec.heart_rate}次/分`, level: 'medium' })
    if (rec.heart_rate && rec.heart_rate < thresholds.heart_rate_min)
      alarms.push({ type: 'heart_rate_low', value: `${rec.heart_rate}次/分`, level: 'medium' })
    if (rec.blood_oxygen && rec.blood_oxygen < thresholds.blood_oxygen_min)
      alarms.push({ type: 'blood_oxygen_low', value: `${rec.blood_oxygen}%`, level: rec.blood_oxygen < 90 ? 'high' : 'medium' })
    if (rec.temperature && rec.temperature > thresholds.temperature_max)
      alarms.push({ type: 'temperature_high', value: `${rec.temperature}°C`, level: 'medium' })
    if (rec.temperature && rec.temperature < thresholds.temperature_min)
      alarms.push({ type: 'temperature_low', value: `${rec.temperature}°C`, level: 'medium' })
    return alarms
  }, [thresholds])

  /**
   * 从阿里云设备影子主动拉取最新上报数据
   * 企业版实例不支持规则引擎 HTTP 转发，改用主动轮询方案
   */
  const syncFromIot = useCallback(async () => {
    const res = await aliyunGetDeviceProperty()
    if (!res.success || !res.data) return
    // PropertyStatusInfo 是数组：[{Identifier, Value, Time}, ...]
    const props = (res.data as unknown) as Array<{ Identifier: string; Value: unknown; Time: number }>
    if (!Array.isArray(props) || props.length === 0) return
    // 取最新时间戳，判断是否有新数据
    const latestTs = Math.max(...props.map((p) => p.Time || 0))
    if (latestTs <= lastIotTimestampRef.current) return
    // 解析各字段（支持驼峰和下划线两种命名）
    const get = (id: string, alt?: string) => props.find((p) => p.Identifier === id || p.Identifier === alt)?.Value
    const heartRate = Number(get('heart_rate', 'HeartRate') ?? 0)
    const bloodOxygen = Number(get('blood_oxygen', 'BloodOxygen') ?? 0)
    const temperature = Number(get('temperature', 'Temperature') ?? 0)
    const fallDetected = Boolean(get('fall_detected', 'FallDetected') ?? false)
    const smokeValue = Number(get('smoke_value', 'SmokeValue') ?? 0)
    const smokeAlarm = Boolean(get('smoke_alarm', 'SmokeAlarm') ?? false)
    // 至少有一个有效数值才写入，避免全零脏数据
    if (heartRate === 0 && bloodOxygen === 0 && temperature === 0) return
    lastIotTimestampRef.current = latestTs
    await insertHealthRecord({ heart_rate: heartRate, blood_oxygen: bloodOxygen, temperature, fall_detected: fallDetected, smoke_value: smokeValue, smoke_alarm: smokeAlarm })
    const latest = await getLatestHealthRecord()
    setHealth(latest)
  }, [])

  const loadData = useCallback(async () => {
    const [deviceData, healthData] = await Promise.all([getDevice(), getLatestHealthRecord()])
    setDevice(deviceData)
    setHealth(healthData)
    setLoading(false)
    // 同步查询阿里云设备在线状态 + 拉取最新属性
    aliyunGetDeviceInfo().then((res) => {
      if (res.success) setAliyunOnline(res.online ?? false)
    })
    syncFromIot()
  }, [syncFromIot])

  const checkAlarms = useCallback(async () => {
    if (alarmCheckRef.current) return
    alarmCheckRef.current = true
    const unconfirmed = await getUnconfirmedAlarms()
    alarmCheckRef.current = false
    if (unconfirmed.length > 0) {
      setPendingAlarms(unconfirmed)
      setAlarmIndex(0)
      setAlarmModal({ alarm: unconfirmed[0] })
    }
  }, [])

  // 模拟设备数据更新（生产环境中由实际设备写入）
  const simulateDeviceUpdate = useCallback(async () => {
    if (!health) return
    const newRecord = {
      heart_rate: simulateHeartRate(health.heart_rate ?? 78),
      blood_oxygen: simulateBloodOxygen(health.blood_oxygen ?? 98),
      temperature: simulateTemp(health.temperature ?? 36.5),
      fall_detected: false,
      smoke_value: 320 + Math.random() * 100,
      smoke_alarm: false,
    }
    // 检测异常并记录
    const abnormals = checkAbnormal({ ...health, ...newRecord })
    for (const ab of abnormals) {
      await insertAlarmRecord({ alarm_type: ab.type, alarm_value: ab.value, alarm_level: ab.level })
    }
    await insertHealthRecord(newRecord)
    const latest = await getLatestHealthRecord()
    setHealth(latest)
  }, [health, checkAbnormal])

  useEffect(() => { loadData() }, [loadData])
  useDidShow(() => { loadData(); checkAlarms() })

  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadData()
      checkAlarms()
    }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadData, checkAlarms])

  const handleConfirmAlarm = useCallback(async (alarmId: string) => {
    await confirmAlarm(alarmId)
    const next = alarmIndex + 1
    if (next < pendingAlarms.length) {
      setAlarmIndex(next)
      setAlarmModal({ alarm: pendingAlarms[next] })
    } else {
      setAlarmModal(null)
      setPendingAlarms([])
    }
  }, [alarmIndex, pendingAlarms])

  const handleDismissAlarm = useCallback(() => {
    const next = alarmIndex + 1
    if (next < pendingAlarms.length) {
      setAlarmIndex(next)
      setAlarmModal({ alarm: pendingAlarms[next] })
    } else {
      setAlarmModal(null)
    }
  }, [alarmIndex, pendingAlarms])

  const isHeartRateAbnormal = health?.heart_rate !== null && health?.heart_rate !== undefined &&
    (health.heart_rate > thresholds.heart_rate_max || health.heart_rate < thresholds.heart_rate_min)
  const isBloodOxygenAbnormal = health?.blood_oxygen !== null && health?.blood_oxygen !== undefined &&
    health.blood_oxygen < thresholds.blood_oxygen_min
  const isTempAbnormal = health?.temperature !== null && health?.temperature !== undefined &&
    (health.temperature > thresholds.temperature_max || health.temperature < thresholds.temperature_min)
  const isFallAbnormal = health?.fall_detected === true
  const isSmokeAbnormal = health?.smoke_alarm === true

  const getAlarmIcon = (type: string) => {
    if (type === 'fall') return 'i-mdi-human-male-board-poll'
    if (type === 'smoke') return 'i-mdi-smoke-detector-alert'
    if (type.includes('heart')) return 'i-mdi-heart-pulse'
    if (type.includes('temp')) return 'i-mdi-thermometer-alert'
    if (type.includes('oxygen')) return 'i-mdi-water-alert'
    return 'i-mdi-alert-circle'
  }

  const getAlarmLevelColor = (level: string) => {
    if (level === 'high') return '#DC2626'
    if (level === 'medium') return '#F59E0B'
    return '#6B7280'
  }

  const now = new Date()
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`

  return (
    <div className="min-h-screen bg-background">
      {/* 设备状态栏 */}
      <div className="bg-gradient-primary px-5 pt-4 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <div className="i-mdi-devices text-white" style={{ fontSize: '26px' }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-white text-2xl font-bold">{device?.name || '老人监护设备001'}</span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full breathe" style={{ backgroundColor: device?.is_online ? '#4ADE80' : '#94A3B8' }} />
                <span className="text-xl" style={{ color: device?.is_online ? '#4ADE80' : '#94A3B8' }}>
                  {device?.is_online ? '在线' : '离线'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-white/70 text-xl">最后更新：{timeStr}</span>
              {aliyunOnline !== null && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
                  <div className="i-mdi-cloud-check-outline text-white/90" style={{ fontSize: '14px' }} />
                  <span className="text-xl" style={{ color: aliyunOnline ? '#4ADE80' : '#94A3B8' }}>
                    阿里云{aliyunOnline ? '已连接' : '未连接'}
                  </span>
                </div>
              )}
            </div>
          </div>
          <button type="button" className="flex items-center justify-center leading-none" onClick={loadData}>
            <div className="i-mdi-refresh text-white/80" style={{ fontSize: '24px' }} />
          </button>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {/* 四个生理指标卡片 2x2 */}
        <div className="flex gap-3">
          {/* 心率 */}
          <div className={`flex-1 bg-card rounded-2xl p-4 shadow-card ${isHeartRateAbnormal ? 'alarm-flash' : ''}`}
            style={{ border: isHeartRateAbnormal ? '2px solid #DC2626' : '2px solid transparent' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="i-mdi-heart-pulse" style={{ fontSize: '22px', color: '#EF4444' }} />
              <span className="text-xl text-muted-foreground">心率</span>
            </div>
            <div className="flex items-end gap-1">
              <span className="font-bold text-foreground" style={{ fontSize: '36px', lineHeight: 1 }}>{loading ? '--' : (health?.heart_rate ?? '--')}</span>
              <span className="text-xl text-muted-foreground mb-1">次/分</span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              {isHeartRateAbnormal
                ? <span className="text-xl font-medium" style={{ color: '#DC2626' }}>异常</span>
                : <span className="text-xl text-muted-foreground">正常范围: {thresholds.heart_rate_min}-{thresholds.heart_rate_max}</span>}
            </div>
          </div>

          {/* 血氧 */}
          <div className={`flex-1 bg-card rounded-2xl p-4 shadow-card ${isBloodOxygenAbnormal ? 'alarm-flash' : ''}`}
            style={{ border: isBloodOxygenAbnormal ? '2px solid #DC2626' : '2px solid transparent' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="i-mdi-water-percent" style={{ fontSize: '22px', color: '#0EA5E9' }} />
              <span className="text-xl text-muted-foreground">血氧饱和度</span>
            </div>
            <div className="flex items-end gap-1">
              <span className="font-bold text-foreground" style={{ fontSize: '36px', lineHeight: 1 }}>{loading ? '--' : (health?.blood_oxygen ?? '--')}</span>
              <span className="text-xl text-muted-foreground mb-1">%</span>
            </div>
            <div className="mt-2">
              {isBloodOxygenAbnormal
                ? <span className="text-xl font-medium" style={{ color: '#DC2626' }}>偏低</span>
                : <span className="text-xl text-muted-foreground">正常范围: {thresholds.blood_oxygen_min}-100</span>}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          {/* 体温 */}
          <div className={`flex-1 bg-card rounded-2xl p-4 shadow-card ${isTempAbnormal ? 'alarm-flash' : ''}`}
            style={{ border: isTempAbnormal ? '2px solid #DC2626' : '2px solid transparent' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="i-mdi-thermometer" style={{ fontSize: '22px', color: '#F97316' }} />
              <span className="text-xl text-muted-foreground">体温</span>
            </div>
            <div className="flex items-end gap-1">
              <span className="font-bold text-foreground" style={{ fontSize: '36px', lineHeight: 1 }}>{loading ? '--' : (health?.temperature ?? '--')}</span>
              <span className="text-xl text-muted-foreground mb-1">°C</span>
            </div>
            <div className="mt-2">
              {isTempAbnormal
                ? <span className="text-xl font-medium" style={{ color: '#DC2626' }}>异常</span>
                : <span className="text-xl text-muted-foreground">正常范围: {thresholds.temperature_min}-{thresholds.temperature_max}</span>}
            </div>
          </div>

          {/* 跌倒状态 */}
          <div className={`flex-1 bg-card rounded-2xl p-4 shadow-card ${isFallAbnormal ? 'alarm-flash' : ''}`}
            style={{ border: isFallAbnormal ? '2px solid #DC2626' : '2px solid transparent' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="i-mdi-run-fast" style={{ fontSize: '22px', color: '#10B981' }} />
              <span className="text-xl text-muted-foreground">跌倒状态</span>
            </div>
            <div className="flex items-center justify-center" style={{ height: '48px' }}>
              <span className="text-2xl font-bold" style={{ color: isFallAbnormal ? '#DC2626' : '#10B981' }}>
                {isFallAbnormal ? '跌倒警报' : '正常'}
              </span>
            </div>
            <div className="mt-2">
              <span className="text-xl text-muted-foreground">{isFallAbnormal ? '请立即处置！' : '未检测到跌倒'}</span>
            </div>
          </div>
        </div>

        {/* 烟雾状态 */}
        <div className={`bg-card rounded-2xl p-4 shadow-card ${isSmokeAbnormal ? 'alarm-flash' : ''}`}
          style={{ border: isSmokeAbnormal ? '2px solid #DC2626' : '2px solid transparent' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: isSmokeAbnormal ? '#FEE2E2' : '#D1FAE5' }}>
                <div className="i-mdi-smoke-detector" style={{ fontSize: '24px', color: isSmokeAbnormal ? '#DC2626' : '#10B981' }} />
              </div>
              <span className="text-2xl font-medium text-foreground">烟雾状态</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: isSmokeAbnormal ? '#DC2626' : '#10B981' }} />
              <span className="text-2xl font-bold" style={{ color: isSmokeAbnormal ? '#DC2626' : '#10B981' }}>
                {isSmokeAbnormal ? '异常' : '正常'}
              </span>
            </div>
          </div>
          <div className="mt-2 px-1">
            <span className="text-xl text-muted-foreground">
              {isSmokeAbnormal ? '烟雾浓度超标！请立即检查环境安全' : '当前环境安全'}
            </span>
          </div>
        </div>

        {/* 演示操作区 */}
        <div className="bg-card rounded-2xl shadow-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <div className="i-mdi-flask-outline text-primary" style={{ fontSize: '16px' }} />
            <span className="text-xl font-semibold text-primary">演示操作</span>
          </div>
          <div className="flex border-t border-border">
            <button
              type="button"
              className="flex-1 flex flex-col items-center justify-center gap-1 py-4 btn-press"
              onClick={simulateDeviceUpdate}
            >
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <div className="i-mdi-database-sync text-primary" style={{ fontSize: '22px' }} />
              </div>
              <span className="text-xl text-foreground">刷新数据</span>
            </button>
            <div className="w-px bg-border" />
            <button
              type="button"
              className="flex-1 flex flex-col items-center justify-center gap-1 py-4 btn-press"
              onClick={async () => {
                const types: Array<{ type: AlarmType; value: string; level: 'high' | 'medium' }> = [
                  { type: 'fall', value: '跌倒检测', level: 'high' },
                  { type: 'heart_rate_high', value: '118次/分', level: 'medium' },
                  { type: 'smoke', value: '烟雾超标', level: 'high' },
                  { type: 'blood_oxygen_low', value: '88%', level: 'high' },
                ]
                const pick = types[Math.floor(Math.random() * types.length)]
                await insertAlarmRecord({ alarm_type: pick.type, alarm_value: pick.value, alarm_level: pick.level })
                await checkAlarms()
              }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#FEE2E2' }}>
                <div className="i-mdi-bell-alert-outline" style={{ fontSize: '22px', color: '#DC2626' }} />
              </div>
              <span className="text-xl text-foreground">触发告警</span>
            </button>
          </div>
        </div>

        {/* 历史数据入口 */}
        <button
          type="button"
          className="bg-card rounded-2xl p-4 shadow-card w-full flex items-center justify-between btn-press"
          onClick={() => Taro.switchTab({ url: '/pages/history/index' })}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
              <div className="i-mdi-chart-line text-primary" style={{ fontSize: '22px' }} />
            </div>
            <span className="text-2xl text-foreground font-medium">历史数据</span>
          </div>
          <div className="i-mdi-chevron-right text-muted-foreground" style={{ fontSize: '22px' }} />
        </button>
      </div>

      {/* 告警弹窗 */}
      {alarmModal && (
        <div
          className="fixed inset-0 flex items-end justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 999 }}
        >
          <div className="bg-card w-full rounded-t-3xl px-6 pt-6 pb-8"
            style={{ boxShadow: '0 -4px 30px rgba(220,38,38,0.2)' }}>
            {/* 顶部提示条 */}
            <div className="flex items-center justify-center mb-5">
              <div className="w-12 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: `${getAlarmLevelColor(alarmModal.alarm.alarm_level)}15` }}>
                <div className={getAlarmIcon(alarmModal.alarm.alarm_type)} style={{ fontSize: '32px', color: getAlarmLevelColor(alarmModal.alarm.alarm_level) }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-foreground">
                    {ALARM_TYPE_LABELS[alarmModal.alarm.alarm_type]}
                  </span>
                  <span className="text-xl px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${getAlarmLevelColor(alarmModal.alarm.alarm_level)}15`, color: getAlarmLevelColor(alarmModal.alarm.alarm_level) }}>
                    {alarmModal.alarm.alarm_level === 'high' ? '紧急' : alarmModal.alarm.alarm_level === 'medium' ? '警告' : '提示'}
                  </span>
                </div>
                <span className="text-xl text-muted-foreground">
                  {new Date(alarmModal.alarm.created_at).toLocaleString('zh-CN')}
                </span>
              </div>
            </div>

            {alarmModal.alarm.alarm_value && (
              <div className="rounded-xl p-4 mb-5" style={{ backgroundColor: `${getAlarmLevelColor(alarmModal.alarm.alarm_level)}10` }}>
                <span className="text-xl text-muted-foreground">检测数值：</span>
                <span className="text-2xl font-bold ml-1" style={{ color: getAlarmLevelColor(alarmModal.alarm.alarm_level) }}>
                  {alarmModal.alarm.alarm_value}
                </span>
              </div>
            )}

            {pendingAlarms.length > 1 && (
              <div className="text-center mb-4">
                <span className="text-xl text-muted-foreground">{alarmIndex + 1} / {pendingAlarms.length} 条未读报警</span>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 py-4 rounded-xl text-2xl font-medium flex items-center justify-center leading-none btn-press"
                style={{ backgroundColor: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
                onClick={handleDismissAlarm}
              >
                稍后处理
              </button>
              <button
                type="button"
                className="flex-1 py-4 rounded-xl text-2xl font-bold flex items-center justify-center leading-none btn-press"
                style={{ background: 'var(--gradient-primary)', color: 'white' }}
                onClick={() => handleConfirmAlarm(alarmModal.alarm.id)}
              >
                已确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(MonitorPage)
