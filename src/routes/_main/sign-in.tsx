import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { authClient, signIn, signUp } from '../../lib/auth-client'
import ThemeToggle from '../../components/ThemeToggle'

const INTRO =
  'See the ground from your window when you fly: sync flight tracks, and go offline. Sign in to sync preferences across devices later.'

export const Route = createFileRoute('/_main/sign-in')({
  component: SignInPage,
})

type Tab = 'password' | 'magic'

function SignInPage() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [tab, setTab] = useState<Tab>('password')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false)
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false)

  const handleGoogleSignIn = useCallback(async () => {
    const publicAppUrl = import.meta.env.VITE_PUBLIC_APP_URL as
      | string
      | undefined
    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1')
    if (isLocalhost && publicAppUrl) {
      const target = new URL(publicAppUrl)
      if (target.origin !== window.location.origin) {
        window.location.href = `${target.origin}/sign-in?continue=google`
        return
      }
    }
    setLoading(true)
    try {
      const result = await signIn.social({
        provider: 'google',
        callbackURL: '/',
      })
      if (result.error) {
        toast.error(result.error.message ?? 'Google sign in failed')
      }
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Google sign in failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('continue') === 'google') {
      window.history.replaceState({}, '', window.location.pathname)
      void handleGoogleSignIn()
    }
  }, [handleGoogleSignIn])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'sign-in') {
        if (tab === 'password') {
          const result = await signIn.email({
            email,
            password,
            callbackURL: '/',
          })
          if (result.error) {
            const st = (result.error as { status?: number }).status
            if (st === 403) {
              toast.error('Please verify your email first (check your inbox).')
            } else {
              toast.error(result.error.message ?? 'Sign in failed')
            }
            return
          }
          toast.success('Signed in')
          window.location.href = '/'
        } else {
          const result = await signIn.magicLink({
            email,
            callbackURL: '/',
          })
          if (result.error) {
            toast.error(result.error.message ?? 'Magic link failed')
            return
          }
          toast.success('Check your email for the sign-in link')
        }
      } else {
        const result = await signUp.email({
          email,
          password,
          name: name || email,
          callbackURL: '/',
        })
        if (result.error) {
          toast.error(result.error.message ?? 'Sign up failed')
          return
        }
        toast.success(
          'Account created. Check your email to verify if required.',
        )
        setMode('sign-in')
        setTab('password')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!forgotPasswordEmail.trim()) {
      toast.error('Enter your email')
      return
    }
    setForgotPasswordLoading(true)
    try {
      const redirectTo = `${window.location.origin}/reset-password`
      const result = await authClient.requestPasswordReset({
        email: forgotPasswordEmail.trim(),
        redirectTo,
      })
      if (result.error) {
        toast.error(result.error.message ?? 'Failed to send reset link')
        return
      }
      setForgotPasswordSent(true)
      toast.success('Check your email for the reset link')
    } finally {
      setForgotPasswordLoading(false)
    }
  }

  const resendVerification = async () => {
    if (!email.trim()) {
      toast.error('Enter your email')
      return
    }
    setLoading(true)
    try {
      const result = await authClient.sendVerificationEmail({
        email: email.trim(),
        callbackURL: '/',
      })
      if (result.error) {
        toast.error(result.error.message ?? 'Could not send verification email')
        return
      }
      toast.success('Verification email sent')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex">
      <div className="hidden lg:flex lg:w-1/3 flex-col justify-between p-12 relative overflow-hidden bg-slate-950">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full opacity-5 bg-white" />
        <div className="absolute -bottom-32 -right-16 size-[28rem] rounded-full opacity-5 bg-white" />

        <Link
          to="/"
          className="text-sm text-slate-500 hover:text-slate-300 relative z-10"
        >
          <div className="flex items-center gap-3">
            <img
              src="/favicon.ico"
              alt=""
              className="w-10 h-10 rounded-xl"
              width={40}
              height={40}
            />
            <span className="text-white font-semibold text-lg tracking-wide">
              travelmode.live
            </span>
          </div>
        </Link>

        <div className="relative z-10">
          <h1
            className="text-white mb-4"
            style={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.2 }}
          >
            {mode === 'sign-in' ? 'Welcome back to' : 'Get started with'}
            <br />
            <span className="text-slate-400">Travelmode</span>
          </h1>
          <p className="text-slate-400 max-w-xs" style={{ lineHeight: 1.6 }}>
            {INTRO}
          </p>
        </div>

        <div className="relative z-10 flex gap-4 text-sm">
          <Link
            to="/about"
            className="text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2"
          >
            About
          </Link>
        </div>
      </div>

      <div className="flex-1 flex min-w-0">
        <div className="flex-1 flex items-center justify-center bg-[var(--bg-base)] px-6 py-12">
          <div className="w-full max-w-md">
            <div className="flex lg:hidden items-center justify-between gap-3 mb-10">
              <div className="flex items-center gap-3">
                <img
                  src="/favicon.ico"
                  alt=""
                  className="w-9 h-9 rounded-xl"
                  width={36}
                  height={36}
                />
                <span className="font-semibold text-lg text-[var(--sea-ink)]">
                  travelmode
                </span>
              </div>
              <ThemeToggle />
            </div>

            <div className="mb-8">
              <h2
                className="text-[var(--sea-ink)] mb-2"
                style={{ fontSize: '1.875rem', fontWeight: 700 }}
              >
                {mode === 'sign-in' ? 'Sign in' : 'Create account'}
              </h2>
              <p className="text-[var(--sea-ink-soft)]">
                {mode === 'sign-in' ? (
                  <>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      className="font-medium text-[var(--sea-ink)] underline"
                      onClick={() => setMode('sign-up')}
                    >
                      Register
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      className="font-medium text-[var(--sea-ink)] underline"
                      onClick={() => setMode('sign-in')}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </div>

            {mode === 'sign-in' && (
              <>
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex-1 h-px bg-[var(--line)]" />
                  <span className="text-[var(--sea-ink-soft)] text-sm">
                    or continue with email
                  </span>
                  <div className="flex-1 h-px bg-[var(--line)]" />
                </div>

                <div className="flex rounded-xl bg-[var(--chip-bg)] border border-[var(--line)] p-1 gap-1 mb-6">
                  <button
                    type="button"
                    onClick={() => setTab('password')}
                    className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                      tab === 'password'
                        ? 'bg-cyan-600 text-slate-950'
                        : 'text-[var(--sea-ink-soft)]'
                    }`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('magic')}
                    className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                      tab === 'magic'
                        ? 'bg-cyan-600 text-slate-950'
                        : 'text-[var(--sea-ink-soft)]'
                    }`}
                  >
                    Magic link
                  </button>
                </div>
              </>
            )}

            <form onSubmit={onSubmit} className="space-y-5">
              {mode === 'sign-up' && (
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium text-[var(--sea-ink)] mb-1.5"
                  >
                    Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    className="w-full px-4 py-3 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] text-sm outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-[var(--sea-ink)] mb-1.5"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--sea-ink-soft)]"
                    size={17}
                  />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] text-sm outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
              </div>

              {(mode === 'sign-up' ||
                (mode === 'sign-in' && tab === 'password')) && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-[var(--sea-ink)]"
                    >
                      Password
                    </label>
                    {mode === 'sign-in' && tab === 'password' && (
                      <button
                        type="button"
                        onClick={() => setForgotOpen(true)}
                        className="text-sm text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)] underline underline-offset-2"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--sea-ink-soft)]"
                      size={17}
                    />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required={mode === 'sign-up' || tab === 'password'}
                      autoComplete={
                        mode === 'sign-in' ? 'current-password' : 'new-password'
                      }
                      minLength={mode === 'sign-up' ? 8 : undefined}
                      className="w-full pl-10 pr-11 py-3 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] text-sm outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm text-slate-950 bg-cyan-600 transition hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
              >
                {loading ? (
                  <span className="inline-block size-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950" />
                ) : mode === 'sign-in' && tab === 'magic' ? (
                  <>
                    <span>Send magic link</span>
                    <ArrowRight size={16} />
                  </>
                ) : (
                  <>
                    <span>
                      {mode === 'sign-in' ? 'Sign in' : 'Create account'}
                    </span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            {mode === 'sign-in' && tab === 'password' && (
              <p className="text-center text-sm text-[var(--sea-ink-soft)] mt-3">
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-[var(--sea-ink)]"
                  onClick={resendVerification}
                >
                  Resend verification email
                </button>
              </p>
            )}

            {mode === 'sign-in' && (
              <div className="mt-6">
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-2 border border-[var(--line)] rounded-xl py-3 bg-[var(--chip-bg)] text-[var(--sea-ink)] text-sm font-medium hover:bg-[var(--link-bg-hover)] transition-colors"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  Continue with Google
                </button>
              </div>
            )}

            <p className="text-center text-xs text-[var(--sea-ink-soft)] mt-8">
              By continuing, you agree to use this service responsibly. Use
              https in production; set{' '}
              <code className="text-[var(--sea-ink)]">BETTER_AUTH_URL</code>,{' '}
              <code className="text-[var(--sea-ink)]">TRUSTED_ORIGINS</code>,
              and Google redirect URIs accordingly.
            </p>

            <p className="text-center mt-4">
              <Link
                to="/"
                className="text-sm text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
              >
                ← Back to home
              </Link>
            </p>

            {forgotOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="forgot-title"
                onKeyDown={(ev) => {
                  if (ev.key === 'Escape') {
                    setForgotOpen(false)
                    setForgotPasswordEmail('')
                    setForgotPasswordSent(false)
                  }
                }}
                onClick={() => {
                  setForgotOpen(false)
                  setForgotPasswordEmail('')
                  setForgotPasswordSent(false)
                }}
              >
                <div
                  className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2
                    id="forgot-title"
                    className="text-lg font-semibold text-[var(--sea-ink)] mb-1"
                  >
                    Forgot password
                  </h2>
                  <p className="text-sm text-[var(--sea-ink-soft)] mb-4">
                    {forgotPasswordSent
                      ? 'We sent a reset link to your email. Check your inbox and spam folder.'
                      : 'Enter your email and we will send you a link to reset your password.'}
                  </p>
                  {!forgotPasswordSent ? (
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div>
                        <label
                          htmlFor="forgot-password-email"
                          className="block text-sm font-medium text-[var(--sea-ink)] mb-1.5"
                        >
                          Email
                        </label>
                        <input
                          id="forgot-password-email"
                          type="email"
                          value={forgotPasswordEmail}
                          onChange={(e) =>
                            setForgotPasswordEmail(e.target.value)
                          }
                          placeholder="you@example.com"
                          required
                          autoComplete="email"
                          className="w-full px-4 py-3 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--sea-ink)] text-sm outline-none focus:ring-2 focus:ring-cyan-500/50"
                        />
                      </div>
                      <button
                        type="submit"
                        className="w-full py-3 rounded-xl font-semibold text-sm text-slate-950 bg-cyan-600 disabled:opacity-60"
                        disabled={forgotPasswordLoading}
                      >
                        {forgotPasswordLoading ? 'Sending…' : 'Send reset link'}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="w-full py-3 rounded-xl border border-[var(--line)] font-medium text-[var(--sea-ink)]"
                      onClick={() => {
                        setForgotOpen(false)
                        setForgotPasswordEmail('')
                        setForgotPasswordSent(false)
                      }}
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:items-end lg:pt-6 lg:pr-6">
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}
