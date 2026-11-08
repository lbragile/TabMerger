'use client'

import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react'
import NextLink from 'next/link'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Star } from 'lucide-react'
import { SignOutForm } from '@/components/auth/SignOutForm'
import { GitHubMark } from '@/components/GitHubMark'
import { GITHUB_REPO_URL } from '@/lib/github'
import { useGithubRepoLabel, useStarCount } from '@/components/layout/githubLabels'
import { NO_CAPTURE_CLASS } from '@/lib/analyticsPrivacy'
import { Skeleton } from '@/components/ui/skeleton'
import { useNavAccount, type NavAccountState } from '@/components/layout/NavAccount'
import { NAV_LINKS } from '@/components/layout/navLinks'


interface MobileNavToggleProps {
    /**
     * Who is signed in. Defaults to the header's state (`NavAccountProvider`), resolved in the
     * browser; `loading` until then.
     */
    account?: NavAccountState
    /**
     * The repository star count, fetched on the server and handed down unresolved: this
     * component never calls GitHub itself. Resolves to null when the count is unavailable.
     */
    starsPromise?: Promise<number | null>
}

const GITHUB_ROW_CLASS =
    'flex h-10 items-center gap-2 rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground sm:hidden'

/** The panel's GitHub row. `count` is undefined while loading and null when unavailable. */
function GithubRow({ count, onNavigate }: { count?: number | null; onNavigate: () => void }) {
    const t = useTranslations('nav')
    const repoLabel = useGithubRepoLabel(count)
    const formatStars = useStarCount()
    return (
        <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={repoLabel}
            onClick={onNavigate}
            className={GITHUB_ROW_CLASS}
        >
            <GitHubMark className="size-4 shrink-0" />
            {t('github')}
            {typeof count === 'number' && (
                <span className="ms-auto flex items-center gap-1 text-[13px] tabular-nums">
                    <Star aria-hidden="true" className="size-3.5 shrink-0" />
                    {formatStars(count)}
                </span>
            )}
        </a>
    )
}

function GithubRowWithCount({ starsPromise, onNavigate }: { starsPromise: Promise<number | null>; onNavigate: () => void }) {
    return <GithubRow count={use(starsPromise)} onNavigate={onNavigate} />
}

/** The open panel's id, named by the toggle's `aria-controls` while the panel exists. */
const MOBILE_NAV_PANEL_ID = 'mobile-nav-panel'

// ponytail: plain useState toggle instead of a headless-menu lib — four static
// links plus a handful of auth links, no focus-trap/nested-menu needs that
// would justify the dependency.
/**
 * The phone-width menu: a disclosure button and the `<nav>` panel it shows. The panel is only
 * rendered while open, so `aria-controls` is set only then (it must name an element that exists).
 * Escape closes it, and closing from inside the panel (Escape, or a link or button in it) puts
 * focus back on the toggle, since the focused element goes away with the panel.
 */
export function MobileNavToggle({ account: accountProp, starsPromise }: MobileNavToggleProps) {
    const [open, setOpen] = useState(false)
    const t = useTranslations('nav')
    const headerAccount = useNavAccount()
    const account = accountProp ?? headerAccount
    const containerRef = useRef<HTMLDivElement>(null)
    const toggleRef = useRef<HTMLButtonElement>(null)

    /** Closes the panel and returns focus to the toggle. */
    const close = useCallback(() => {
        setOpen(false)
        toggleRef.current?.focus()
    }, [])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            // Only when the menu has the focus (or nothing does): an Escape meant for another
            // open layer (a dropdown elsewhere in the header) must not also close this panel or
            // move focus out of that layer.
            const active = document.activeElement
            if (active && active !== document.body && !containerRef.current?.contains(active)) return
            close()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [open, close])

    return (
        <div ref={containerRef} className="md:hidden">
            <button
                ref={toggleRef}
                type="button"
                aria-label={open ? t('closeMenu') : t('openMenu')}
                aria-expanded={open}
                aria-controls={open ? MOBILE_NAV_PANEL_ID : undefined}
                onClick={() => setOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text2 hover:bg-surface2 hover:text-foreground"
            >
                <span aria-hidden="true" className="text-lg leading-none">
                    {open ? '✕' : '☰'}
                </span>
            </button>
            {open && (
                <nav
                    id={MOBILE_NAV_PANEL_ID}
                    aria-label={t('mobileMenu')}
                    className="absolute inset-x-0 top-16 z-40 flex flex-col gap-1 border-b border-border bg-background p-4"
                >
                    {NAV_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={close}
                            className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                        >
                            {t(link.label)}
                        </Link>
                    ))}
                    {/* The bar itself shows the badge from sm up, so this row is for narrower screens. */}
                    {starsPromise ? (
                        <Suspense fallback={<GithubRow onNavigate={close} />}>
                            <GithubRowWithCount starsPromise={starsPromise} onNavigate={close} />
                        </Suspense>
                    ) : (
                        <GithubRow onNavigate={close} />
                    )}
                    <div className="my-1 border-t border-border" />
                    {account.status === 'loading' ? (
                        // Opened before the session was read: one row holds the place of the account links.
                        <div aria-busy="true" className="flex h-10 items-center px-3">
                            <span className="sr-only">{t('loadingAccount')}</span>
                            <Skeleton aria-hidden="true" className="h-4 w-32 motion-reduce:animate-none" />
                        </div>
                    ) : account.status === 'signedIn' ? (
                        <>
                            <div className={`px-3 py-1.5 text-[13px] font-medium text-foreground ${NO_CAPTURE_CLASS}`}>{account.email}</div>
                            <Link
                                href="/dashboard"
                                onClick={close}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                {t('dashboard')}
                            </Link>
                            <Link
                                href="/account"
                                onClick={close}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                {t('account')}
                            </Link>
                            <SignOutForm>
                                <button
                                    type="submit"
                                    onClick={close}
                                    className="flex h-10 w-full items-center rounded-lg px-3 text-start text-[14px] text-text2 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                                >
                                    {t('signOut')}
                                </button>
                            </SignOutForm>
                        </>
                    ) : (
                        <>
                            <NextLink
                                href="/auth/sign-in"
                                onClick={close}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                {t('signIn')}
                            </NextLink>
                            <NextLink
                                href="/auth/sign-up"
                                onClick={close}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] font-medium text-primary transition-colors hover:bg-surface2"
                            >
                                {t('getStarted')}
                            </NextLink>
                        </>
                    )}
                </nav>
            )}
        </div>
    )
}
