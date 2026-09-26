import { NextResponse } from 'next/server'
import { isAiEnabled } from '@tabmerger/shared'

/** Error code returned by every `/api/ai/*` route while the AI feature flag is off. */
export const AI_DISABLED_ERROR = 'ai_disabled'

/**
 * Kill switch for every `/api/ai/*` route handler. Call it as the FIRST statement of
 * each handler: `const disabled = aiDisabledResponse(); if (disabled) return disabled`.
 *
 * Returns a 503 `{ error: 'ai_disabled' }` when `NEXT_PUBLIC_AI_ENABLED` is anything
 * other than the exact string "true" (unset = off), so no auth lookup, `ai_usage`
 * read/write, workflow start, or Anthropic call happens. Returns `null` when AI is on.
 *
 * Same env var and same `isAiEnabled` parser as `lib/aiFlag.ts`'s `AI_ENABLED` (used by
 * the pricing/dashboard UI), but read per call rather than via that module-scope constant
 * so route tests can toggle it with `vi.stubEnv` — matching the per-call reads in
 * `app/api/checkout/*`. Note that Next.js inlines `NEXT_PUBLIC_*` at build time, so flipping the
 * flag in a deployed environment requires a rebuild/redeploy, not just a restart.
 *
 * 503 (not 404) because the routes exist and are temporarily unavailable ("coming
 * soon"); CORS headers are still applied to this response by `proxy.ts`, so the
 * extension can read the `ai_disabled` code.
 */
export function aiDisabledResponse(): NextResponse | null {
  if (isAiEnabled(process.env.NEXT_PUBLIC_AI_ENABLED)) return null
  return NextResponse.json({ error: AI_DISABLED_ERROR }, { status: 503 })
}
