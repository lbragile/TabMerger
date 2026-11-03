import { useFormatter, useTranslations } from 'next-intl'
import { AI_CREDITS_RESET_DATE_FORMAT, type AiCreditsDate } from '@tabmerger/shared'
import { cn } from '@/lib/utils'

/**
 * "Credits reset on {date}", or "Credits end on {date}" when no managed Pro AI period follows (a
 * cancellation or a scheduled change off it), next to the credit balance and "Get more": a pack
 * bought just before that date is mostly lost, so buyers need it before paying. From
 * `managedAiCreditsDate()`; null (not an active managed plan, or a renewal held until paid) renders
 * nothing rather than a guess. A span, because the dashboard's card puts it inside a paragraph.
 */
export function CreditsResetNote({ credits, className }: { credits: AiCreditsDate | null | undefined; className?: string }) {
  const t = useTranslations('account.credits')
  const format = useFormatter()
  if (!credits) return null
  const date = format.dateTime(credits.at, AI_CREDITS_RESET_DATE_FORMAT)
  return (
    <span data-testid="ai-credits-reset" data-kind={credits.kind} className={cn('block mt-1', className)}>
      {credits.kind === 'end' ? t('endsOn', { date }) : t('resetsOn', { date })}
    </span>
  )
}
