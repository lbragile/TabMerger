'use client'

import { Suspense, use, useState } from 'react'
import NextLink from 'next/link'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Star } from 'lucide-react'
import { SignOutForm } from '@/components/auth/SignOutForm'
import { GitHubMark } from '@/components/GitHubMark'
import { GITHUB_REPO_URL } from '@/lib/github'
import { useGithubRepoLabel, useStarCount } from '@/components/layout/githubLabels'
import { NO_CAPTURE_CLASS } from '@/lib/analyticsPrivacy'

const links = [
    { href: '/features', label: 'features' },
    { href: '/pricing', label: 'pricing' },
    { href: '/changelog', label: 'changelog' },
    { href: '/faq', label: 'faq' },
] as const

interface MobileNavToggleProps {
    email?: string
    initials?: string
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

// ponytail: plain useState toggle instead of a headless-menu lib — four static
// links plus a handful of auth links, no focus-trap/nested-menu needs that
// would justify the dependency.
export function MobileNavToggle({ email, initials, starsPromise }: MobileNavToggleProps) {
    const [open, setOpen] = useState(false)
    const t = useTranslations('nav')

    return (
        <div className="md:hidden">
            <button
                type="button"
                aria-label={open ? t('closeMenu') : t('openMenu')}
                aria-expanded={open}
                aria-controls="mobile-nav-panel"
                onClick={() => setOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text2 hover:bg-surface2 hover:text-foreground"
            >
                <span aria-hidden="true" className="text-lg leading-none">
                    {open ? '✕' : '☰'}
                </span>
            </button>
            {open && (
                <nav
                    id="mobile-nav-panel"
                    className="absolute inset-x-0 top-16 z-40 flex flex-col gap-1 border-b border-border bg-background p-4"
                >
                    {links.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setOpen(false)}
                            className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                        >
                            {t(link.label)}
                        </Link>
                    ))}
                    {/* The bar itself shows the badge from sm up, so this row is for narrower screens. */}
                    {starsPromise ? (
                        <Suspense fallback={<GithubRow onNavigate={() => setOpen(false)} />}>
                            <GithubRowWithCount starsPromise={starsPromise} onNavigate={() => setOpen(false)} />
                        </Suspense>
                    ) : (
                        <GithubRow onNavigate={() => setOpen(false)} />
                    )}
                    <div className="my-1 border-t border-border" />
                    {initials ? (
                        <>
                            <div className={`px-3 py-1.5 text-[13px] font-medium text-foreground ${NO_CAPTURE_CLASS}`}>{email}</div>
                            <Link
                                href="/dashboard"
                                onClick={() => setOpen(false)}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                {t('dashboard')}
                            </Link>
                            <Link
                                href="/account"
                                onClick={() => setOpen(false)}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                {t('account')}
                            </Link>
                            <SignOutForm>
                                <button
                                    type="submit"
                                    onClick={() => setOpen(false)}
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
                                onClick={() => setOpen(false)}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                {t('signIn')}
                            </NextLink>
                            <NextLink
                                href="/auth/sign-up"
                                onClick={() => setOpen(false)}
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
