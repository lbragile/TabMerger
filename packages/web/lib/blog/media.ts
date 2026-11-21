/** `window.matchMedia(query).matches`, false where matchMedia doesn't exist (old browsers, jsdom). */
export function mediaMatches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/** Listens for `query` to start or stop matching; a no-op where matchMedia doesn't exist. */
export function onMediaChange(query: string, callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const list = window.matchMedia(query)
  list.addEventListener('change', callback)
  return () => list.removeEventListener('change', callback)
}
