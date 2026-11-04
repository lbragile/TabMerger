/**
 * Returns true only when `raw` is the exact string "true" (case-sensitive).
 * Callers are responsible for reading the raw env var themselves — env var
 * access differs between Next.js client/server and Vite/WXT contexts.
 *
 * This is the managed Pro AI flag (`NEXT_PUBLIC_AI_ENABLED` / `VITE_AI_ENABLED`): AI on
 * TabMerger's key. Turning it on also turns on the own-key option (see {@link aiAvailability}).
 */
export function isAiEnabled(raw: string | undefined): boolean {
  return raw === 'true';
}

/**
 * The own-key (BYOK) Pro AI flag (`NEXT_PUBLIC_AI_BYOK_ENABLED` / `VITE_AI_BYOK_ENABLED`), parsed
 * the same way as {@link isAiEnabled}. Lets the own-key option launch before managed AI, since it
 * costs TabMerger nothing in AI usage.
 */
export function isAiByokEnabled(raw: string | undefined): boolean {
  return raw === 'true';
}

/** Which Pro AI options are live. */
export interface AiAvailability {
  /** AI on TabMerger's key: buyable, and its AI requests are served. */
  managed: boolean;
  /** AI on the customer's own key: buyable, and its AI requests are served. */
  byok: boolean;
  /** Either option is live, so AI features show at all. */
  any: boolean;
}

/**
 * Both flags combined. The managed flag implies the own-key option: once AI on TabMerger's key
 * is live there's no reason to hold back the cheaper option that costs TabMerger nothing.
 */
export function aiAvailability(managedRaw: string | undefined, byokRaw: string | undefined): AiAvailability {
  const managed = isAiEnabled(managedRaw);
  const byok = managed || isAiByokEnabled(byokRaw);
  return { managed, byok, any: byok };
}
