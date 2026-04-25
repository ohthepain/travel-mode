/** Wrap degrees to [-180, 180). */
export function wrapDegrees180(n: number): number {
  return ((n + 540) % 360) - 180
}

/** Bearing in [0, 360) for display labels. */
export function normalizeBearing360(deg: number): number {
  return ((deg % 360) + 360) % 360
}
