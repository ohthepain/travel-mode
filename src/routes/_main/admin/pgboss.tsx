import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

/** Legacy jobs may include `data.travelDate`; new jobs only send `flightNumber`. */
type JobRow = {
  id: string
  name: string
  state: string
  data: { flightNumber?: string; travelDate?: string }
  priority: number
  retryCount: number
  retryLimit: number
  singletonKey: string | null
  createdOn: string
  startedOn: string
  completedOn: string | null
  startAfter: string
  output?: Record<string, unknown>
  outputMessage?: string | null
}

type JobsPayload = {
  queue: string
  stats: {
    name: string
    deferredCount: number
    queuedCount: number
    activeCount: number
    totalCount: number
    table: string
  }
  jobCount: number
  jobsReturned: number
  jobs: JobRow[]
}

export const Route = createFileRoute('/_main/admin/pgboss')({
  component: PgBossPage,
})

function formatJobOutput(output: Record<string, unknown>): string {
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function hasJobOutput(output: Record<string, unknown>): boolean {
  return Object.keys(output).length > 0
}

function PgBossPage() {
  const [data, setData] = useState<JobsPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const r = await fetch('/api/admin/pgboss/jobs')
      if (!r.ok) {
        setErr(await r.text())
        setData(null)
        return
      }
      setData((await r.json()) as JobsPayload)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="page-wrap px-4 py-8">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">pg-boss</p>
        <h1 className="display-title mb-2 text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Jobs
        </h1>
        <p className="m-0 mb-4 text-sm text-[var(--sea-ink-soft)]">
          <Link
            to="/admin"
            className="text-[var(--sea-accent)] font-medium underline decoration-[var(--sea-accent)]/50 underline-offset-2 hover:decoration-[var(--sea-accent)]"
          >
            ← Admin
          </Link>
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-medium text-[var(--sea-ink)]"
          >
            Refresh
          </button>
        </div>

        {loading && <p className="text-[var(--sea-ink-soft)]">Loading…</p>}
        {err && <p className="text-amber-700 dark:text-amber-200">{err}</p>}

        {data && (
          <>
            <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--header-bg)]/40 p-4 text-sm text-[var(--sea-ink)]">
              <p className="m-0 font-semibold">Queue: {data.queue}</p>
              <p className="m-0 mt-1 text-[var(--sea-ink-soft)]">
                queued: {data.stats.queuedCount} · active: {data.stats.activeCount} ·
                deferred: {data.stats.deferredCount} · total: {data.stats.totalCount} ·
                table: {data.stats.table}
              </p>
              <p className="m-0 mt-1 text-[var(--sea-ink-soft)]">
                Showing {data.jobsReturned} of {data.jobCount} jobs (newest first, capped
                at 500).
              </p>
            </div>

            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-[var(--sea-ink-soft)]">
                    <th className="py-2 pr-3 font-medium">State</th>
                    <th className="py-2 pr-3 font-medium">Message</th>
                    <th className="py-2 pr-3 font-medium">Flight</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Job id</th>
                    <th className="py-2 pr-3 font-medium">Retries</th>
                    <th className="py-2 pr-3 font-medium">Output</th>
                    <th className="py-2 pr-3 font-medium">Created</th>
                    <th className="py-2 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-4 text-[var(--sea-ink-soft)]">
                        No jobs in this queue yet.
                      </td>
                    </tr>
                  )}
                  {data.jobs.map((j) => {
                    const out = j.output ?? {}
                    const msg = j.outputMessage ?? null
                    return (
                    <tr
                      key={j.id}
                      className="border-b border-[var(--line)]/60 text-[var(--sea-ink)]"
                    >
                      <td className="py-2 pr-3 align-top font-mono text-xs">
                        {j.state}
                      </td>
                      <td
                        className="max-w-[14rem] py-2 pr-3 align-top text-xs leading-snug text-[var(--sea-ink)]"
                        title={msg ?? undefined}
                      >
                        {msg ?? (
                          <span className="text-[var(--sea-ink-soft)]">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 align-top">{j.data.flightNumber ?? '—'}</td>
                      <td className="py-2 pr-3 align-top">{j.data.travelDate ?? '—'}</td>
                      <td className="max-w-[12rem] truncate py-2 pr-3 align-top font-mono text-xs">
                        {j.id}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        {j.retryCount}/{j.retryLimit}
                      </td>
                      <td className="max-w-[12rem] py-2 pr-3 align-top text-xs">
                        {hasJobOutput(out) ? (
                          <details className="group">
                            <summary className="cursor-pointer font-medium text-[var(--sea-accent)] underline decoration-[var(--sea-accent)]/40 underline-offset-2 marker:text-[var(--sea-ink-soft)]">
                              JSON
                            </summary>
                            <pre className="mt-2 max-h-48 max-w-[min(24rem,70vw)] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--header-bg)]/50 p-2 text-[0.65rem] leading-relaxed text-[var(--sea-ink)]">
                              {formatJobOutput(out)}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-[var(--sea-ink-soft)]">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 align-top text-xs">
                        {j.createdOn}
                      </td>
                      <td className="whitespace-nowrap py-2 align-top text-xs text-[var(--sea-ink-soft)]">
                        {j.completedOn ?? '—'}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
