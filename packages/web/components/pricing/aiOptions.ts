import {
  AI_ESTIMATE_EXAMPLES,
  AUTO_AI_MODEL,
  PRO_AI_MONTHLY_CREDITS,
  estimateAiCredits,
  type AiMode,
} from '@tabmerger/shared'
import { AI_AVAILABILITY } from '@/lib/aiFlag'

/**
 * Pro AI's two options (TabMerger's AI `managed`, your own key `byok`) as the pricing cards,
 * dashboard and account page show them. Availability comes from `AI_AVAILABILITY`: the own-key
 * option can be live while TabMerger's AI is still "Coming soon".
 */

/** The order the option switch lists them in. */
export const AI_OPTION_ORDER: readonly AiMode[] = ['managed', 'byok']

/** Whether an option can be bought (or switched to) on this deployment. */
export function isAiOptionAvailable(mode: AiMode): boolean {
  return AI_AVAILABILITY[mode]
}

/** The other Pro AI option. */
export function otherAiMode(mode: AiMode): AiMode {
  return mode === 'managed' ? 'byok' : 'managed'
}

/**
 * Which option a card opens on: the subscriber's own option, else the first one that can be
 * bought (TabMerger's AI before your own key), else TabMerger's AI.
 */
export function initialAiMode(current?: AiMode | null): AiMode {
  if (current) return current
  return AI_OPTION_ORDER.find(isAiOptionAvailable) ?? 'managed'
}

/** The "organize N tabs" example the estimates use (the largest of the shared examples). */
export const ORGANIZE_EXAMPLE_TABS =
  AI_ESTIMATE_EXAMPLES.find((example) => example.action === 'organize')?.tabs ?? 300

/**
 * About how many organizes of {@link ORGANIZE_EXAMPLE_TABS} tabs `credits` pay for with the
 * default (`auto`) model. An estimate: shown with "about", never used for billing.
 */
export function organizesFor(credits: number = PRO_AI_MONTHLY_CREDITS): number {
  const perOrganize = estimateAiCredits(AUTO_AI_MODEL.organize, 'organize', ORGANIZE_EXAMPLE_TABS)
  return perOrganize > 0 ? Math.max(0, Math.floor(credits / perOrganize)) : 0
}
