'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Skeleton } from '@/components/ui/skeleton'
import { ACCOUNT_AVATAR_BUTTON_CLASS } from '@/components/layout/AccountAvatar'
import { cn } from '@/lib/utils'

/** Loads the account menu's chunk (Radix dropdown code). Safe to call more than once. */
export const loadAccountMenu = () => import('@/components/layout/AccountMenu').then((m) => m.AccountMenu)

/**
 * Starts loading the menu's chunk ahead of rendering it (once the header knows, or guesses from
 * the session cookie, that the visitor is signed in), so the button appears without a gap.
 * Failures are left to the render, which retries the import.
 */
export function preloadAccountMenu(): void {
  loadAccountMenu().catch(() => {})
}

/**
 * The 36px account button's place while its chunk loads: same box as the button, busy, with a
 * screen-reader-only label, no pulse under reduced motion. Shared with the header's signed-in
 * skeleton so the box never changes size between the two.
 */
export function AccountButtonSkeleton() {
  const t = useTranslations('nav')
  return (
    <span aria-busy="true" className="relative inline-flex">
      <span className="sr-only">{t('loadingAccount')}</span>
      <Skeleton aria-hidden="true" className={cn(ACCOUNT_AVATAR_BUTTON_CLASS, 'block motion-reduce:animate-none')} />
    </span>
  )
}

// A client-side dynamic import, not an `await import()` in the server Navbar: Next's client
// manifest lists the chunks of every client module a server module can reach, so the latter
// would still ship the menu's Radix code to signed-out visitors. This way the chunk is
// requested only when a signed-in visitor's page actually renders the menu (or the header
// preloads it). Until it arrives, the button's box holds a skeleton: no layout shift.
// The import is written out here (not `dynamic(loadAccountMenu)`): Next only wires a dynamic
// import it can see inside the `dynamic()` call. Same module as `loadAccountMenu`, so one chunk.
const AccountMenu = dynamic(() => import('@/components/layout/AccountMenu').then((m) => m.AccountMenu), {
  loading: () => <AccountButtonSkeleton />,
})

export function AccountMenuLoader(props: { email: string; initials?: string }) {
  return <AccountMenu {...props} />
}
