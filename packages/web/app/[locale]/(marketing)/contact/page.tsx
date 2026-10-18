'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GITHUB_ISSUES_URL } from '@/lib/github'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'

// A client component can't export metadata; the page's own lives in ./layout.tsx.

type Status = 'idle' | 'sending' | 'sent' | 'error'

// The value is what the support inbox receives (always English, so every message is sorted
// the same way); the label is shown in the visitor's language (`contact.subjects.<key>`).
const SUBJECT_OPTIONS = [
  { value: 'Bug report', key: 'bug' },
  { value: 'Beta bug report', key: 'betaBug' },
  { value: 'Feedback and ideas', key: 'feedback' },
  { value: 'Billing question', key: 'billing' },
  { value: 'Feature request', key: 'feature' },
  { value: 'Account help', key: 'account' },
  { value: 'Other', key: 'other' },
] as const

// `?topic=` query param used by the /beta page to preselect a subject —
// keeps the beta guide's "Report a bug" / "Feedback and ideas" links from
// having to know the exact SUBJECT_OPTIONS string values.
const TOPIC_TO_SUBJECT: Record<string, (typeof SUBJECT_OPTIONS)[number]['value']> = {
  beta: 'Beta bug report',
  feedback: 'Feedback and ideas',
}

export default function ContactPage() {
  return (
    <Suspense fallback={null}>
      <ContactForm />
    </Suspense>
  )
}

function ContactForm() {
  const searchParams = useSearchParams()
  const t = useTranslations('contact')
  const topic = searchParams.get('topic')
  // Own keys only, so a topic named after a built-in object property selects nothing.
  const preselectedSubject =
    topic && Object.prototype.hasOwnProperty.call(TOPIC_TO_SUBJECT, topic) ? TOPIC_TO_SUBJECT[topic] : undefined

  const [status, setStatus] = useState<Status>('idle')
  const [subjectOption, setSubjectOption] = useState<string>(preselectedSubject ?? '')
  const [otherSubject, setOtherSubject] = useState('')

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setStatus('sending')
    const form = e.currentTarget
    const data = new FormData(form)
    const subject = subjectOption === 'Other' ? otherSubject : subjectOption

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          subject,
          message: data.get('message'),
        }),
      })
      if (res.ok) {
        setStatus('sent')
      } else {
        setErrorMessage(
          res.status === 429
            ? t('rateLimited')
            : null
        )
        setStatus('error')
      }
    } catch {
      setErrorMessage(null)
      setStatus('error')
    }
  }

  return (
    <div className="container py-16 max-w-xl">
      {/* Header */}
      <div className="mb-10 pb-8 border-b">
        <p className="text-sm text-muted-foreground mb-2">{t('eyebrow')}</p>
        <h1 className="text-4xl font-bold tracking-tight mb-3">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('lead')}
        </p>
        <p className="text-muted-foreground text-sm mt-2">
          {t.rich('bugReport', {
            link: (chunks) => (
              <a
                href={GITHUB_ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground transition-colors"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
        <p className="text-muted-foreground text-sm mt-2">
          {t.rich('preferEmail', {
            address: SUPPORT_EMAIL,
            email: (chunks) => (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="underline underline-offset-4 hover:text-foreground transition-colors"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>

      {status === 'sent' ? (
        <div className="rounded-lg border bg-muted/50 p-8 text-center">
          <p className="text-lg font-medium mb-1">{t('sentTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('sentBody')}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder={t('emailPlaceholder')}
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subject">{t('subject')}</Label>
            <Select value={subjectOption} onValueChange={setSubjectOption} required name="subject">
              <SelectTrigger id="subject" className="w-full">
                <SelectValue placeholder={t('subjectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {SUBJECT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(`subjects.${option.key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {subjectOption === 'Other' && (
            <div className="space-y-1.5">
              <Label htmlFor="other-subject">{t('otherSubject')}</Label>
              <Input
                id="other-subject"
                name="other-subject"
                type="text"
                required
                value={otherSubject}
                onChange={(e) => setOtherSubject(e.target.value)}
                placeholder={t('otherSubjectPlaceholder')}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="message">{t('message')}</Label>
            <Textarea
              id="message"
              name="message"
              required
              rows={6}
              placeholder={t('messagePlaceholder')}
            />
          </div>

          {status === 'error' && (
            <p className="text-sm text-destructive">
              {errorMessage ??
                t.rich('failed', {
                  address: SUPPORT_EMAIL,
                  email: (chunks) => (
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4">
                      {chunks}
                    </a>
                  ),
                })}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={status === 'sending'}>
            {status === 'sending' ? t('sending') : t('send')}
          </Button>
        </form>
      )}
    </div>
  )
}
