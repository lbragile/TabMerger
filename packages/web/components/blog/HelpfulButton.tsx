'use client'

import { useEffect, useState } from 'react'
import NextLink from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { cn, safeRedirectPath } from '@/lib/utils'

/** Postgres unique violation: this account already voted (the primary key is slug + user). */
const ALREADY_VOTED = '23505'

/** Shown in place of the count until it has loaded. */
const NO_COUNT = '–'

type Account = 'loading' | 'signedOut' | 'signedIn'

/** A count from `blog_helpful_count` (a bigint, sent as a number), or `null` when unusable. */
function toCount(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null
}

/**
 * "Helpful" for a post: signed-in accounts only, one vote per account, and everyone sees the
 * count. The database is the enforcement (RLS on `blog_post_votes`: a vote can only be added or
 * removed as yourself, the primary key allows one per account, the foreign key only real posts);
 * this button talks to it directly with the browser client, no API route. Everything loads after
 * hydration, so the page itself stays cacheable.
 *
 * States: count loading ("–"); signed out (a click opens the sign-in prompt); signed in, not
 * voted; voted (`aria-pressed`). A vote toggles at once and is rolled back, with a message, if the
 * database refuses it.
 */
export function HelpfulButton({
  slug,
  returnPath,
  announce,
}: {
  slug: string
  /** Where sign-in should return to (this post's `#helpful`); must be a path on this site. */
  returnPath: string
  announce: (message: string) => void
}) {
  const t = useTranslations('blog.interactive')
  const [count, setCount] = useState<number | null>(null)
  // Without Supabase (a build with no keys) there is no account to read: signed out from the start.
  const [account, setAccount] = useState<Account>(isSupabaseConfigured ? 'loading' : 'signedOut')
  const [voted, setVoted] = useState(false)
  const [pending, setPending] = useState(false)
  const [askSignIn, setAskSignIn] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    const supabase = createClient()
    supabase.rpc('blog_helpful_count', { p_slug: slug }).then(
      ({ data, error }) => {
        if (active && !error) setCount(toCount(data))
      },
      () => {}
    )
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return
        if (!data.session) {
          setAccount('signedOut')
          return
        }
        setAccount('signedIn')
        // RLS shows a signed-in account its own votes only.
        const { data: own } = await supabase.from('blog_post_votes').select('post_slug').eq('post_slug', slug).maybeSingle()
        if (active) setVoted(Boolean(own))
      })
      .catch(() => {
        if (active) setAccount('signedOut')
      })
    return () => {
      active = false
    }
  }, [slug])

  const onClick = async () => {
    if (account === 'loading' || pending) return
    if (account === 'signedOut') {
      const next = !askSignIn
      setAskSignIn(next)
      announce(next ? t('signInNotice') : '')
      return
    }
    const wasVoted = voted
    const previousCount = count
    setVoted(!wasVoted)
    if (count !== null) setCount(Math.max(0, count + (wasVoted ? -1 : 1)))
    setPending(true)
    const supabase = createClient()
    const { error } = wasVoted
      ? await supabase.from('blog_post_votes').delete().eq('post_slug', slug)
      : await supabase.from('blog_post_votes').insert({ post_slug: slug })
    setPending(false)
    if (error && !(error.code === ALREADY_VOTED && !wasVoted)) {
      setVoted(wasVoted)
      setCount(previousCount)
      announce(t('voteFailed'))
      return
    }
    if (error) {
      // Already voted (another tab): keep it marked and take the real count.
      const { data } = await supabase.rpc('blog_helpful_count', { p_slug: slug })
      setCount(toCount(data) ?? previousCount)
    }
    announce(wasVoted ? t('unvoted') : t('voted'))
  }

  const redirectTo = encodeURIComponent(safeRedirectPath(returnPath, '/'))
  const pressed = account === 'signedIn' && voted

  return (
    <>
      <button
        type="button"
        aria-pressed={account === 'signedIn' ? pressed : undefined}
        aria-expanded={account === 'signedOut' ? askSignIn : undefined}
        aria-controls={account === 'signedOut' && askSignIn ? 'blog-helpful-sign-in' : undefined}
        aria-disabled={account === 'loading' || pending ? true : undefined}
        aria-label={count === null ? t('helpfulLoadingLabel') : t('helpfulLabel', { count })}
        onClick={onClick}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 border px-3.5 text-[0.9375rem] transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          pressed
            ? 'border-primary bg-primary/10 text-primary dark:bg-accent'
            : 'border-border bg-transparent text-foreground hover:bg-surface3'
        )}
      >
        <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
        <span>{t('helpful')}</span>
        <span className="font-mono tabular-nums">{count === null ? NO_COUNT : count}</span>
      </button>
      {account === 'signedOut' && askSignIn && (
        <div
          id="blog-helpful-sign-in"
          className="order-last flex w-full flex-wrap items-center gap-x-3 gap-y-2 border border-border bg-surface px-3.5 py-3 text-[0.9375rem]"
        >
          <span className="min-w-0 flex-[1_1_14rem]">{t('signInPrompt')}</span>
          <NextLink
            href={`/auth/sign-in?redirectTo=${redirectTo}`}
            className="inline-flex min-h-11 items-center bg-primary px-3.5 font-semibold text-primary-foreground no-underline hover:bg-primary/90"
          >
            {t('signIn')}
          </NextLink>
          <NextLink
            href="/auth/sign-up"
            className="inline-flex min-h-11 items-center border border-border px-3.5 text-foreground no-underline hover:bg-surface3"
          >
            {t('createAccount')}
          </NextLink>
        </div>
      )}
    </>
  )
}
