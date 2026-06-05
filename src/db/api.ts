import { supabase } from '@/client/supabase'
import type { Profile, HealthRecord, AlarmRecord, Device, AlarmType, AlarmLevel } from './types'

const DEVICE_ID = 'device-001'

// ========== 设备 ==========
export async function getDevice(): Promise<Device | null> {
  const { data } = await supabase
    .from('devices')
    .select('*')
    .eq('id', DEVICE_ID)
    .maybeSingle()
  return data
}

/** 保存设备 IoT 配置（ProductKey + DeviceName） */
export async function saveDeviceIotConfig(config: {
  product_key: string
  device_name_iot: string
  connect_status: 'connected' | 'failed' | 'unknown'
  is_online?: boolean
}): Promise<void> {
  await supabase.from('devices').upsert({
    id: DEVICE_ID,
    product_key: config.product_key,
    device_name_iot: config.device_name_iot,
    connect_status: config.connect_status,
    is_online: config.is_online ?? false,
    last_connected_at: config.connect_status === 'connected' ? new Date().toISOString() : undefined,
  })
}

/** 测试阿里云 IoT 设备连接 */
export async function testAliyunDeviceConnection(
  productKey: string,
  deviceName: string
): Promise<{ success: boolean; online?: boolean; deviceInfo?: Record<string, unknown>; error?: string }> {
  const { data, error } = await supabase.functions.invoke('aliyun-iot', {
    body: { action: 'getDeviceInfo', productKey, deviceName },
  })
  if (error) {
    const msg = await error?.context?.text?.()
    return { success: false, error: msg || error.message }
  }
  if (!data?.success) {
    return { success: false, error: data?.error || '连接失败，请检查 ProductKey 和 DeviceName' }
  }
  const deviceInfo = data?.data?.Data || {}
  // QueryDeviceDetail 返回 Data.Status；QueryDeviceInfo 返回 Data.DeviceInfo.DeviceStatus
  const status = deviceInfo?.Status ?? deviceInfo?.DeviceInfo?.DeviceStatus
  return { success: true, online: status === 'ONLINE', deviceInfo }
}

// ========== 健康数据 ==========
/** 获取最新一条健康数据 */
export async function getLatestHealthRecord(): Promise<HealthRecord | null> {
  const { data } = await supabase
    .from('health_records')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

/** 查询历史健康数据（分页+时间范围） */
export async function getHealthRecords(options: {
  startTime: string
  endTime: string
  limit?: number
}): Promise<HealthRecord[]> {
  const { startTime, endTime, limit = 200 } = options
  const { data } = await supabase
    .from('health_records')
    .select('id, device_id, heart_rate, blood_oxygen, temperature, fall_detected, smoke_value, smoke_alarm, created_at')
    .eq('device_id', DEVICE_ID)
    .gte('created_at', startTime)
    .lte('created_at', endTime)
    .order('created_at', { ascending: true })
    .limit(limit)
  return Array.isArray(data) ? data : []
}

/** 插入一条健康数据（模拟设备上报） */
export async function insertHealthRecord(record: Partial<HealthRecord>): Promise<void> {
  await supabase.from('health_records').insert({
    device_id: DEVICE_ID,
    heart_rate: record.heart_rate ?? null,
    blood_oxygen: record.blood_oxygen ?? null,
    temperature: record.temperature ?? null,
    fall_detected: record.fall_detected ?? false,
    smoke_value: record.smoke_value ?? null,
    smoke_alarm: record.smoke_alarm ?? false,
  })
}

// ========== 报警记录 ==========
/** 获取报警记录列表 */
export async function getAlarmRecords(options?: {
  limit?: number
  offset?: number
}): Promise<AlarmRecord[]> {
  const { limit = 30, offset = 0 } = options || {}
  const { data } = await supabase
    .from('alarm_records')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  return Array.isArray(data) ? data : []
}

/** 按 ID 查询单条报警记录 */
export async function getAlarmById(id: string): Promise<AlarmRecord | null> {
  const { data } = await supabase
    .from('alarm_records')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return data
}

/** 查询距离指定时间最近的健康数据记录（±10分钟范围） */
export async function getHealthRecordNearTime(isoTime: string): Promise<HealthRecord | null> {
  const t = new Date(isoTime)
  const before = new Date(t.getTime() - 10 * 60 * 1000).toISOString()
  const after = new Date(t.getTime() + 10 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('health_records')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .gte('created_at', before)
    .lte('created_at', after)
    .order('created_at', { ascending: false })
    .limit(20)
  if (!Array.isArray(data) || data.length === 0) return null
  // 找离报警时间最近的那条
  return data.reduce((closest, rec) => {
    const d1 = Math.abs(new Date(rec.created_at).getTime() - t.getTime())
    const d2 = Math.abs(new Date(closest.created_at).getTime() - t.getTime())
    return d1 < d2 ? rec : closest
  })
}

/** 获取未确认报警（用于弹窗提醒） */
export async function getUnconfirmedAlarms(): Promise<AlarmRecord[]> {
  const { data } = await supabase
    .from('alarm_records')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .eq('is_confirmed', false)
    .order('created_at', { ascending: false })
    .limit(10)
  return Array.isArray(data) ? data : []
}

/** 确认报警 */
export async function confirmAlarm(alarmId: string): Promise<void> {
  await supabase
    .from('alarm_records')
    .update({ is_confirmed: true, confirmed_at: new Date().toISOString() })
    .eq('id', alarmId)
}

/** 插入新报警记录 */
export async function insertAlarmRecord(alarm: {
  alarm_type: AlarmType
  alarm_value: string
  alarm_level: AlarmLevel
}): Promise<void> {
  await supabase.from('alarm_records').insert({
    device_id: DEVICE_ID,
    alarm_type: alarm.alarm_type,
    alarm_value: alarm.alarm_value,
    alarm_level: alarm.alarm_level,
    is_confirmed: false,
  })
}

// ========== 用户档案 ==========
/** 获取用户档案（含阈值设置） */
export async function getUserProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  return data
}

/** 更新用户阈值设置 */
export async function updateUserThresholds(userId: string, thresholds: {
  heart_rate_max: number
  heart_rate_min: number
  blood_oxygen_min: number
  temperature_max: number
  temperature_min: number
}): Promise<void> {
  await supabase
    .from('profiles')
    .update({
      heart_rate_max: thresholds.heart_rate_max,
      heart_rate_min: thresholds.heart_rate_min,
      blood_oxygen_min: thresholds.blood_oxygen_min,
      temperature_max: thresholds.temperature_max,
      temperature_min: thresholds.temperature_min,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
}

/** 更新用户基本信息 */
export async function updateUserProfile(userId: string, updates: {
  nickname?: string
  avatar_url?: string
}): Promise<void> {
  await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
}

// ========== 阿里云 IoT 平台 ==========

/**
 * 查询阿里云设备当前属性快照
 * 返回设备上报的最新体征数据（直接来自阿里云，非 Supabase）
 */
export async function aliyunGetDeviceProperty(): Promise<{
  success: boolean
  data?: Record<string, { value: unknown; time: number }>
  error?: string
}> {
  const { data, error } = await supabase.functions.invoke('aliyun-iot', {
    body: { action: 'getProperty' },
  })
  if (error) {
    const msg = await error?.context?.text?.()
    return { success: false, error: msg || error.message }
  }
  return { success: true, data: data?.data?.Data?.List?.PropertyStatusInfo }
}

/**
 * 查询阿里云设备信息（在线状态）
 */
export async function aliyunGetDeviceInfo(): Promise<{
  success: boolean
  online?: boolean
  error?: string
}> {
  const { data, error } = await supabase.functions.invoke('aliyun-iot', {
    body: { action: 'getDeviceInfo' },
  })
  if (error) {
    const msg = await error?.context?.text?.()
    return { success: false, error: msg || error.message }
  }
  if (!data?.success) return { success: false, error: data?.error }
  // QueryDeviceDetail 返回 Data.Status；兼容旧路径 Data.DeviceInfo.DeviceStatus
  const d = data?.data?.Data || {}
  const status = d?.Status ?? d?.DeviceInfo?.DeviceStatus
  return { success: true, online: status === 'ONLINE' }
}

/**
 * 下发属性设置到阿里云设备（更改阈值等）
 * properties 的 key 需与阿里云物模型中定义的属性标识符一致
 * 例如：{ HeartRateMax: 100, HeartRateMin: 50, ... }
 * productKey/deviceName 可选，不传时 Edge Function 从环境变量读取
 */
export async function aliyunSetDeviceProperty(
  properties: Record<string, number | boolean | string>,
  opts?: { productKey?: string; deviceName?: string }
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('aliyun-iot', {
    body: {
      action: 'setProperty',
      properties,
      ...(opts?.productKey ? { productKey: opts.productKey } : {}),
      ...(opts?.deviceName ? { deviceName: opts.deviceName } : {}),
    },
  })
  if (error) {
    const msg = await error?.context?.text?.()
    return { success: false, error: msg || error.message }
  }
  return { success: data?.success === true, error: data?.error }
}
