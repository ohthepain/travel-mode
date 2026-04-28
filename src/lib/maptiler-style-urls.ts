/**
 * Remove `key` from the query string only. Do not use `new URL(s).toString()` on
 * the full URL: the path may contain `{fontstack}` / `{range}` for glyph URLs,
 * and the URL serializer encodes `{` → `%7B`, which breaks MapLibre’s glyphs check.
 */
function stripKeyFromMapTilerUrlString(s: string): string {
  if (
    !s.startsWith('https://api.maptiler.com/') &&
    !s.startsWith('http://api.maptiler.com/')
  ) {
    return s
  }
  const q = s.indexOf('?')
  if (q === -1) return s
  const base = s.slice(0, q)
  const search = s.slice(q + 1)
  const params = new URLSearchParams(search)
  params.delete('key')
  const rest = params.toString()
  return rest ? `${base}?${rest}` : base
}

/**
 * If anything in the pipeline percent-encoded the `{fontstack}` / `{range}` path
 * tokens, MapLibre’s style validator (literal substring check) will fail.
 */
function decodeMapTilerGlyphPathTokensInUrl(s: string): string {
  if (
    !s.startsWith('https://api.maptiler.com/') &&
    !s.startsWith('http://api.maptiler.com/')
  ) {
    return s
  }
  return s
    .replace(/%7Bfontstack%7D/gi, '{fontstack}')
    .replace(/%7Brange%7D/gi, '{range}')
}

export function styleJsonWithKeysStrippedForClient(style: unknown): unknown {
  if (Array.isArray(style)) {
    return style.map((x) => styleJsonWithKeysStrippedForClient(x))
  }
  if (style && typeof style === 'object') {
    const o = style as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      out[k] = styleJsonWithKeysStrippedForClient(v)
    }
    return out
  }
  if (typeof style === 'string') {
    return decodeMapTilerGlyphPathTokensInUrl(
      stripKeyFromMapTilerUrlString(style),
    )
  }
  return style
}

/**
 * Client-side: MapLibre validates `style.glyphs` with string `indexOf("{fontstack}")`.
 * Use after `fetch().json()` so the style is safe even if a proxy or old cache
 * delivered percent-encoded path templates.
 */
export function ensureVectorStyleGlyphsForMapLibre(style: unknown) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return
  const o = style as Record<string, unknown>
  const g = o.glyphs
  if (typeof g !== 'string') return
  o.glyphs = decodeMapTilerGlyphPathTokensInUrl(
    stripKeyFromMapTilerUrlString(g),
  )
}
