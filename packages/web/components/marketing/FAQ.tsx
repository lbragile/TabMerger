'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
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

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  // ponytail: stable id from question text for aria-controls
  const id = `faq-${question.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}`

  return (
    <div className="border-b last:border-b-0">
      <button
        className="flex w-full items-center justify-between py-4 text-left text-sm font-medium hover:text-foreground/80 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
      >
        {question}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={id} className="pb-4 text-sm text-muted-foreground leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  )
}

export function FAQ() {
  return (
    <section className="py-24 bg-muted/30">
      <div className="container max-w-3xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Frequently asked questions
          </h2>
        </div>
        <div className="rounded-lg border bg-background p-6">
          {faqs.map((faq) => (
            <FAQItem key={faq.question} {...faq} />
          ))}
        </div>
      </div>
    </section>
  )
}
