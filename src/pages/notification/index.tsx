// @title 通知设置
import { useState, useCallback, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { withRouteGuard } from '@/components/RouteGuard'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/client/supabase'

interface NotifSettings {
  alarm_push: boolean
  alarm_sound: boolean
  alarm_vibrate: boolean
  daily_report: boolean
  offline_alert: boolean
  low_battery_alert: boolean
}

const DEFAULT_SETTINGS: NotifSettings = {
  alarm_push: true,
  alarm_sound: true,
  alarm_vibrate: true,
  daily_report: false,
  offline_alert: true,
  low_battery_alert: true,
}

const SETTINGS_KEY = 'notif_settings'

function NotificationPage() {
  const { user } = useAuth()
  const [settings, setSettings] = useState<NotifSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)

  // 通知设置存储在 Supabase profiles 的 extra 字段中，fallback 到本地
  const loadSettings = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('profiles')
      .select('notif_settings')
      .eq('id', user.id)
      .maybeSingle()
    if (data?.notif_settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...data.notif_settings })
    } else {
      // 从本地读取
      try {
        const local = Taro.getStorageSync(SETTINGS_KEY)
        if (local) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(local) })
      } catch (_) { /* ignore */ }
    }
  }, [user])

  useEffect(() => { loadSettings() }, [loadSettings])

  const toggle = useCallback((key: keyof NotifSettings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    // 先存本地
    Taro.setStorageSync(SETTINGS_KEY, JSON.stringify(settings))
    // 尝试同步到 profiles（字段不存在则静默忽略错误）
    await supabase
      .from('profiles')
      .update({ notif_settings: settings } as any)
      .eq('id', user!.id)
    setSaving(false)
    Taro.showToast({ title: '设置已保存', icon: 'success' })
  }, [settings, user])

  const SwitchRow = ({
    icon,
    label,
    desc,
    field,
    disabled,
  }: {
    icon: string
    label: string
    desc?: string
    field: keyof NotifSettings
    disabled?: boolean
  }) => (
    <div className={`flex items-center gap-4 py-4 ${disabled ? 'opacity-50' : ''}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-primary/10`}>
        <div className={`${icon} text-primary`} style={{ fontSize: '20px' }} />
      </div>
      <div className="flex-1">
        <p className="text-2xl text-foreground font-medium">{label}</p>
        {desc && <p className="text-xl text-muted-foreground">{desc}</p>}
      </div>
      <div
        className={`w-12 h-7 rounded-full transition flex items-center px-1 ${settings[field] && !disabled ? 'bg-primary' : 'bg-muted'}`}
        onClick={() => !disabled && toggle(field)}
      >
        <div
          className={`w-5 h-5 bg-white rounded-full transition shadow-sm ${settings[field] && !disabled ? 'ml-auto' : ''}`}
        />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* 页头 */}
      <div className="bg-gradient-primary px-6 pt-8 pb-10">
        <div className="flex items-center gap-3 mb-1">
          <div className="i-mdi-bell-outline text-white" style={{ fontSize: '28px' }} />
          <span className="text-3xl font-bold text-white">消息通知</span>
        </div>
        <p className="text-xl text-white/80 ml-1">配置告警推送与提醒方式</p>
      </div>

      <div className="px-4 -mt-6 flex flex-col gap-4">
        {/* 告警通知 */}
        <div className="bg-card rounded-2xl shadow-card px-5">
          <div className="flex items-center gap-2 py-4 border-b border-border">
            <div className="i-mdi-bell-ring-outline text-primary" style={{ fontSize: '18px' }} />
            <span className="text-xl font-semibold text-primary">告警通知</span>
          </div>
          <SwitchRow
            icon="i-mdi-message-alert-outline"
            label="消息推送"
            desc="体征异常时向微信推送告警"
            field="alarm_push"
          />
          <div className="border-b border-border" />
          <SwitchRow
            icon="i-mdi-volume-high"
            label="告警铃声"
            desc="收到告警时播放提示音"
            field="alarm_sound"
            disabled={!settings.alarm_push}
          />
          <div className="border-b border-border" />
          <SwitchRow
            icon="i-mdi-vibrate"
            label="震动提醒"
            desc="收到告警时震动提示"
            field="alarm_vibrate"
            disabled={!settings.alarm_push}
          />
        </div>

        {/* 设备状态通知 */}
        <div className="bg-card rounded-2xl shadow-card px-5">
          <div className="flex items-center gap-2 py-4 border-b border-border">
            <div className="i-mdi-devices text-primary" style={{ fontSize: '18px' }} />
            <span className="text-xl font-semibold text-primary">设备状态</span>
          </div>
          <SwitchRow
            icon="i-mdi-wifi-off"
            label="设备离线提醒"
            desc="监护设备断网时通知"
            field="offline_alert"
          />
          <div className="border-b border-border" />
          <SwitchRow
            icon="i-mdi-battery-low"
            label="低电量提醒"
            desc="设备电量不足20%时通知"
            field="low_battery_alert"
          />
        </div>

        {/* 日报 */}
        <div className="bg-card rounded-2xl shadow-card px-5">
          <div className="flex items-center gap-2 py-4 border-b border-border">
            <div className="i-mdi-file-chart-outline text-primary" style={{ fontSize: '18px' }} />
            <span className="text-xl font-semibold text-primary">健康日报</span>
          </div>
          <SwitchRow
            icon="i-mdi-calendar-check-outline"
            label="每日健康摘要"
            desc="每晚9点发送当日体征报告"
            field="daily_report"
          />
        </div>

        {/* 保存按钮 */}
        <button
          type="button"
          className={`w-full flex items-center justify-center leading-none rounded-2xl text-2xl font-semibold text-white mb-6 ${saving ? 'bg-primary/50' : 'bg-gradient-primary'}`}
          onClick={handleSave}
        >
          <div style={{ padding: '14px 0' }}>
            {saving ? '保存中...' : '保存设置'}
          </div>
        </button>
      </div>
    </div>
  )
}

export default withRouteGuard(NotificationPage)
