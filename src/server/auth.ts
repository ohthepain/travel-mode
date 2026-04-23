import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './db'
import {
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  sendVerifyEmailEmail,
} from './email/ses'

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3020'
const secret =
  process.env.BETTER_AUTH_SECRET ?? 'dev-only-change-me-in-production'
const requireEmailVerification =
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true'

/** Same port on localhost ⟷ 127.0.0.1 so either hostname works in the browser. */
function localhostOriginsForUrl(url: string): string[] {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return [url]
    if (u.pathname !== '/' && u.pathname !== '') return [url]
    const port = u.port
    if (u.hostname === 'localhost') {
      return port
        ? [url, `${u.protocol}//127.0.0.1:${port}`]
        : [url, `${u.protocol}//127.0.0.1`]
    }
    if (u.hostname === '127.0.0.1' && port) {
      return [url, `${u.protocol}//localhost:${port}`]
    }
    return [url]
  } catch {
    return [url]
  }
}

/**
 * Origins allowed for CORS and better-auth (including social sign-in). Must include
 * the exact browser origin (scheme + host + port). Set BETTER_AUTH_URL to match
 * your dev server (e.g. http://localhost:3002) — this is separate from Google Cloud
 * “Authorized JavaScript origins”, which only affects the Google sign-in button.
 */
export function getTrustedOrigins(): string[] {
  const extra = (process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [
    ...new Set([
      ...localhostOriginsForUrl(baseURL),
      ...localhostOriginsForUrl('http://127.0.0.1:3020'),
      ...extra.flatMap(localhostOriginsForUrl),
    ]),
  ]
}

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }
    : undefined

if (process.env.NODE_ENV !== 'production' && !google) {
  console.warn(
    '[auth] Google sign-in is disabled: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env. Without them, /api/auth/sign-in/social returns 404 for provider "google".',
  )
}

export const auth = betterAuth({
  secret,
  baseURL,
  trustedOrigins: getTrustedOrigins(),
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      void sendVerifyEmailEmail(user.email, url)
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification,
    sendResetPassword: async ({ user, url }) => {
      void sendPasswordResetEmail(user.email, url)
    },
  },
  socialProviders: {
    ...(google ? { google } : {}),
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        void sendMagicLinkEmail(email, url)
      },
    }),
  ],
})
