/**
 * Airline: 2–3 letters (e.g. SK, SAS) or letter+digit (e.g. D8, W6), then
 * flight number 1–4 digits optional suffix letter. Order matters: prefer two
 * full letters (SK843) over letter+digit (D84321) so the split is correct.
 */
const FLIGHT_IATA = /^((?:[A-Z]{2,3}|[A-Z]\d))(\d{1,4}[A-Z]?)$/i

/** Split e.g. SK843, D84321, W61234 for AirLabs (airline_iata + flight_number). */
export function parseFlightIata(
  label: string,
):
  | { ok: true; flightIata: string; airlineIata: string; flightNumber: string }
  | { ok: false; error: string } {
  const s = String(label)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  if (!s) return { ok: false, error: 'empty_flightNumber' }
  const m = s.match(FLIGHT_IATA)
  if (!m) return { ok: false, error: 'invalid_flightNumber' }
  return {
    ok: true,
    flightIata: s,
    airlineIata: m[1],
    flightNumber: m[2],
  }
}
