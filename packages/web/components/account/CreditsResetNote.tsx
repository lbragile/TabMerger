import { useFormatter, useTranslations } from 'next-intl'
import { AI_CREDITS_RESET_DATE_FORMAT } from '@tabmerger/shared'
import { cn } from '@/lib/utils'

/**
 * "Credits reset on {date}", next to the credit balance and "Get more": a pack bought just before a
 * reset is mostly lost, so buyers need the date before paying. The date comes from
 * `managedAiCreditsResetAt()`; a null one (not an active managed plan, or a renewal held until
 * paid) renders nothing rather than a guess. A span, because the dashboard's card puts it inside a
 * paragraph.
 */
export function CreditsResetNote({ resetsAt, className }: { resetsAt: Date | null | undefined; className?: string }) {
  const t = useTranslations('account.credits')
  const format = useFormatter()
  if (!resetsAt) return null
  return (
    <span data-testid="ai-credits-reset" className={cn('block mt-1', className)}>
      {t('resetsOn', { date: format.dateTime(resetsAt, AI_CREDITS_RESET_DATE_FORMAT) })}
    </span>
  )
}
