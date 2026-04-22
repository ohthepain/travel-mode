import { Link, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

function NotFound() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">404</p>
        <h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">Page not found</h1>
        <p className="m-0 max-w-3xl text-base leading-8 text-[var(--sea-ink-soft)]">
          That URL does not match any route. Check the address or return home.
        </p>
        <p className="mt-6">
          <Link
            to="/"
            className="text-[var(--sea-accent)] font-medium underline decoration-[var(--sea-accent)]/50 underline-offset-2 hover:decoration-[var(--sea-accent)]"
          >
            Back to travelmode
          </Link>
        </p>
      </section>
    </main>
  )
}

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'travelmode.live' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
})
