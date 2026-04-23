import { auth } from './auth'

export async function getSessionUserId(headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers })
  return session?.user.id ?? null
}
