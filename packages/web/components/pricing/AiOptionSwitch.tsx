'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import type { AiMode } from '@tabmerger/shared'
import { cn } from '@/lib/utils'
import { AI_OPTION_ORDER } from './aiOptions'

interface AiOptionSwitchProps {
  value: AiMode
  onChange: (mode: AiMode) => void
  className?: string
}

/**
 * Pro AI's two options as a segmented control answering "Who handles setup": "TabMerger"
 * (`managed`, AI on TabMerger's key) or "You" (`byok`, your own API key). Radii are theme tokens
 * only (the track like the card's buttons, the pill one step in), so it follows `--radius`. Built from
 * native radio buttons (visually hidden) so arrow keys, focus and the "1 of 2" announcement come
 * from the browser; the visible labels carry the styling.
 */
export function AiOptionSwitch({ value, onChange, className }: AiOptionSwitchProps) {
  const t = useTranslations('pricing.aiOptions')
  const name = useId()

  return (
    <fieldset className={cn('min-w-0', className)}>
      {/* The question the two options answer, shown above them. */}
      <legend className="w-full mb-1.5 text-[0.71875rem] text-text3">{t('legend')}</legend>
      <div className="grid grid-cols-2 rounded-lg p-[0.1875rem] bg-surface3 border border-border text-[0.78125rem]">
        {AI_OPTION_ORDER.map((mode) => (
          <label
            key={mode}
            className={cn(
              'flex items-center justify-center text-center min-h-[1.75rem] px-2 py-1 rounded-md font-medium cursor-pointer transition-colors',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              value === mode
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name={name}
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
              className="sr-only"
            />
            {t(mode)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
