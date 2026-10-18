'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import {
  getConsentChoice,
  isCookieSettingsOpen,
  setConsentChoice,
  subscribeConsent,
  type ConsentChoice,
} from '@/lib/consent'

const hasChoice = () => getConsentChoice() !== null
// The server never knows the choice, so it renders no banner; the browser shows it once hydrated.
const serverHasChoice = () => true
const serverSettingsOpen = () => false

/**
 * The cookie banner: asks once whether analytics may use cookies, and again whenever the visitor
 * opens "Cookie settings" in the footer. Fixed to the bottom of the viewport so it shifts no
 * content, never blocks the page, and doesn't take focus on its own. Accept and Reject look the
 * same, so neither is the easy way out.
 */
export function CookieConsentBanner() {
  const t = useTranslations('consent')
  const choiceStored = useSyncExternalStore(subscribeConsent, hasChoice, serverHasChoice)
  const settingsOpen = useSyncExternalStore(subscribeConsent, isCookieSettingsOpen, serverSettingsOpen)
  const regionRef = useRef<HTMLElement>(null)
  // Where focus was when "Cookie settings" opened the banner, so a choice can hand it back.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Opened on request: move focus into the banner (the visitor just asked for it). Opened on
  // first load: leave focus alone.
  useEffect(() => {
    if (!settingsOpen) return
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    regionRef.current?.focus()
  }, [settingsOpen])

  if (choiceStored && !settingsOpen) return null

  const choose = (choice: ConsentChoice) => {
    const returnTo = returnFocusRef.current
    returnFocusRef.current = null
    setConsentChoice(choice)
    if (returnTo?.isConnected) returnTo.focus()
  }

  return (
    <section
      ref={regionRef}
      aria-label={t('label')}
      tabIndex={-1}
      className="group pointer-events-none fixed inset-x-0 bottom-0 z-50 p-3 outline-none sm:p-4"
    >
      <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-sh2 group-focus-visible:ring-2 group-focus-visible:ring-ring sm:flex-row sm:items-center sm:gap-4">
        <p className="min-w-0 flex-1 text-sm leading-normal text-text2 sm:leading-relaxed">
          {t('message')}{' '}
          <Link
            href="/privacy#cookies"
            className="whitespace-nowrap font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('learnMore')}
          </Link>
        </p>
        {/* Two equal columns: both buttons are always the same size, whatever their labels. */}
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="w-full" onClick={() => choose('granted')}>
            {t('accept')}
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={() => choose('denied')}>
            {t('reject')}
          </Button>
        </div>
      </div>
    </section>
  )
}
