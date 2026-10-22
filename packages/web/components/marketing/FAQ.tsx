'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { AI_ENABLED } from '@/lib/aiFlag'
import { FREE_TIER_LIMITS } from '@tabmerger/shared'

/** Each question is a key under `faq` (its `question` and `answer`), in display order. */
const FAQ_KEYS = ['free', 'sync', 'ai', 'cancel', 'browsers', 'privacy', 'downgrade'] as const

function FAQItem({
  question,
  answer,
  defaultOpen = false,
}: {
  question: string
  answer: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  // ponytail: stable id from question text for aria-controls
  const id = `faq-${question.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}`

  return (
    <div className="border-t border-line">
      <button
        className="flex w-full items-center gap-4 py-[18px] text-start transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
      >
        <span className="flex-1 font-semibold text-[15px]">{question}</span>
        <span className="text-[15px] text-text3 shrink-0" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {/* ponytail: CSS grid-rows trick for height animation without measuring content */}
      <div
        id={id}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
        aria-hidden={!open}
      >
        <div className="overflow-hidden">
          <p className="-mt-1 pb-[18px] text-[14px] leading-[1.7] text-text2">{answer}</p>
        </div>
      </div>
    </div>
  )
}

// No bottom border on the section: the FAQ is the whole /faq page and the footer draws its own
// top border, so a second line above it left two lines with an empty band between them.
export function FAQ() {
  const t = useTranslations('faq')
  const answer = (key: (typeof FAQ_KEYS)[number]) => {
    if (key === 'free') {
      return t('free.answer', {
        groups: FREE_TIER_LIMITS.groups,
        tabs: FREE_TIER_LIMITS.tabs,
        urlRules: FREE_TIER_LIMITS.urlRules,
      })
    }
    if (key === 'ai') return AI_ENABLED ? t('ai.answer') : t('ai.answerComingSoon')
    return t(`${key}.answer`)
  }
  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11">
      <div className="container max-w-[960px] grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
        <div className="sm:col-span-1">
          <h1 className="font-semibold tracking-tight mb-2 text-[28px] sm:text-[34px] leading-tight">
            {t('title')}
          </h1>
          <p className="text-text2 text-sm mb-6">
            {t('lead')}
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center h-10 px-5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-[13.5px] font-medium transition-colors"
          >
            {t('contact')}
          </Link>
        </div>

        <div className="sm:col-span-2 flex flex-col">
          {FAQ_KEYS.map((key, i) => (
            <FAQItem key={key} question={t(`${key}.question`)} answer={answer(key)} defaultOpen={i === 0} />
          ))}
          <div className="border-t border-line" />
        </div>
      </div>
    </section>
  )
}
