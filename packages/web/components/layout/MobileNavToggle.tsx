'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SignOutForm } from '@/components/auth/SignOutForm'

const links = [
    { href: '/features', label: 'Features' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/changelog', label: 'Changelog' },
    { href: '/faq', label: 'FAQ' },
]

interface MobileNavToggleProps {
    email?: string
    initials?: string
}

// ponytail: plain useState toggle instead of a headless-menu lib — four static
// links plus a handful of auth links, no focus-trap/nested-menu needs that
// would justify the dependency.
export function MobileNavToggle({ email, initials }: MobileNavToggleProps) {
    const [open, setOpen] = useState(false)

    return (
        <div className="md:hidden">
            <button
                type="button"
                aria-label={open ? 'Close menu' : 'Open menu'}
                aria-expanded={open}
                aria-controls="mobile-nav-panel"
                onClick={() => setOpen((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-text2 hover:bg-surface2 hover:text-foreground"
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
                            {link.label}
                        </Link>
                    ))}
                    <div className="my-1 border-t border-border" />
                    {initials ? (
                        <>
                            <div className="px-3 py-1.5 text-[13px] font-medium text-foreground">{email}</div>
                            <Link
                                href="/dashboard"
                                onClick={() => setOpen(false)}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                Dashboard
                            </Link>
                            <Link
                                href="/account"
                                onClick={() => setOpen(false)}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                Account
                            </Link>
                            <SignOutForm>
                                <button
                                    type="submit"
                                    onClick={() => setOpen(false)}
                                    className="flex h-10 w-full items-center rounded-lg px-3 text-left text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                                >
                                    Sign out
                                </button>
                            </SignOutForm>
                        </>
                    ) : (
                        <>
                            <Link
                                href="/auth/sign-in"
                                onClick={() => setOpen(false)}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                            >
                                Sign in
                            </Link>
                            <Link
                                href="/auth/sign-up"
                                onClick={() => setOpen(false)}
                                className="flex h-10 items-center rounded-lg px-3 text-[14px] font-medium text-primary transition-colors hover:bg-surface2"
                            >
                                Get started
                            </Link>
                        </>
                    )}
                </nav>
            )}
        </div>
    )
}
