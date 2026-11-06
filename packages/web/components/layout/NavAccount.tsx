'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import NextLink from 'next/link'
import { useTranslations } from 'next-intl'
import type { Session } from '@supabase/supabase-js'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AccountMenuLoader, preloadAccountMenu } from '@/components/layout/AccountMenuLoader'
import { ACCOUNT_AVATAR_BUTTON_CLASS } from '@/components/layout/AccountAvatar'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Who the header shows as signed in, resolved in the browser. The header is part of every
 * marketing page, which are rendered once at build time, so it can't read the session on the
 * server. `loading` until the browser has read the session cookie.
 *
 * Display only: the server checks the session itself on every signed-in page and route
 * (proxy.ts, the (app) layout, each API route).
 */
export type NavAccountState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; email: string; initials?: string }

/**
 * A Supabase session cookie (`sb-<project>-auth-token`, or its `.0`, `.1`… chunks). Only a hint
 * that the visitor is probably signed in (sizes the skeleton, preloads the menu); who is signed in
 * comes from `getSession()`.
 */
export const SESSION_COOKIE_PATTERN = /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/

const LOADING: NavAccountState = { status: 'loading' }
const SIGNED_OUT: NavAccountState = { status: 'signedOut' }

/** The header's state for a session (or none). Initials are the first two letters of the email. */
export function accountStateFor(session: Session | null | undefined): NavAccountState {
  const user = session?.user
  if (!user) return SIGNED_OUT
  const email = user.email ?? ''
  return { status: 'signedIn', email, initials: email ? email.slice(0, 2).toUpperCase() : undefined }
}

const NavAccountContext = createContext<NavAccountState>(LOADING)

/** The header's account state, shared by the desktop slot and the mobile panel. */
export function useNavAccount(): NavAccountState {
  return useContext(NavAccountContext)
}

/**
 * Reads the session once in the browser (`getSession()`: the session cookie, no request to
 * Supabase unless the access token needs refreshing) and follows later changes (sign-in in
 * another tab, sign-out), for the account controls inside it.
 */
export function NavAccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<NavAccountState>(LOADING)

  useEffect(() => {
    let active = true
    const supabase = createClient()
    const apply = (session: Session | null) => {
      if (!active) return
      const next = accountStateFor(session)
      if (next.status === 'signedIn') preloadAccountMenu()
      setAccount(next)
    }
    // The menu's chunk loads alongside the session read when the cookie says signed in.
    if (SESSION_COOKIE_PATTERN.test(document.cookie)) preloadAccountMenu()
    supabase.auth.getSession().then(
      ({ data }) => apply(data.session),
      () => apply(null)
    )
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => apply(session))
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return <NavAccountContext.Provider value={account}>{children}</NavAccountContext.Provider>
}

/** The signed-out buttons' classes; the skeleton copies them so it takes exactly their box. */
const SIGN_IN_CLASS = 'border border-transparent'
const GET_STARTED_CLASS = 'border border-primary'

/**
 * A pulsing block the exact size of one button: the button's own classes and label, hidden, with
 * the skeleton laid over it. Sized by the real text, so it fits every language.
 */
function ButtonSkeleton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      <span className={cn(buttonVariants({ size: 'sm' }), className, 'invisible')}>{children}</span>
      <Skeleton className="absolute inset-0 motion-reduce:animate-none" />
    </span>
  )
}

/** The signed-out controls: Sign in and Get started. */
function SignedOutButtons() {
  const t = useTranslations('nav')
  return (
    <>
      {/* The theme toggle and the GitHub badge have a 1px border; these two get one too (transparent
          or the fill colour), so all four are the same 36px box and the browser snaps
          them to the same device pixels at any zoom. */}
      <Button variant="ghost" size="sm" className={SIGN_IN_CLASS} asChild>
        <NextLink href="/auth/sign-in">{t('signIn')}</NextLink>
      </Button>
      <Button size="sm" className={GET_STARTED_CLASS} asChild>
        <NextLink href="/auth/sign-up">{t('getStarted')}</NextLink>
      </Button>
    </>
  )
}

/** Hides the account skeleton when scripts don't run (the `<noscript>` buttons stand in). */
const NO_SCRIPT_CSS = '[data-nav-account-skeleton]{display:none}'

/**
 * Runs while the server HTML is parsed, before the first paint: when the browser holds a
 * Supabase session cookie (`sb-<project>-auth-token`, or its `.0`, `.1`… chunks), the skeleton
 * takes the account button's box instead of the two sign-in buttons', so a signed-in visitor sees
 * no layout shift either. Only a size hint: who is signed in still comes from `getSession()`.
 *
 * Accepted by design: when the cookie is there but the session turns out to be gone (expired,
 * revoked), the account-button-sized block gives way to the wider sign-in buttons once.
 */
export const SESSION_HINT_SCRIPT = `(function(s){try{if(/${SESSION_COOKIE_PATTERN.source}/.test(document.cookie))s.previousElementSibling.setAttribute("data-session","in")}catch(e){}})(document.currentScript)`

/**
 * The header's account controls from md up: the account menu when signed in, Sign in and Get
 * started when not.
 *
 * While the session is read, a skeleton holds the place of the control that will show: the two
 * signed-out buttons (measured from their real labels), or the 36px account button when the
 * browser holds a session cookie ({@link SESSION_HINT_SCRIPT}), so nothing moves when it
 * resolves. It is marked busy, with a screen-reader-only label, and doesn't pulse for visitors
 * who ask for reduced motion. Without scripts, `<noscript>` shows the signed-out buttons instead,
 * for crawlers and no-JS visitors.
 */
export function NavAccountSlot() {
  const t = useTranslations('nav')
  const account = useNavAccount()

  if (account.status === 'signedIn') return <AccountMenuLoader email={account.email} initials={account.initials} />
  if (account.status === 'signedOut') return <SignedOutButtons />

  return (
    <>
      {/* `data-session` is set by the script below before React hydrates: not a mismatch. */}
      <div
        data-nav-account-skeleton=""
        aria-busy="true"
        className="group flex items-center gap-2.5"
        suppressHydrationWarning
      >
        <span className="sr-only">{t('loadingAccount')}</span>
        <span aria-hidden="true" className="flex items-center gap-2.5 group-data-[session=in]:hidden">
          <ButtonSkeleton className={SIGN_IN_CLASS}>{t('signIn')}</ButtonSkeleton>
          <ButtonSkeleton className={GET_STARTED_CLASS}>{t('getStarted')}</ButtonSkeleton>
        </span>
        <Skeleton
          aria-hidden="true"
          data-testid="nav-account-skeleton-signed-in"
          className={cn(ACCOUNT_AVATAR_BUTTON_CLASS, 'hidden group-data-[session=in]:block motion-reduce:animate-none')}
        />
      </div>
      <script dangerouslySetInnerHTML={{ __html: SESSION_HINT_SCRIPT }} />
      <noscript>
        <style>{NO_SCRIPT_CSS}</style>
        <span className="flex items-center gap-2.5">
          <SignedOutButtons />
        </span>
      </noscript>
    </>
  )
}
