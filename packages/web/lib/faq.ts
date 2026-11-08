import { FREE_TIER_LIMITS, type AiAvailability } from '@tabmerger/shared'
import { AI_AVAILABILITY } from '@/lib/aiFlag'

/**
 * The FAQ's questions and answers, shared by the page that shows them (`components/marketing/FAQ`)
 * and the page's FAQPage structured data (`faqJsonLd` in `lib/seo.ts`). Structured data must say
 * exactly what the page says, so both take their text from here: one key list, one choice of AI
 * answer, one set of values.
 */

/** Each question is a key under `faq` (its `question` and `answer`), in display order. */
export const FAQ_KEYS = ['free', 'sync', 'ai', 'cancel', 'browsers', 'privacy', 'downgrade'] as const

export type FaqKey = (typeof FAQ_KEYS)[number]

/** Every `faq` message key this module reads. */
type FaqMessageKey =
  | `${FaqKey}.question`
  | `${Exclude<FaqKey, 'ai'>}.answer`
  | 'ai.answer'
  | 'ai.answerOwnKey'
  | 'ai.answerComingSoon'

/**
 * The part of a `faq`-namespace translator this module needs. Both `useTranslations('faq')` and
 * `getTranslations('faq')` fit it.
 */
export type FaqTranslator = (key: FaqMessageKey, values?: Record<string, number>) => string

export interface FaqItem {
  key: FaqKey
  question: string
  /** Plain text: no answer has rich text or links. */
  answer: string
}

/** The answer's message key: the AI answer says which Pro AI options are on sale. */
function answerKey(key: FaqKey, ai: AiAvailability): FaqMessageKey {
  if (key !== 'ai') return `${key}.answer`
  if (ai.managed) return 'ai.answer'
  // Only the own-key option is live yet.
  return ai.byok ? 'ai.answerOwnKey' : 'ai.answerComingSoon'
}

/** The FAQ in display order, in the translator's language. */
export function faqItems(t: FaqTranslator, ai: AiAvailability = AI_AVAILABILITY): FaqItem[] {
  return FAQ_KEYS.map((key) => ({
    key,
    question: t(`${key}.question`),
    answer:
      key === 'free'
        ? t('free.answer', { groups: FREE_TIER_LIMITS.groups, tabs: FREE_TIER_LIMITS.tabs, urlRules: FREE_TIER_LIMITS.urlRules })
        : t(answerKey(key, ai)),
  }))
}
