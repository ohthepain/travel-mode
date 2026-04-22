import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './db'
import { sendMagicLinkEmail, sendPasswordResetEmail, sendVerifyEmailEmail } from './email/ses'

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
const secret = process.env.BETTER_AUTH_SECRET ?? 'dev-only-change-me-in-production'
const requireEmailVerification =
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true'

function trustedOrigins(): string[] {
  const extra = (process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [
    ...new Set([
      baseURL,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      ...extra,
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

export const auth = betterAuth({
  secret,
  baseURL,
  trustedOrigins: trustedOrigins(),
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
