/**
 * aliyun-ingest
 * 阿里云物联网规则引擎 Webhook 接收函数
 * 用途：接收阿里云物联网平台通过规则引擎转发的设备数据，写入 Supabase 数据库
 *
 * 规则引擎配置（在阿里云控制台填写）：
 *   转发目标：HTTP 服务
 *   URL：https://<project>.supabase.co/functions/v1/aliyun-ingest
 *   Header：x-ingest-secret: <INGEST_SECRET>
 *
 * 规则引擎 SQL（参考）：
 *   SELECT
 *     deviceName() AS device_name,
 *     heart_rate, blood_oxygen, temperature,
 *     fall_detected, smoke_value, smoke_alarm,
 *     timestamp() AS ts
 *   FROM "/ProductKey/+/thing/event/property/post"
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const DEVICE_ID = 'device-001'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 可选：校验 Ingest Secret 防止伪造请求
    const ingestSecret = Deno.env.get('INGEST_SECRET')
    if (ingestSecret) {
      const reqSecret = req.headers.get('x-ingest-secret')
      if (reqSecret !== ingestSecret) {
        return new Response(JSON.stringify({ error: '401 Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const body = await req.json()

    // 阿里云规则引擎转发的数据结构
    // body 可能是单条或数组
    const records = Array.isArray(body) ? body : [body]

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    for (const record of records) {
      const {
        heart_rate,
        blood_oxygen,
        temperature,
        fall_detected,
        smoke_value,
        smoke_alarm,
        // 阿里云物模型字段名可能不同，做兼容处理
        HeartRate, BloodOxygen, Temperature,
        FallDetected, SmokeValue, SmokeAlarm,
      } = record

      const hr = heart_rate ?? HeartRate ?? null
      const bo = blood_oxygen ?? BloodOxygen ?? null
      const temp = temperature ?? Temperature ?? null
      const fall = fall_detected ?? FallDetected ?? false
      const smoke = smoke_value ?? SmokeValue ?? null
      const smokeAlarm = smoke_alarm ?? SmokeAlarm ?? false

      // 写入健康数据
      const { error: insertError } = await supabase.from('health_records').insert({
        device_id: DEVICE_ID,
        heart_rate: hr,
        blood_oxygen: bo,
        temperature: temp,
        fall_detected: fall,
        smoke_value: smoke,
        smoke_alarm: smokeAlarm,
      })

      if (insertError) {
        console.error('Insert health_record error:', insertError)
      }

      // 更新设备在线状态
      await supabase.from('devices')
        .update({ is_online: true, last_seen: new Date().toISOString() })
        .eq('id', DEVICE_ID)

      // 自动生成告警记录
      const defaultThresholds = {
        heart_rate_max: 100, heart_rate_min: 50,
        blood_oxygen_min: 90,
        temperature_max: 37.5, temperature_min: 35.0,
      }

      if (fall) {
        await supabase.from('alarm_records').insert({
          device_id: DEVICE_ID, alarm_type: 'fall',
          alarm_value: '跌倒检测', alarm_level: 'high', is_confirmed: false,
        })
      }
      if (smokeAlarm) {
        await supabase.from('alarm_records').insert({
          device_id: DEVICE_ID, alarm_type: 'smoke',
          alarm_value: `烟雾值${smoke}`, alarm_level: 'high', is_confirmed: false,
        })
      }
      if (hr !== null && hr > defaultThresholds.heart_rate_max) {
        await supabase.from('alarm_records').insert({
          device_id: DEVICE_ID, alarm_type: 'heart_rate_high',
          alarm_value: `${hr}次/分`, alarm_level: 'medium', is_confirmed: false,
        })
      }
      if (hr !== null && hr < defaultThresholds.heart_rate_min) {
        await supabase.from('alarm_records').insert({
          device_id: DEVICE_ID, alarm_type: 'heart_rate_low',
          alarm_value: `${hr}次/分`, alarm_level: 'medium', is_confirmed: false,
        })
      }
      if (bo !== null && bo < defaultThresholds.blood_oxygen_min) {
        await supabase.from('alarm_records').insert({
          device_id: DEVICE_ID, alarm_type: 'blood_oxygen_low',
          alarm_value: `${bo}%`, alarm_level: bo < 85 ? 'high' : 'medium', is_confirmed: false,
        })
      }
      if (temp !== null && temp > defaultThresholds.temperature_max) {
        await supabase.from('alarm_records').insert({
          device_id: DEVICE_ID, alarm_type: 'temperature_high',
          alarm_value: `${temp}°C`, alarm_level: 'medium', is_confirmed: false,
        })
      }
    }

    return new Response(JSON.stringify({ success: true, count: records.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('aliyun-ingest error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
