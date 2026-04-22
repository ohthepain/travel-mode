export type SyncFlightPayload = {
  /** Single number (default path). */
  flightNumber?: string
  /**
   * Multiple numbers: one `getFull` (same time window) with `flights: [...]`, then
   * one track request per new `fr24` id. Distinct pgboss jobs should use a sorted key.
   */
  flightNumbers?: string[]
}

export function flightNumbersFromPayload(p: SyncFlightPayload): string[] {
  if (p.flightNumbers && p.flightNumbers.length > 0) {
    return [
      ...new Set(
        p.flightNumbers
          .map((s) => String(s).toUpperCase().trim())
          .filter(Boolean),
      ),
    ]
  }
  if (p.flightNumber) {
    return [String(p.flightNumber).toUpperCase().trim()].filter(Boolean)
  }
  return []
}
