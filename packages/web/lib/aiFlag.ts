import { aiAvailability, isAiEnabled } from '@tabmerger/shared'

/**
 * Isomorphic AI-features flag. `NEXT_PUBLIC_*` vars are inlined at build time
 * into client bundles AND remain readable via `process.env` server-side, so a
 * single computed constant is safe to import from both server components/API
 * routes and client components — no separate client/server helper needed.
 *
 * Defaults to false (AI features hidden / "Coming soon") when unset.
 *
 * This is the managed (TabMerger's key) flag only; most UI wants {@link AI_AVAILABILITY}.
 */
export const AI_ENABLED = isAiEnabled(process.env.NEXT_PUBLIC_AI_ENABLED)

/**
 * Which Pro AI options are live: `managed` (`NEXT_PUBLIC_AI_ENABLED`), `byok` (the own-key option,
 * `NEXT_PUBLIC_AI_BYOK_ENABLED`, also on whenever managed is) and `any`. Same build-time inlining
 * as {@link AI_ENABLED}. API routes read the env per call instead, so tests can stub it.
 */
export const AI_AVAILABILITY = aiAvailability(
  process.env.NEXT_PUBLIC_AI_ENABLED,
  process.env.NEXT_PUBLIC_AI_BYOK_ENABLED,
)
