import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'
import { offlinePlugin } from 'better-auth-offline'

const baseURL =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:3020'

export const authClient = createAuthClient({
  baseURL,
  basePath: '/api/auth',
  plugins: [offlinePlugin(), magicLinkClient()],
  fetchOptions: {
    credentials: 'include',
    ...(typeof window !== 'undefined' &&
    window.location.hostname.includes('ngrok')
      ? { headers: { 'ngrok-skip-browser-warning': '1' } }
      : {}),
  },
})

export const { signIn, signUp, signOut, useSession } = authClient
