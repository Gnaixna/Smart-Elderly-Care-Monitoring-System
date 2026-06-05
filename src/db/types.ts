// 数据库类型定义

export type UserRole = 'user' | 'admin'

export interface Profile {
  id: string
  username: string | null
  phone: string | null
  nickname: string | null
  avatar_url: string | null
  role: UserRole
  openid: string | null
  // 预警阈值
  heart_rate_max: number
  heart_rate_min: number
  blood_oxygen_min: number
  temperature_max: number
  temperature_min: number
  created_at: string
  updated_at: string
}

export interface HealthRecord {
  id: string
  device_id: string
  heart_rate: number | null
  blood_oxygen: number | null
  temperature: number | null
  fall_detected: boolean
  smoke_value: number | null
  smoke_alarm: boolean
  created_at: string
}

export type AlarmType =
  | 'fall'
  | 'heart_rate_high'
  | 'heart_rate_low'
  | 'blood_oxygen_low'
  | 'temperature_high'
  | 'temperature_low'
  | 'smoke'

export type AlarmLevel = 'low' | 'medium' | 'high'

export interface AlarmRecord {
  id: string
  device_id: string
  alarm_type: AlarmType
  alarm_value: string | null
  alarm_level: AlarmLevel
  is_confirmed: boolean
  confirmed_at: string | null
  created_at: string
}

export interface Device {
  id: string
  name: string
  is_online: boolean
  last_seen_at: string
  created_at: string
  product_key: string | null
  device_name_iot: string | null
  connect_status: 'unknown' | 'connected' | 'failed' | null
  last_connected_at: string | null
}

// 报警类型中文映射
export const ALARM_TYPE_LABELS: Record<AlarmType, string> = {
  fall: '跌倒报警',
  heart_rate_high: '心率过高',
  heart_rate_low: '心率过低',
  blood_oxygen_low: '血氧过低',
  temperature_high: '体温过高',
  temperature_low: '体温过低',
  smoke: '烟雾异常',
}

// 默认阈值
export const DEFAULT_THRESHOLDS = {
  heart_rate_max: 110,
  heart_rate_min: 50,
  blood_oxygen_min: 92,
  temperature_max: 37.5,
  temperature_min: 36.0,
}
