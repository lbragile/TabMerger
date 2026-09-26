/**
 * Returns true only when `raw` is the exact string "true" (case-sensitive).
 * Callers are responsible for reading the raw env var themselves — env var
 * access differs between Next.js client/server and Vite/WXT contexts.
 */
export function isAiEnabled(raw: string | undefined): boolean {
  return raw === 'true';
}
