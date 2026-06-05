// @title 报警详情
import { useState, useCallback, useEffect, useMemo } from 'react'
import Taro from '@tarojs/taro'
import { withRouteGuard } from '@/components/RouteGuard'
import { getAlarmById, getHealthRecordNearTime, confirmAlarm } from '@/db/api'
import type { AlarmRecord, HealthRecord, AlarmType } from '@/db/types'
import { ALARM_TYPE_LABELS } from '@/db/types'

const ALARM_TYPE_ICONS: Record<AlarmType, string> = {
  fall: 'i-mdi-run-fast',
  heart_rate_high: 'i-mdi-heart-pulse',
  heart_rate_low: 'i-mdi-heart-pulse',
  blood_oxygen_low: 'i-mdi-water-percent',
  temperature_high: 'i-mdi-thermometer',
  temperature_low: 'i-mdi-thermometer',
  smoke: 'i-mdi-smoke-detector',
}

const ALARM_TYPE_COLORS: Record<AlarmType, string> = {
  fall: '#DC2626',
  heart_rate_high: '#EF4444',
  heart_rate_low: '#F97316',
  blood_oxygen_low: '#0EA5E9',
  temperature_high: '#EF4444',
  temperature_low: '#6366F1',
  smoke: '#D97706',
}

const ALARM_LEVEL_LABELS: Record<string, string> = {
  high: '高危',
  medium: '中度',
  low: '低危',
}
const ALARM_LEVEL_COLORS: Record<string, string> = {
  high: '#DC2626',
  medium: '#F97316',
  low: '#EAB308',
}

function formatFullTime(isoStr: string): string {
  const d = new Date(isoStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function timeDiff(alarmTime: string, healthTime: string): string {
  const diff = Math.abs(new Date(alarmTime).getTime() - new Date(healthTime).getTime())
  const secs = Math.round(diff / 1000)
  if (secs < 60) return `${secs} 秒`
  return `${Math.round(secs / 60)} 分钟`
}

interface VitalCardProps {
  icon: string
  label: string
  value: string | number | null
  unit: string
  color: string
  isAbnormal?: boolean
}

function VitalCard({ icon, label, value, unit, color, isAbnormal }: VitalCardProps) {
  return (
    <div
      className="flex-1 rounded-2xl px-4 py-4 flex flex-col gap-2"
      style={{
        backgroundColor: isAbnormal ? `${color}12` : 'hsl(var(--muted))',
        border: isAbnormal ? `1.5px solid ${color}40` : '1.5px solid transparent',
      }}
    >
      <div className="flex items-center gap-2">
        <div className={icon} style={{ fontSize: '18px', color }} />
        <span className="text-xl text-muted-foreground">{label}</span>
        {isAbnormal && (
          <div className="i-mdi-alert-circle-outline ml-auto" style={{ fontSize: '16px', color }} />
        )}
      </div>
      {value !== null && value !== undefined ? (
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold" style={{ color: isAbnormal ? color : 'hsl(var(--foreground))' }}>
            {typeof value === 'number' && unit === '°C' ? value.toFixed(1) : value}
          </span>
          <span className="text-xl text-muted-foreground">{unit}</span>
        </div>
      ) : (
        <span className="text-xl text-muted-foreground">无数据</span>
      )}
    </div>
  )
}

function AlarmDetailPage() {
  const alarmId = useMemo(() => {
    const raw = Taro.getCurrentInstance().router?.params?.alarmId || ''
    return decodeURIComponent(raw)
  }, [])

  const [alarm, setAlarm] = useState<AlarmRecord | null>(null)
  const [health, setHealth] = useState<HealthRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)

  const loadData = useCallback(async () => {
    if (!alarmId) return
    setLoading(true)
    const alarmData = await getAlarmById(alarmId)
    setAlarm(alarmData)
    if (alarmData) {
      const healthData = await getHealthRecordNearTime(alarmData.created_at)
      setHealth(healthData)
    }
    setLoading(false)
  }, [alarmId])

  useEffect(() => { loadData() }, [loadData])

  const handleConfirm = useCallback(async () => {
    if (!alarm || alarm.is_confirmed) return
    setConfirming(true)
    await confirmAlarm(alarm.id)
    setAlarm(prev => prev ? { ...prev, is_confirmed: true, confirmed_at: new Date().toISOString() } : prev)
    setConfirming(false)
    Taro.showToast({ title: '已确认处理', icon: 'success' })
  }, [alarm])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="i-mdi-loading text-primary" style={{ fontSize: '48px' }} />
      </div>
    )
  }

  if (!alarm) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="i-mdi-alert-circle-outline text-muted-foreground" style={{ fontSize: '56px' }} />
        <span className="text-2xl text-muted-foreground">报警记录不存在</span>
        <button type="button" className="px-6 py-3 rounded-xl text-xl text-primary btn-press flex items-center justify-center leading-none"
          style={{ backgroundColor: 'hsl(var(--accent))' }}
          onClick={() => Taro.navigateBack()}>
          返回
        </button>
      </div>
    )
  }

  const alarmColor = ALARM_TYPE_COLORS[alarm.alarm_type]
  const levelColor = ALARM_LEVEL_COLORS[alarm.alarm_level] || '#F97316'

  // 判断各体征是否为触发此报警的异常项
  const isHRAlarm = alarm.alarm_type === 'heart_rate_high' || alarm.alarm_type === 'heart_rate_low'
  const isBOAlarm = alarm.alarm_type === 'blood_oxygen_low'
  const isTempAlarm = alarm.alarm_type === 'temperature_high' || alarm.alarm_type === 'temperature_low'
  const isFallAlarm = alarm.alarm_type === 'fall'
  const isSmokeAlarm = alarm.alarm_type === 'smoke'

  return (
    <div className="min-h-screen bg-background">
      {/* 报警概要 Hero */}
      <div className="px-5 pt-6 pb-8" style={{ background: `linear-gradient(135deg, ${alarmColor}E6, ${alarmColor}99)` }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
            <div className={ALARM_TYPE_ICONS[alarm.alarm_type]} style={{ fontSize: '36px', color: 'white' }} />
          </div>
          <div className="flex-1">
            <p className="text-white text-2xl font-bold">{ALARM_TYPE_LABELS[alarm.alarm_type]}</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.25)' }}>
                <span className="text-xl text-white font-medium">{ALARM_LEVEL_LABELS[alarm.alarm_level] || alarm.alarm_level}</span>
              </div>
              {alarm.is_confirmed && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.25)' }}>
                  <div className="i-mdi-check-circle-outline text-white" style={{ fontSize: '14px' }} />
                  <span className="text-xl text-white">已确认</span>
                </div>
              )}
            </div>
          </div>
          {alarm.alarm_value && (
            <div className="text-right">
              <p className="text-white text-2xl font-bold">{alarm.alarm_value}</p>
              <p className="text-white/70 text-xl">报警值</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <div className="i-mdi-clock-outline text-white/70" style={{ fontSize: '16px' }} />
          <span className="text-xl text-white/90">{formatFullTime(alarm.created_at)}</span>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* 数据快照区 */}
        <div className="bg-card rounded-2xl overflow-hidden shadow-card">
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            <div className="flex items-center gap-2">
              <div className="i-mdi-database-clock-outline text-primary" style={{ fontSize: '22px' }} />
              <span className="text-2xl font-bold text-foreground">报警时刻数据快照</span>
            </div>
            {health && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ backgroundColor: 'hsl(var(--accent))' }}>
                <div className="i-mdi-timer-outline text-primary" style={{ fontSize: '14px' }} />
                <span className="text-xl text-primary">±{timeDiff(alarm.created_at, health.created_at)}</span>
              </div>
            )}
          </div>

          {health ? (
            <div className="px-4 py-4 flex flex-col gap-3">
              <p className="text-xl text-muted-foreground">
                数据采集时间：{formatFullTime(health.created_at)}
              </p>

              {/* 体征卡片 2列布局 */}
              <div className="flex gap-3">
                <VitalCard
                  icon="i-mdi-heart-pulse"
                  label="心率"
                  value={health.heart_rate}
                  unit="次/分"
                  color="#EF4444"
                  isAbnormal={isHRAlarm}
                />
                <VitalCard
                  icon="i-mdi-water-percent"
                  label="血氧"
                  value={health.blood_oxygen}
                  unit="%"
                  color="#0EA5E9"
                  isAbnormal={isBOAlarm}
                />
              </div>
              <div className="flex gap-3">
                <VitalCard
                  icon="i-mdi-thermometer"
                  label="体温"
                  value={health.temperature}
                  unit="°C"
                  color="#F97316"
                  isAbnormal={isTempAlarm}
                />
                <VitalCard
                  icon="i-mdi-smoke-detector"
                  label="烟雾值"
                  value={health.smoke_value}
                  unit="ppm"
                  color="#D97706"
                  isAbnormal={isSmokeAlarm}
                />
              </div>

              {/* 跌倒 & 烟雾报警状态 */}
              <div className="flex gap-3">
                <div
                  className="flex-1 rounded-2xl px-4 py-3 flex items-center gap-3"
                  style={{
                    backgroundColor: (isFallAlarm && health.fall_detected) ? '#FEF2F2' : 'hsl(var(--muted))',
                    border: (isFallAlarm && health.fall_detected) ? '1.5px solid #FECACA' : '1.5px solid transparent',
                  }}
                >
                  <div className="i-mdi-run-fast" style={{ fontSize: '22px', color: isFallAlarm ? '#DC2626' : '#94A3B8' }} />
                  <div className="flex-1">
                    <p className="text-xl text-muted-foreground">跌倒检测</p>
                    <p className="text-xl font-medium" style={{ color: health.fall_detected ? '#DC2626' : '#16A34A' }}>
                      {health.fall_detected ? '已检测到跌倒' : '未检测到'}
                    </p>
                  </div>
                </div>
                <div
                  className="flex-1 rounded-2xl px-4 py-3 flex items-center gap-3"
                  style={{
                    backgroundColor: (isSmokeAlarm && health.smoke_alarm) ? '#FFFBEB' : 'hsl(var(--muted))',
                    border: (isSmokeAlarm && health.smoke_alarm) ? '1.5px solid #FDE68A' : '1.5px solid transparent',
                  }}
                >
                  <div className="i-mdi-smoke-detector" style={{ fontSize: '22px', color: isSmokeAlarm ? '#D97706' : '#94A3B8' }} />
                  <div className="flex-1">
                    <p className="text-xl text-muted-foreground">烟雾报警</p>
                    <p className="text-xl font-medium" style={{ color: health.smoke_alarm ? '#D97706' : '#16A34A' }}>
                      {health.smoke_alarm ? '烟雾超标' : '正常'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="i-mdi-database-search-outline text-muted-foreground" style={{ fontSize: '48px' }} />
              <span className="text-xl text-muted-foreground">报警时刻前后 10 分钟内无健康数据记录</span>
              <span className="text-xl text-muted-foreground">请检查设备是否正常上报数据</span>
            </div>
          )}
        </div>

        {/* 确认处理按钮 */}
        {!alarm.is_confirmed ? (
          <button
            type="button"
            className="w-full rounded-2xl text-2xl font-bold flex items-center justify-center leading-none btn-press"
            style={{
              background: confirming ? 'hsl(var(--muted))' : 'var(--gradient-primary)',
              color: confirming ? 'hsl(var(--muted-foreground))' : 'white',
              padding: 0,
            }}
            onClick={confirming ? undefined : handleConfirm}
          >
            <div className="py-4 flex items-center gap-2">
              {confirming
                ? <><div className="i-mdi-loading" style={{ fontSize: '22px' }} /><span>处理中...</span></>
                : <><div className="i-mdi-check-circle-outline" style={{ fontSize: '22px' }} /><span>确认已处理</span></>
              }
            </div>
          </button>
        ) : (
          <div className="rounded-2xl px-4 py-4 flex items-center gap-3" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
            <div className="i-mdi-check-circle text-primary" style={{ fontSize: '28px', color: '#16A34A' }} />
            <div className="flex-1">
              <p className="text-xl font-medium" style={{ color: '#15803D' }}>已确认处理</p>
              {alarm.confirmed_at && (
                <p className="text-xl" style={{ color: '#166534' }}>确认时间：{formatFullTime(alarm.confirmed_at)}</p>
              )}
            </div>
          </div>
        )}

        {/* 返回按钮 */}
        <button
          type="button"
          className="w-full py-4 rounded-2xl text-2xl font-medium flex items-center justify-center leading-none btn-press"
          style={{ backgroundColor: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
          onClick={() => Taro.navigateBack()}
        >
          返回历史记录
        </button>
      </div>
    </div>
  )
}

export default withRouteGuard(AlarmDetailPage)
