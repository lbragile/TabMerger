'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Cookie } from 'lucide-react'
import { Link, usePathname } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  closeCookieSettings,
  getConsentNotice,
  getEffectiveConsent,
  isCookieSettingsOpen,
  setConsentChoice,
  subscribeConsent,
  type ConsentChoice,
} from '@/lib/consent'

// Opt-out regions and Global Privacy Control count as a choice too, so neither shows the banner.
const hasChoice = () => getEffectiveConsent() !== null
// The server never knows the choice, so it renders no banner; the browser shows it once hydrated.
const serverHasChoice = () => true
const serverSettingsOpen = () => false
const serverNotice = () => 'ask' as const

const NOTICE_MESSAGE = { ask: 'message', on: 'messageOn', gpc: 'messageGpc' } as const

/** Tailwind's `sm` breakpoint: from here up the banner is a corner card; below it, a chip first. */
export const WIDE_VIEWPORT_QUERY = '(min-width: 40rem)'

function subscribeViewport(onChange: () => void): () => void {
  const mq = window.matchMedia?.(WIDE_VIEWPORT_QUERY)
  mq?.addEventListener?.('change', onChange)
  return () => mq?.removeEventListener?.('change', onChange)
}
// No matchMedia (old browsers, jsdom): the full card, which works everywhere.
const isWideViewport = () => window.matchMedia?.(WIDE_VIEWPORT_QUERY)?.matches ?? true
const serverIsWide = () => true

/** On the home page the banner waits until the visitor has scrolled this far into the page. */
export const HOME_REVEAL_FRACTION = 0.8
const scrolledPastFold = () =>
  typeof window !== 'undefined' && window.scrollY > HOME_REVEAL_FRACTION * window.innerHeight

/**
 * The cookie banner: asks once whether analytics may use cookies, and again whenever the visitor
 * opens "Cookie settings" in the footer. A card fixed to the bottom-left corner (toasts use the
 * bottom-right), so it shifts no content, never blocks the page, and doesn't take focus on its
 * own. On phones it starts as a small "Cookie choices" chip with no buttons in it, and expands to
 * the card on tap. On the home page it appears once the visitor scrolls past the first screen;
 * scrolling only reveals it, it never counts as a choice. Accept and Reject look the same, so
 * neither is the easy way out.
 *
 * Only opt-in regions (and unknown ones) see it unasked. Elsewhere, and for a browser sending
 * Global Privacy Control, it opens only from "Cookie settings", saying whether analytics are on.
 */
export function CookieConsentBanner() {
  const t = useTranslations('consent')
  const choiceStored = useSyncExternalStore(subscribeConsent, hasChoice, serverHasChoice)
  const settingsOpen = useSyncExternalStore(subscribeConsent, isCookieSettingsOpen, serverSettingsOpen)
  const notice = useSyncExternalStore(subscribeConsent, getConsentNotice, serverNotice)
  const wide = useSyncExternalStore(subscribeViewport, isWideViewport, serverIsWide)
  const isHome = usePathname() === '/'
  // Read once on mount, so a page that loads already scrolled down shows it straight away.
  const [revealedByScroll, setRevealedByScroll] = useState(scrolledPastFold)
  const [expanded, setExpanded] = useState(false)
  const cardId = useId()
  const regionRef = useRef<HTMLElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  // Where focus was when "Cookie settings" opened the banner, so a choice can hand it back.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  // Focus to move once the chip or the card it opens has rendered.
  const pendingFocusRef = useRef<'chip' | 'card' | null>(null)

  // Opened on request: move focus into the banner (the visitor just asked for it). Opened on
  // first load: leave focus alone.
  useEffect(() => {
    if (!settingsOpen) return
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    regionRef.current?.focus()
  }, [settingsOpen])

  // Home page: wait for the visitor to scroll past most of the first screen, then stop listening.
  useEffect(() => {
    if (!isHome || revealedByScroll || choiceStored) return
    const onScroll = () => {
      if (!scrolledPastFold()) return
      window.removeEventListener('scroll', onScroll)
      setRevealedByScroll(true)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isHome, revealedByScroll, choiceStored])

  useEffect(() => {
    const target = pendingFocusRef.current
    if (!target) return
    pendingFocusRef.current = null
    ;(target === 'chip' ? chipRef : regionRef).current?.focus()
  })

  if (choiceStored && !settingsOpen) return null
  if (isHome && !revealedByScroll && !settingsOpen) return null

  const open = wide || expanded || settingsOpen

  const choose = (choice: ConsentChoice) => {
    const returnTo = returnFocusRef.current
    returnFocusRef.current = null
    setExpanded(false)
    setConsentChoice(choice)
    if (returnTo?.isConnected) returnTo.focus()
  }

  const expand = () => {
    pendingFocusRef.current = 'card'
    setExpanded(true)
  }

  // Phones only: back to the chip, or, when "Cookie settings" opened it over a stored choice,
  // closed again with that choice unchanged.
  const collapse = () => {
    const returnTo = returnFocusRef.current
    returnFocusRef.current = null
    setExpanded(false)
    setRevealedByScroll(true) // seen once: the chip stays, even back at the top of the home page
    closeCookieSettings()
    if (!choiceStored) pendingFocusRef.current = 'chip'
    else if (returnTo?.isConnected) returnTo.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || wide) return
    event.stopPropagation()
    collapse()
  }

  // The card sits in the bottom start corner: bottom-left, or bottom-right in a right-to-left
  // language. Physical sides on purpose, each paired with its own `env(safe-area-inset-*)`
  // (there is no logical safe-area inset): both sides on phones, where it spans the width, and
  // from `sm` one side per direction through `ltr:`/`rtl:`.
  return (
    <div
      className={cn(
        'pointer-events-none fixed z-50 flex flex-col items-start',
        'bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))]',
        'sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))]',
        'sm:ltr:right-auto sm:ltr:left-[max(1.5rem,env(safe-area-inset-left))]',
        'sm:rtl:left-auto sm:rtl:right-[max(1.5rem,env(safe-area-inset-right))]'
      )}
    >
      {!open && (
        <button
          ref={chipRef}
          type="button"
          aria-expanded={false}
          aria-controls={cardId}
          onClick={expand}
          className="pointer-events-auto inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-popover px-4 text-sm font-medium text-popover-foreground shadow-sh2 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Cookie aria-hidden="true" className="size-4 shrink-0" />
          {t('chip')}
        </button>
      )}
      <section
        ref={regionRef}
        id={cardId}
        aria-label={t('label')}
        tabIndex={-1}
        hidden={!open}
        onKeyDown={onKeyDown}
        className={cn(
          'pointer-events-auto relative flex w-full max-w-[22rem] flex-col gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-sh2 outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !open && 'hidden'
        )}
      >
        {/* First in the tab order, as it is first on screen (top corner). */}
        {!wide && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('collapse')}
            onClick={collapse}
            className="absolute inset-e-1.5 top-1.5 h-9 w-9 text-text2"
          >
            <ChevronDown aria-hidden="true" className="size-4" />
          </Button>
        )}
        <p className={cn('text-sm leading-normal text-text2', !wide && 'pe-8')}>
          {t(NOTICE_MESSAGE[notice])}{' '}
          <Link
            href="/privacy#cookies"
            className="whitespace-nowrap font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('learnMore')}
          </Link>
        </p>
        {/* Two equal columns: both buttons are always the same size, whatever their labels. */}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="w-full" onClick={() => choose('granted')}>
            {t('accept')}
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={() => choose('denied')}>
            {t('reject')}
          </Button>
        </div>
      </section>
    </div>
  )
}
