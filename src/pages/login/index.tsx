// @title 用户登录
import { useState, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { useAuth } from '@/contexts/AuthContext'
import { STORAGE_KEY_REDIRECT_PATH } from '@/components/RouteGuard'

type LoginMode = 'password' | 'otp'

export default function LoginPage() {
  const { signInWithUsername, signUpWithUsername, signInWithPhone, verifyPhoneOtp } = useAuth()

  const [mode, setMode] = useState<LoginMode>('password')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)

  // 账号密码
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [isRegister, setIsRegister] = useState(false)

  // 手机验证码
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const redirectAfterLogin = useCallback(() => {
    const redirectPath = Taro.getStorageSync(STORAGE_KEY_REDIRECT_PATH) as string
    Taro.removeStorageSync(STORAGE_KEY_REDIRECT_PATH)
    const tabBarPaths = ['/pages/monitor/index', '/pages/history/index', '/pages/profile/index']
    const normalized = redirectPath
      ? (redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`)
      : '/pages/monitor/index'
    // 退出登录保存的是 profile 路径，登录后应回到实时监测页而非我的页面
    const target = normalized === '/pages/profile/index' ? '/pages/monitor/index' : normalized
    if (tabBarPaths.includes(target)) {
      Taro.switchTab({ url: target })
    } else {
      Taro.redirectTo({ url: target })
    }
  }, [])

  const startCountdown = useCallback(() => {
    setCountdown(60)
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timer); return 0 }
        return c - 1
      })
    }, 1000)
  }, [])

  const handleSendOtp = useCallback(async () => {
    if (!phone || phone.length !== 11) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!agreed) {
      Taro.showToast({ title: '请先同意用户协议', icon: 'none' })
      return
    }
    setLoading(true)
    const { error } = await signInWithPhone(phone)
    setLoading(false)
    if (error) {
      Taro.showToast({ title: '发送失败，请稍后重试', icon: 'none' })
    } else {
      setOtpSent(true)
      startCountdown()
      Taro.showToast({ title: '验证码已发送', icon: 'success' })
    }
  }, [phone, agreed, signInWithPhone, startCountdown])

  const handleOtpLogin = useCallback(async () => {
    if (!otp || otp.length < 4) {
      Taro.showToast({ title: '请输入验证码', icon: 'none' })
      return
    }
    setLoading(true)
    const { error } = await verifyPhoneOtp(phone, otp)
    setLoading(false)
    if (error) {
      Taro.showToast({ title: '验证码错误，请重试', icon: 'none' })
    } else {
      redirectAfterLogin()
    }
  }, [otp, phone, verifyPhoneOtp, redirectAfterLogin])

  const handlePasswordAction = useCallback(async () => {
    if (!username.trim()) {
      Taro.showToast({ title: '请输入账号', icon: 'none' })
      return
    }
    if (!password) {
      Taro.showToast({ title: '请输入密码', icon: 'none' })
      return
    }
    if (!agreed) {
      Taro.showToast({ title: '请先同意用户协议', icon: 'none' })
      return
    }
    setLoading(true)
    if (isRegister) {
      if (password.length < 6) {
        Taro.showToast({ title: '密码至少6位', icon: 'none' })
        setLoading(false)
        return
      }
      const { error } = await signUpWithUsername(username.trim(), password)
      setLoading(false)
      if (error) {
        Taro.showToast({ title: error.message.includes('already') ? '账号已存在' : '注册失败', icon: 'none' })
      } else {
        Taro.showToast({ title: '注册成功，正在登录', icon: 'success' })
        setTimeout(() => redirectAfterLogin(), 1000)
      }
    } else {
      const { error } = await signInWithUsername(username.trim(), password)
      setLoading(false)
      if (error) {
        Taro.showToast({ title: '账号或密码错误', icon: 'none' })
      } else {
        redirectAfterLogin()
      }
    }
  }, [username, password, agreed, isRegister, signInWithUsername, signUpWithUsername, redirectAfterLogin])

  return (
    <div className="min-h-screen bg-gradient-hero flex flex-col">
      {/* 顶部品牌区 */}
      <div className="flex flex-col items-center pt-16 pb-10 px-6">
        <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mb-4">
          <div className="i-mdi-shield-heart text-white" style={{ fontSize: '48px' }} />
        </div>
        <p className="text-white text-2xl font-bold tracking-wide">欢迎使用</p>
        <p className="text-white/80 text-xl mt-1">智慧养老健康监护系统</p>
      </div>

      {/* 登录卡片 */}
      <div className="flex-1 bg-background rounded-t-3xl px-6 pt-8 pb-6">
        {/* Tab 切换 */}
        <div className="flex border-b border-border mb-8">
          <button
            type="button"
            className="flex-1 pb-3 text-2xl font-medium flex items-center justify-center leading-none btn-press"
            style={{ color: mode === 'password' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))', borderBottom: mode === 'password' ? '2px solid hsl(var(--primary))' : '2px solid transparent' }}
            onClick={() => setMode('password')}
          >
            账号登录
          </button>
          <button
            type="button"
            className="flex-1 pb-3 text-2xl font-medium flex items-center justify-center leading-none btn-press"
            style={{ color: mode === 'otp' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))', borderBottom: mode === 'otp' ? '2px solid hsl(var(--primary))' : '2px solid transparent' }}
            onClick={() => setMode('otp')}
          >
            验证码登录
          </button>
        </div>

        {/* 账号密码模式 */}
        {mode === 'password' && (
          <div className="flex flex-col gap-4">
            <div className="border border-border rounded-xl px-4 py-3 bg-card overflow-hidden flex items-center gap-3">
              <div className="i-mdi-account-outline text-muted-foreground" style={{ fontSize: '24px', flexShrink: 0 }} />
              <input
                className="flex-1 text-xl text-foreground bg-transparent outline-none"
                placeholder="请输入账号"
                value={username}
                onInput={(e) => { const ev = e as any; setUsername(ev.detail?.value ?? ev.target?.value ?? '') }}
              />
            </div>
            <div className="border border-border rounded-xl px-4 py-3 bg-card overflow-hidden flex items-center gap-3">
              <div className="i-mdi-lock-outline text-muted-foreground" style={{ fontSize: '24px', flexShrink: 0 }} />
              <input
                className="flex-1 text-xl text-foreground bg-transparent outline-none"
                placeholder="请输入密码"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onInput={(e) => { const ev = e as any; setPassword(ev.detail?.value ?? ev.target?.value ?? '') }}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="flex items-center justify-center">
                <div className={showPassword ? 'i-mdi-eye-outline text-muted-foreground' : 'i-mdi-eye-off-outline text-muted-foreground'} style={{ fontSize: '22px' }} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2" onClick={() => setRememberMe(!rememberMe)}>
                <div className="w-5 h-5 rounded border-2 flex items-center justify-center" style={{ borderColor: rememberMe ? 'hsl(var(--primary))' : 'hsl(var(--border))', backgroundColor: rememberMe ? 'hsl(var(--primary))' : 'transparent' }}>
                  {rememberMe && <div className="i-mdi-check text-white" style={{ fontSize: '14px' }} />}
                </div>
                <span className="text-xl text-muted-foreground">记住密码</span>
              </div>
              <span className="text-xl text-primary">忘记密码？</span>
            </div>
          </div>
        )}

        {/* 手机验证码模式 */}
        {mode === 'otp' && (
          <div className="flex flex-col gap-4">
            <div className="border border-border rounded-xl px-4 py-3 bg-card overflow-hidden flex items-center gap-3">
              <div className="i-mdi-phone-outline text-muted-foreground" style={{ fontSize: '24px', flexShrink: 0 }} />
              <input
                className="flex-1 text-xl text-foreground bg-transparent outline-none"
                placeholder="请输入手机号"
                type="number"
                maxLength={11}
                value={phone}
                onInput={(e) => { const ev = e as any; setPhone(ev.detail?.value ?? ev.target?.value ?? '') }}
              />
            </div>
            <div className="border border-border rounded-xl px-4 py-3 bg-card overflow-hidden flex items-center gap-3">
              <div className="i-mdi-shield-key-outline text-muted-foreground" style={{ fontSize: '24px', flexShrink: 0 }} />
              <input
                className="flex-1 text-xl text-foreground bg-transparent outline-none"
                placeholder="请输入验证码"
                type="number"
                maxLength={6}
                value={otp}
                onInput={(e) => { const ev = e as any; setOtp(ev.detail?.value ?? ev.target?.value ?? '') }}
              />
              <button
                type="button"
                className="flex items-center justify-center leading-none text-xl break-keep px-3 py-1 rounded-lg"
                style={{
                  color: countdown > 0 || loading ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))',
                  backgroundColor: countdown > 0 || loading ? 'hsl(var(--muted))' : 'hsl(var(--accent))'
                }}
                onClick={countdown > 0 || loading ? undefined : handleSendOtp}
              >
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          </div>
        )}

        {/* 用户协议 */}
        <div className="flex items-center gap-2 mt-6" onClick={() => setAgreed(!agreed)}>
          <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0"
            style={{ borderColor: agreed ? 'hsl(var(--primary))' : 'hsl(var(--border))', backgroundColor: agreed ? 'hsl(var(--primary))' : 'transparent' }}>
            {agreed && <div className="i-mdi-check text-white" style={{ fontSize: '14px' }} />}
          </div>
          <div className="flex flex-wrap items-center text-xl text-muted-foreground">
            <span>我已阅读并同意</span>
            <span className="text-primary">《用户协议》</span>
            <span>和</span>
            <span className="text-primary">《隐私政策》</span>
          </div>
        </div>

        {/* 主操作按钮 */}
        <div className="mt-6">
          <button
            type="button"
            className="w-full rounded-xl text-2xl font-bold flex items-center justify-center leading-none btn-press"
            style={{
              background: loading ? 'hsl(var(--muted))' : 'var(--gradient-primary)',
              color: loading ? 'hsl(var(--muted-foreground))' : 'white',
              padding: '0',
            }}
            onClick={mode === 'otp' ? (otpSent ? handleOtpLogin : handleSendOtp) : handlePasswordAction}
          >
            <div className="py-4 w-full flex items-center justify-center">
              {loading ? '处理中...' : (mode === 'otp' ? (otpSent ? '立即登录' : '获取验证码') : (isRegister ? '立即注册' : '登录'))}
            </div>
          </button>
        </div>

        {/* 注册/登录切换 */}
        {mode === 'password' && (
          <div className="flex items-center justify-center mt-6 gap-1">
            <span className="text-xl text-muted-foreground">{isRegister ? '已有账号？' : '还没有账号？'}</span>
            <span className="text-xl text-primary font-medium" onClick={() => setIsRegister(!isRegister)}>
              {isRegister ? '立即登录' : '立即注册'}
            </span>
          </div>
        )}

        {/* 演示账号快速登录 */}
        {mode === 'password' && !isRegister && (
          <div className="mt-6 border border-dashed border-primary/40 rounded-2xl px-5 py-4 bg-primary/5">
            <div className="flex items-center gap-2 mb-3">
              <div className="i-mdi-flask-outline text-primary" style={{ fontSize: '18px' }} />
              <span className="text-xl font-semibold text-primary">体验演示账号</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xl text-muted-foreground">账号：<span className="text-foreground font-medium">demo</span></span>
                <span className="text-xl text-muted-foreground">密码：<span className="text-foreground font-medium">demo123456</span></span>
              </div>
              <button
                type="button"
                className="flex items-center justify-center leading-none px-4 rounded-xl bg-primary text-white text-xl font-medium"
                onClick={() => {
                  setUsername('demo')
                  setPassword('demo123456')
                  setAgreed(true)
                }}
              >
                <div style={{ padding: '10px 0' }}>一键填入</div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
