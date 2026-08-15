'use client'

import type { Metadata } from 'next'
import { useState } from 'react'
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

// Note: metadata must be in a separate server component when using 'use client'.
// SEO is handled via the layout's default metadata.

type Status = 'idle' | 'sending' | 'sent' | 'error'

const SUBJECT_OPTIONS = [
  'Bug report',
  'Billing question',
  'Feature request',
  'Account help',
  'Other',
] as const

export default function ContactPage() {
  const [status, setStatus] = useState<Status>('idle')
  const [subjectOption, setSubjectOption] = useState<string>('')
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
            ? 'Too many messages sent — try again later.'
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
        <p className="text-sm text-muted-foreground mb-2">Support</p>
        <h1 className="text-4xl font-bold tracking-tight mb-3">Contact Us</h1>
        <p className="text-muted-foreground text-sm">
          Have a question, found a bug, or need help with your subscription? We typically reply within one business day.
        </p>
        <p className="text-muted-foreground text-sm mt-2">
          Reporting a bug?{' '}
          <a
            href="https://github.com/lbragile/TabMerger/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground transition-colors"
          >
            Open a GitHub issue
          </a>
          {' '}for faster tracking and visibility.
        </p>
      </div>

      {status === 'sent' ? (
        <div className="rounded-lg border bg-muted/50 p-8 text-center">
          <p className="text-lg font-medium mb-1">Message sent</p>
          <p className="text-sm text-muted-foreground">We'll get back to you shortly.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Select value={subjectOption} onValueChange={setSubjectOption} required name="subject">
              <SelectTrigger id="subject" className="w-full">
                <SelectValue placeholder="Select a reason…" />
              </SelectTrigger>
              <SelectContent>
                {SUBJECT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {subjectOption === 'Other' && (
            <div className="space-y-1.5">
              <Label htmlFor="other-subject">Please specify</Label>
              <Input
                id="other-subject"
                name="other-subject"
                type="text"
                required
                value={otherSubject}
                onChange={(e) => setOtherSubject(e.target.value)}
                placeholder="What's this about?"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              name="message"
              required
              rows={6}
              placeholder="Describe your issue or question in as much detail as helpful."
            />
          </div>

          {status === 'error' && (
            <p className="text-sm text-destructive">
              {errorMessage ?? 'Something went wrong. Please try again or email us directly.'}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send message'}
          </Button>
        </form>
      )}
    </div>
  )
}
