import { aiAvailability } from '@tabmerger/shared';

/**
 * Which Pro AI options are live in this build, computed once at module load. Plain constants
 * (not a hook) so they're importable from anywhere, including outside the React tree (e.g.
 * useAI's mutationFn bodies, useAiUsage's queryFn). Both flags are OFF unless the env var is the
 * exact string "true":
 * - `VITE_AI_ENABLED`: AI on TabMerger's key (managed). Turning it on also turns on the own-key
 *   option.
 * - `VITE_AI_BYOK_ENABLED`: AI on the customer's own key only, so it can launch first.
 * An option that is off stays hidden and sends no requests, even for accounts that are entitled
 * to it in the database (the server refuses it too).
 */
const AVAILABILITY = aiAvailability(import.meta.env.VITE_AI_ENABLED, import.meta.env.VITE_AI_BYOK_ENABLED);

/** Some Pro AI option is live, so AI surfaces that aren't specific to one option may show. */
export const AI_ENABLED = AVAILABILITY.any;

/** AI on TabMerger's key (credits) is live. */
export const AI_MANAGED_ENABLED = AVAILABILITY.managed;

/** AI on the customer's own key is live. */
export const AI_BYOK_ENABLED = AVAILABILITY.byok;
