// @title 历史记录
import { useState, useCallback, useEffect, useMemo } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { withRouteGuard } from '@/components/RouteGuard'
import { getHealthRecords, getAlarmRecords } from '@/db/api'
import type { HealthRecord, AlarmRecord, AlarmType } from '@/db/types'
import { ALARM_TYPE_LABELS } from '@/db/types'

type TimeRange = 'day' | 'week' | 'month'
type DataType = 'heart_rate' | 'blood_oxygen' | 'temperature'

const DATA_TYPE_LABELS: Record<DataType, string> = {
  heart_rate: '心率',
  blood_oxygen: '血氧',
  temperature: '体温',
}
const DATA_TYPE_UNITS: Record<DataType, string> = {
  heart_rate: '次/分',
  blood_oxygen: '%',
  temperature: '°C',
}
const DATA_TYPE_COLORS: Record<DataType, string> = {
  heart_rate: '#EF4444',
  blood_oxygen: '#0EA5E9',
  temperature: '#F97316',
}

const ALARM_TYPE_ICONS: Record<AlarmType, string> = {
  fall: 'i-mdi-run-fast',
  heart_rate_high: 'i-mdi-heart-pulse',
  heart_rate_low: 'i-mdi-heart-pulse',
  blood_oxygen_low: 'i-mdi-water-percent',
  temperature_high: 'i-mdi-thermometer',
  temperature_low: 'i-mdi-thermometer',
  smoke: 'i-mdi-smoke-detector',
}

const ALARM_TYPE_ICON_COLORS: Record<AlarmType, string> = {
  fall: '#DC2626',
  heart_rate_high: '#EF4444',
  heart_rate_low: '#F97316',
  blood_oxygen_low: '#0EA5E9',
  temperature_high: '#EF4444',
  temperature_low: '#6366F1',
  smoke: '#D97706',
}

function getTimeRange(range: TimeRange): { start: string; end: string } {
  const now = new Date()
  const end = now.toISOString()
  let start: Date
  if (range === 'day') {
    start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  } else if (range === 'week') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }
  return { start: start.toISOString(), end }
}

function formatTime(isoStr: string, range: TimeRange): string {
  const d = new Date(isoStr)
  if (range === 'day') {
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  } else if (range === 'week') {
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00`
  }
  return `${d.getMonth()+1}/${d.getDate()}`
}

function formatAlarmTime(isoStr: string): string {
  const d = new Date(isoStr)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
}

// 迷你折线图SVG组件（纯Canvas替代，不依赖echarts）
function MiniLineChart({ records, dataType, color }: { records: HealthRecord[], dataType: DataType, color: string }) {
  const values = records.map(r => Number(r[dataType] ?? 0)).filter(v => v > 0)
  if (values.length < 2) {
    return (
      <div className="flex items-center justify-center" style={{ height: '180px' }}>
        <span className="text-xl text-muted-foreground">暂无数据</span>
      </div>
    )
  }

  const sample = values.length > 60 ? values.filter((_, i) => i % Math.ceil(values.length / 60) === 0) : values
  const sampleRecords = records.length > 60 ? records.filter((_, i) => i % Math.ceil(records.length / 60) === 0) : records

  const min = Math.min(...sample)
  const max = Math.max(...sample)
  const range = max - min || 1
  const W = 320
  const H = 140
  const PAD = 8

  const points = sample.map((v, i) => ({
    x: PAD + (i / (sample.length - 1)) * (W - PAD * 2),
    y: H - PAD - ((v - min) / range) * (H - PAD * 2),
    v,
    t: sampleRecords[i]?.created_at || '',
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaD = `${pathD} L ${points[points.length-1].x.toFixed(1)} ${H} L ${points[0].x.toFixed(1)} ${H} Z`

  // X轴标签
  const xLabels = [0, Math.floor(sample.length / 2), sample.length - 1].map(i => ({
    x: points[i]?.x ?? 0,
    label: sampleRecords[i] ? formatTime(sampleRecords[i].created_at, 'day') : '',
  }))

  // Y轴参考线
  const midY = H - PAD - ((( (max + min) / 2) - min) / range) * (H - PAD * 2)

  return (
    <div className="w-full" style={{ overflowX: 'auto' }}>
      <svg width={W} height={H + 24} viewBox={`0 0 ${W} ${H + 24}`} style={{ display: 'block', margin: '0 auto' }}>
        {/* 参考线 */}
        <line x1={PAD} y1={PAD} x2={W - PAD} y2={PAD} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="4,4" />
        <line x1={PAD} y1={midY} x2={W - PAD} y2={midY} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="4,4" />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#E2E8F0" strokeWidth="1" />
        {/* Y轴数值 */}
        <text x={PAD - 2} y={PAD + 4} fontSize="10" fill="#94A3B8" textAnchor="end">{max.toFixed(dataType === 'temperature' ? 1 : 0)}</text>
        <text x={PAD - 2} y={H - PAD + 4} fontSize="10" fill="#94A3B8" textAnchor="end">{min.toFixed(dataType === 'temperature' ? 1 : 0)}</text>
        {/* 面积填充 */}
        <path d={areaD} fill={`${color}18`} />
        {/* 折线 */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* 数据点（只显示最后一个） */}
        {points.length > 0 && (
          <>
            <circle cx={points[points.length-1].x} cy={points[points.length-1].y} r="4" fill={color} />
            <rect x={points[points.length-1].x - 28} y={points[points.length-1].y - 24} width={56} height={18} rx="4" fill={color} />
            <text x={points[points.length-1].x} y={points[points.length-1].y - 11} fontSize="11" fill="white" textAnchor="middle">
              {points[points.length-1].v.toFixed(dataType === 'temperature' ? 1 : 0)}
            </text>
          </>
        )}
        {/* X轴标签 */}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={H + 16} fontSize="10" fill="#94A3B8" textAnchor="middle">{l.label}</text>
        ))}
      </svg>
    </div>
  )
}

function HistoryPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('day')
  const [dataType, setDataType] = useState<DataType>('heart_rate')
  const [records, setRecords] = useState<HealthRecord[]>([])
  const [alarms, setAlarms] = useState<AlarmRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [loadingAlarms, setLoadingAlarms] = useState(true)

  const selectedDate = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  }, [])

  const loadRecords = useCallback(async () => {
    setLoadingRecords(true)
    const { start, end } = getTimeRange(timeRange)
    const data = await getHealthRecords({ startTime: start, endTime: end, limit: 200 })
    setRecords(data)
    setLoadingRecords(false)
  }, [timeRange])

  const loadAlarms = useCallback(async () => {
    setLoadingAlarms(true)
    const data = await getAlarmRecords({ limit: 30 })
    setAlarms(data)
    setLoadingAlarms(false)
  }, [])

  useEffect(() => { loadRecords(); loadAlarms() }, [loadRecords, loadAlarms])
  useDidShow(() => { loadRecords(); loadAlarms() })

  // 当前数据类型的统计
  const stats = useMemo(() => {
    const vals = records.map(r => Number(r[dataType] ?? 0)).filter(v => v > 0)
    if (vals.length === 0) return null
    return {
      min: Math.min(...vals).toFixed(dataType === 'temperature' ? 1 : 0),
      max: Math.max(...vals).toFixed(dataType === 'temperature' ? 1 : 0),
      avg: (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(dataType === 'temperature' ? 1 : 0),
    }
  }, [records, dataType])

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部时间筛选 */}
      <div className="bg-card px-4 pt-4 pb-3 shadow-card">
        <div className="flex items-center gap-2 mb-3">
          {(['day', 'week', 'month'] as TimeRange[]).map(r => (
            <button
              key={r}
              type="button"
              className="flex-1 py-2 rounded-xl text-xl font-medium flex items-center justify-center leading-none btn-press"
              style={{
                background: timeRange === r ? 'var(--gradient-primary)' : 'hsl(var(--muted))',
                color: timeRange === r ? 'white' : 'hsl(var(--muted-foreground))',
              }}
              onClick={() => setTimeRange(r)}
            >
              {r === 'day' ? '日' : r === 'week' ? '周' : '月'}
            </button>
          ))}
          <div className="flex items-center gap-1 px-3 py-2 rounded-xl bg-muted">
            <div className="i-mdi-calendar-outline text-muted-foreground" style={{ fontSize: '18px' }} />
            <span className="text-xl text-muted-foreground">{selectedDate}</span>
          </div>
        </div>
        {/* 数据类型切换 */}
        <div className="flex items-center gap-2">
          {(Object.keys(DATA_TYPE_LABELS) as DataType[]).map(t => (
            <button
              key={t}
              type="button"
              className="flex-1 py-2 rounded-xl text-xl font-medium flex items-center justify-center leading-none btn-press"
              style={{
                backgroundColor: dataType === t ? `${DATA_TYPE_COLORS[t]}15` : 'hsl(var(--muted))',
                color: dataType === t ? DATA_TYPE_COLORS[t] : 'hsl(var(--muted-foreground))',
                border: dataType === t ? `1.5px solid ${DATA_TYPE_COLORS[t]}` : '1.5px solid transparent',
              }}
              onClick={() => setDataType(t)}
            >
              {DATA_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* 图表区域 */}
        <div className="bg-card rounded-2xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xl font-bold text-foreground">
              {DATA_TYPE_LABELS[dataType]} ({DATA_TYPE_UNITS[dataType]})
            </span>
            {stats && (
              <div className="flex items-center gap-3">
                <span className="text-xl text-muted-foreground">均值: <span className="font-bold" style={{ color: DATA_TYPE_COLORS[dataType] }}>{stats.avg}</span></span>
              </div>
            )}
          </div>
          {loadingRecords ? (
            <div className="flex items-center justify-center" style={{ height: '180px' }}>
              <div className="i-mdi-loading text-primary" style={{ fontSize: '32px' }} />
            </div>
          ) : (
            <MiniLineChart records={records} dataType={dataType} color={DATA_TYPE_COLORS[dataType]} />
          )}
          {stats && (
            <div className="flex items-center justify-around mt-3 pt-3" style={{ borderTop: '1px solid hsl(var(--border))' }}>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xl text-muted-foreground">最低</span>
                <span className="text-2xl font-bold" style={{ color: '#6366F1' }}>{stats.min}</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xl text-muted-foreground">平均</span>
                <span className="text-2xl font-bold" style={{ color: DATA_TYPE_COLORS[dataType] }}>{stats.avg}</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xl text-muted-foreground">最高</span>
                <span className="text-2xl font-bold" style={{ color: '#EF4444' }}>{stats.max}</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xl text-muted-foreground">记录数</span>
                <span className="text-2xl font-bold text-foreground">{records.length}</span>
              </div>
            </div>
          )}
        </div>

        {/* 报警事件记录 */}
        <div className="bg-card rounded-2xl overflow-hidden shadow-card">
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            <span className="text-2xl font-bold text-foreground">报警事件记录</span>
            <span className="text-xl text-muted-foreground">{alarms.length} 条</span>
          </div>

          {loadingAlarms ? (
            <div className="flex items-center justify-center py-10">
              <div className="i-mdi-loading text-primary" style={{ fontSize: '32px' }} />
            </div>
          ) : alarms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="i-mdi-check-circle text-primary" style={{ fontSize: '48px' }} />
              <span className="text-xl text-muted-foreground">暂无报警记录</span>
            </div>
          ) : (
            <div>
              {alarms.map((alarm, idx) => (
                <div
                  key={alarm.id}
                  className="px-4 py-4 flex items-center gap-3"
                  style={{ borderBottom: idx < alarms.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}
                  onClick={() => Taro.navigateTo({ url: `/pages/alarm-detail/index?alarmId=${encodeURIComponent(alarm.id)}` })}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${ALARM_TYPE_ICON_COLORS[alarm.alarm_type]}15` }}>
                    <div className={ALARM_TYPE_ICONS[alarm.alarm_type]} style={{ fontSize: '22px', color: ALARM_TYPE_ICON_COLORS[alarm.alarm_type] }} />
                  </div>
                  <div className="flex-1">
                    <span className="text-xl font-medium text-foreground block">{ALARM_TYPE_LABELS[alarm.alarm_type]}</span>
                    <span className="text-xl text-muted-foreground">{formatAlarmTime(alarm.created_at)}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xl font-bold" style={{ color: ALARM_TYPE_ICON_COLORS[alarm.alarm_type] }}>
                      {alarm.alarm_value || '--'}
                    </span>
                    <div className="flex items-center gap-1">
                      {alarm.is_confirmed ? (
                        <>
                          <div className="i-mdi-check-circle text-primary" style={{ fontSize: '14px' }} />
                          <span className="text-xl" style={{ color: 'hsl(var(--primary))' }}>已确认</span>
                        </>
                      ) : (
                        <>
                          <div className="i-mdi-chevron-right text-muted-foreground" style={{ fontSize: '18px' }} />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-center py-3">
                <span className="text-xl text-muted-foreground">点击记录查看数据快照</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default withRouteGuard(HistoryPage)
