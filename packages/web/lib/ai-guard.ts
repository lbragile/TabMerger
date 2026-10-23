import { NextResponse } from 'next/server'
import { aiAvailability, type AiAvailability, type AiMode } from '@tabmerger/shared'

/** Error code returned by every `/api/ai/*` route while the AI option it needs is off. */
export const AI_DISABLED_ERROR = 'ai_disabled'

/**
 * Which Pro AI options are live, read per call from `NEXT_PUBLIC_AI_ENABLED` (managed, which
 * also turns on own-key) and `NEXT_PUBLIC_AI_BYOK_ENABLED` (own-key only). Read per call rather
 * than through `lib/aiFlag.ts`'s module-scope constants so route tests can toggle it with
 * `vi.stubEnv`. Next.js inlines `NEXT_PUBLIC_*` at build time, so flipping either flag in a
 * deployed environment needs a redeploy.
 */
export function currentAiAvailability(): AiAvailability {
  return aiAvailability(process.env.NEXT_PUBLIC_AI_ENABLED, process.env.NEXT_PUBLIC_AI_BYOK_ENABLED)
}

function disabled(): NextResponse {
  // 503 (not 404): the routes exist and are temporarily unavailable ("coming soon"). CORS
  // headers are still applied by `proxy.ts`, so the extension can read the code.
  return NextResponse.json({ error: AI_DISABLED_ERROR }, { status: 503 })
}

/**
 * First-statement kill switch for every `/api/ai/*` handler: a 503 `{ error: 'ai_disabled' }`
 * when no AI option is live, before any auth lookup, `ai_usage` read or write, workflow start or
 * model call. Returns `null` when at least one option is live; the handler then checks the
 * caller's own option with {@link aiModeDisabledResponse} once the subscription is known.
 */
export function aiDisabledResponse(): NextResponse | null {
  return currentAiAvailability().any ? null : disabled()
}

/**
 * The per-option gate, run right after the subscription lookup and before any reservation or
 * model call: a managed subscriber's request needs managed AI live, an own-key subscriber's
 * needs the own-key option live. Returns the 503 response, or `null` when allowed.
 */
export function aiModeDisabledResponse(mode: AiMode): NextResponse | null {
  return currentAiAvailability()[mode] ? null : disabled()
}
