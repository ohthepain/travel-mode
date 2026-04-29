import { useRouterState } from '@tanstack/react-router'
import Header from './Header'

const NO_CHROME = new Set(['/sign-in', '/reset-password'])

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const hideChrome = NO_CHROME.has(pathname)
  if (hideChrome) {
    return <>{children}</>
  }
  return (
    <>
      <Header />
      {children}
    </>
  )
}
