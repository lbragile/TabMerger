import { isAiEnabled } from '@tabmerger/shared'

/**
 * Isomorphic AI-features flag. `NEXT_PUBLIC_*` vars are inlined at build time
 * into client bundles AND remain readable via `process.env` server-side, so a
 * single computed constant is safe to import from both server components/API
 * routes and client components — no separate client/server helper needed.
 *
 * Defaults to false (AI features hidden / "Coming soon") when unset.
 */
export const AI_ENABLED = isAiEnabled(process.env.NEXT_PUBLIC_AI_ENABLED)
