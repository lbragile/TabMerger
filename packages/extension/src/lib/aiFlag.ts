import { isAiEnabled } from '@tabmerger/shared';

/**
 * Global "AI features: coming soon" kill switch, computed once at module load.
 * A single plain constant (not a hook) so it's importable from anywhere,
 * including outside the React tree (e.g. useAI's mutationFn bodies, useAiUsage's
 * queryFn). Default is OFF — unset or anything other than the exact string
 * "true" for `VITE_AI_ENABLED` means AI features stay hidden/disabled, even for
 * accounts that are actually entitled to the `pro_ai` tier in the DB.
 */
export const AI_ENABLED = isAiEnabled(import.meta.env.VITE_AI_ENABLED);
