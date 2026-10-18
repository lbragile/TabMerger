'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  Bug,
  Check,
  CircleHelp,
  Coins,
  Gauge,
  Hourglass,
  Loader2,
  PackageX,
  Puzzle,
  Repeat,
  Shuffle,
  type LucideIcon,
} from 'lucide-react'
import {
  UNINSTALL_SURVEY_API_PATH,
  UNINSTALL_SURVEY_LIMITS,
  UNINSTALL_SURVEY_REASONS,
  type UninstallSurveyBrowser,
  type UninstallSurveyChannel,
  type UninstallSurveyReasonId,
} from '@tabmerger/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { isEmailAddress } from '@/lib/emailAddress'
import { cn } from '@/lib/utils'

/** One icon per reason, purely decorative; the label carries the meaning. */
const REASON_ICONS: Record<UninstallSurveyReasonId, LucideIcon> = {
  'hard-to-use': CircleHelp,
  'missing-feature': Puzzle,
  bug: Bug,
  'lost-data': PackageX,
  slow: Gauge,
  price: Coins,
  switched: Shuffle,
  'not-needed': Hourglass,
  temporary: Repeat,
  other: Check,
}

const ERROR_TEXT = 'text-sm text-destructive dark:text-red-400'

/** The card: a small browser window (tab strip, then the content), like the 404/500 illustration. */
function WindowCard({ children }: { children: ReactNode }) {
  const t = useTranslations('uninstalled.form')
  return (
    <div className="min-w-0 overflow-hidden border border-border bg-card shadow-sh3">
      <div aria-hidden="true" className="flex items-end gap-1 border-b border-border bg-surface2 px-2 pt-2">
        <span className="mb-2.5 mr-1.5 flex gap-1">
          <span className="h-2 w-2 rounded-full bg-border2" />
          <span className="h-2 w-2 rounded-full bg-border2" />
          <span className="h-2 w-2 rounded-full bg-border2" />
        </span>
        <span className="flex h-7 items-center gap-1.5 border border-b-0 border-border bg-card px-2.5 text-[0.6875rem] font-medium text-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          {t('cardTab')}
        </span>
      </div>
      <div className="p-5 sm:p-7">{children}</div>
    </div>
  )
}

type Status = 'idle' | 'sending' | 'sent' | 'error'

interface UninstallSurveyFormProps {
  /** Already parsed by `parseUninstallSurveyParams` on the server. */
  version?: string
  browser?: UninstallSurveyBrowser
  channel?: UninstallSurveyChannel
}

/**
 * The one optional question on `/uninstalled`. Posts to the uninstall-feedback route, which
 * validates everything again; the checks here only explain what is missing.
 */
export function UninstallSurveyForm({ version, browser, channel }: UninstallSurveyFormProps) {
  const id = useId()
  const t = useTranslations('uninstalled.form')
  const [reasons, setReasons] = useState<UninstallSurveyReasonId[]>([])
  const [details, setDetails] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [rateLimited, setRateLimited] = useState(false)
  const [answerError, setAnswerError] = useState(false)
  const [emailError, setEmailError] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const firstReasonRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  // Move focus to the result so keyboard and screen reader users land on it.
  useEffect(() => {
    if (status === 'sent' || status === 'error') resultRef.current?.focus()
  }, [status])

  const answerErrorId = `${id}-answer-error`
  const emailErrorId = `${id}-email-error`
  const emailHintId = `${id}-email-hint`
  const countId = `${id}-count`
  const toggle = (reason: UninstallSurveyReasonId) => {
    setAnswerError(false)
    setReasons((prev) => (prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]))
  }

  const send = async () => {
    const hasAnswer = reasons.length > 0 || details.trim().length > 0
    const trimmedEmail = email.trim()
    const emailOk = trimmedEmail === '' || isEmailAddress(trimmedEmail)
    setAnswerError(!hasAnswer)
    setEmailError(!emailOk)
    if (!hasAnswer) {
      firstReasonRef.current?.focus()
      return
    }
    if (!emailOk) {
      emailRef.current?.focus()
      return
    }

    setStatus('sending')
    try {
      const res = await fetch(UNINSTALL_SURVEY_API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reasons,
          details: details.trim(),
          email: trimmedEmail,
          version,
          browser,
          channel,
          website,
        }),
      })
      setRateLimited(res.status === 429)
      setStatus(res.ok ? 'sent' : 'error')
    } catch {
      setRateLimited(false)
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <WindowCard>
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          className="flex flex-col items-center py-6 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true" className="grid h-12 w-12 place-items-center bg-primary/15 text-primary">
            <Check className="h-6 w-6" />
          </span>
          <p className="mb-1 mt-4 text-lg font-semibold">{t('sentTitle')}</p>
          <p className="text-sm text-text2">{t('sentBody')}</p>
        </div>
      </WindowCard>
    )
  }

  return (
    <WindowCard>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
        className="space-y-6"
      >
        <fieldset aria-describedby={answerError ? answerErrorId : undefined} className="space-y-3">
          <legend className="mb-1 text-base font-semibold">{t('question')}</legend>
          <p className="text-sm text-text2">{t('pickMany')}</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {UNINSTALL_SURVEY_REASONS.map((reason, i) => {
              const inputId = `${id}-reason-${reason.id}`
              const checked = reasons.includes(reason.id)
              const Icon = REASON_ICONS[reason.id]
              return (
                <li key={reason.id} className="group relative min-w-0">
                  <input
                    ref={i === 0 ? firstReasonRef : undefined}
                    id={inputId}
                    type="checkbox"
                    name="reasons"
                    value={reason.id}
                    checked={checked}
                    onChange={() => toggle(reason.id)}
                    className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
                  />
                  <label
                    htmlFor={inputId}
                    className={cn(
                      'flex h-full min-h-[3.25rem] cursor-pointer items-center gap-2.5 border px-3 py-2 text-sm transition-colors motion-reduce:transition-none',
                      'group-hover:bg-surface2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                      checked ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-text2'
                    )}
                  >
                    <Icon
                      className={cn('h-4 w-4 shrink-0', checked ? 'text-primary' : 'text-text3')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">{t(`reasons.${reason.id}`)}</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid h-4 w-4 shrink-0 place-items-center border transition-colors motion-reduce:transition-none',
                        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border2'
                      )}
                    >
                      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-details`}>{t('details')}</Label>
          <Textarea
            id={`${id}-details`}
            name="details"
            rows={5}
            maxLength={UNINSTALL_SURVEY_LIMITS.details}
            value={details}
            onChange={(e) => {
              setAnswerError(false)
              setDetails(e.target.value)
            }}
            aria-describedby={cn(countId, answerError && answerErrorId)}
          />
          <p id={countId} className="text-right text-xs tabular-nums text-text2">
            {t('characterCount', { count: details.length, max: UNINSTALL_SURVEY_LIMITS.details })}
          </p>
        </div>

        {answerError && (
          <p id={answerErrorId} className={ERROR_TEXT}>
            {t('needAnswer')}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-email`}>{t('email')}</Label>
          <p id={emailHintId} className="text-xs text-text2">
            {t('emailHint')}
          </p>
          <Input
            ref={emailRef}
            id={`${id}-email`}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={UNINSTALL_SURVEY_LIMITS.email}
            value={email}
            onChange={(e) => {
              setEmailError(false)
              setEmail(e.target.value)
            }}
            aria-invalid={emailError || undefined}
            aria-describedby={cn(emailHintId, emailError && emailErrorId)}
          />
          {emailError && (
            <p id={emailErrorId} className={ERROR_TEXT}>
              {t('emailInvalid')}
            </p>
          )}
        </div>

        {/* Honeypot: hidden from people and screen readers; bots that fill every field give themselves away. */}
        <div aria-hidden="true" inert className="absolute -left-[625rem] h-px w-px overflow-hidden">
          <label htmlFor={`${id}-website`}>{t('honeypot')}</label>
          <input
            id={`${id}-website`}
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {status === 'error' && (
          <div
            ref={resultRef}
            tabIndex={-1}
            role="alert"
            className="border border-destructive/50 bg-destructive/5 p-4 text-sm space-y-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="font-medium text-destructive dark:text-red-400">
              {rateLimited
                ? t('rateLimited')
                : t('failed')}
            </p>
            <p className="text-text2">
              {t.rich('stillFailing', {
                link: (chunks) => (
                  <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={status === 'sending'}>
          {status === 'sending' && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
          {status === 'sending' ? t('sending') : status === 'error' ? t('tryAgain') : t('send')}
        </Button>
      </form>
    </WindowCard>
  )
}
