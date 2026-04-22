import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import { authClient } from '../../lib/auth-client'

export const Route = createFileRoute('/_main/reset-password')({ component: ResetPassword })

function ResetPassword() {
  const [token, setToken] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    const err = params.get('error')
    if (err === 'INVALID_TOKEN') {
      toast.error('This reset link is invalid or has expired')
      setUrlError(err)
    }
    setToken(t)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !newPassword) {
      toast.error('Enter a new password')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      const result = await authClient.resetPassword({ newPassword, token })
      if (result.error) {
        toast.error(result.error.message ?? 'Failed to reset password')
        return
      }
      setSuccess(true)
      toast.success('Password updated. You can sign in now.')
    } finally {
      setLoading(false)
    }
  }

  if (!token && !urlError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-bold text-[var(--sea-ink)]">Reset password</h1>
          <p className="text-[var(--sea-ink-soft)] text-sm">
            Use the link from your email to reset your password. Links expire after a short time.
          </p>
          <Link
            to="/sign-in"
            className="text-cyan-600 font-medium underline decoration-cyan-600/50 underline-offset-2"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  if (urlError === 'INVALID_TOKEN') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-bold text-[var(--sea-ink)]">Invalid or expired link</h1>
          <p className="text-[var(--sea-ink-soft)] text-sm">
            This password reset link is invalid or has expired. Request a new one from the sign-in page.
          </p>
          <Link
            to="/sign-in"
            className="text-cyan-600 font-medium underline decoration-cyan-600/50 underline-offset-2"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-bold text-[var(--sea-ink)]">Password reset</h1>
          <p className="text-[var(--sea-ink-soft)] text-sm">
            Your password has been updated. You can now sign in.
          </p>
          <Link
            to="/sign-in"
            className="inline-flex items-center justify-center rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-slate-950 no-underline hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[var(--sea-ink)]">Set new password</h1>
          <p className="text-[var(--sea-ink-soft)] text-sm mt-1">Enter your new password below.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-[var(--sea-ink)] mb-1.5">
              New password
            </label>
            <div className="relative">
              <Lock
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--sea-ink-soft)]"
                size={17}
              />
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] text-sm outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2 focus:ring-offset-[var(--bg-base)]"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-3.5 rounded-xl font-semibold text-sm text-slate-950 bg-cyan-600 transition hover:opacity-90 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
        <p className="text-center">
          <Link
            to="/sign-in"
            className="text-sm text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
          >
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
