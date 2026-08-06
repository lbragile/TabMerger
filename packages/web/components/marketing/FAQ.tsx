'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const faqs = [
  {
    question: 'Is TabMerger really free?',
    answer:
      'Yes! The free tier includes all the core features — up to 5 groups, 50 tabs, drag-and-drop, and import/export. You only pay if you want cloud sync, unlimited tabs, or AI features.',
  },
  {
    question: 'How does cloud sync work?',
    answer:
      'When you sign up for a Pro or Pro AI plan, your groups are automatically saved to our servers. Any browser where you\'re signed into TabMerger will stay in sync in real time.',
  },
  {
    question: 'What does the AI do exactly?',
    answer:
      'The Pro AI tier unlocks three AI features: auto-grouping (analyzes your open tabs and groups them logically), smart naming (suggests names for your groups), and session suggestions (recommends how to organize your workflow).',
  },
  {
    question: 'Can I cancel my subscription?',
    answer:
      'Absolutely. You can cancel anytime from your account page. You\'ll keep access until the end of your current billing period, then drop back to the free tier.',
  },
  {
    question: 'Does TabMerger work with Firefox or Edge?',
    answer:
      'The extension currently supports Chrome and Chromium-based browsers (Edge, Brave, Arc, etc.). Firefox support is on our roadmap.',
  },
  {
    question: 'Is my data private?',
    answer:
      'We take privacy seriously. Your tab data is encrypted in transit and at rest. We never sell your data. Free tier data is stored locally only — nothing leaves your browser.',
  },
  {
    question: 'What happens to my groups if I downgrade?',
    answer:
      'If you downgrade from Pro to Free, your groups remain in the cloud for 30 days. Your local tabs are always kept. You can export everything before downgrading.',
  },
]

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
        className="flex w-full items-center gap-4 py-[18px] text-left transition-colors hover:text-primary"
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

export function FAQ() {
  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 border-b border-border">
      <div className="container max-w-[960px] grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
        <div className="sm:col-span-1">
          <h1 className="font-semibold tracking-tight mb-2 text-[28px] sm:text-[34px] leading-tight">
            Frequently asked
          </h1>
          <p className="text-text2 text-sm mb-6">
            Still unsure about something? We answer email in under a day.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center h-10 px-5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-[13.5px] font-medium transition-colors"
          >
            Contact support
          </Link>
        </div>

        <div className="sm:col-span-2 flex flex-col">
          {faqs.map((faq, i) => (
            <FAQItem key={faq.question} {...faq} defaultOpen={i === 0} />
          ))}
          <div className="border-t border-line" />
        </div>
      </div>
    </section>
  )
}
