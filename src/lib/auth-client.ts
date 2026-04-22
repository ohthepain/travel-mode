import { createAuthClient } from 'better-auth/react'
import { offlinePlugin } from 'better-auth-offline'

const baseURL =
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'

export const authClient = createAuthClient({
  baseURL,
  basePath: '/api/auth',
  plugins: [offlinePlugin()],
})
