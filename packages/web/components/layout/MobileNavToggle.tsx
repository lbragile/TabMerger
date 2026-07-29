'use client'

import { useState } from 'react'
import Link from 'next/link'

const links = [
    { href: '/features', label: 'Features' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/changelog', label: 'Changelog' },
    { href: '/faq', label: 'FAQ' },
]

// ponytail: plain useState toggle instead of a headless-menu lib — four static
// links, no focus-trap/nested-menu needs that would justify the dependency.
export function MobileNavToggle() {
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
                </nav>
            )}
        </div>
    )
}
