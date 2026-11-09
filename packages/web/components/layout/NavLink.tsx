'use client'

import type { ComponentProps } from 'react'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

/**
 * Whether the nav link to `href` belongs to the page at `pathname`: the page itself or any page
 * below it (`/compare/onetab` for `/compare`), but not a sibling that merely shares the prefix
 * (`/pricingx` is not `/pricing`). Both are locale-free paths, as the locale-aware
 * `usePathname` returns them (`/es/pricing` reads as `/pricing`).
 */
export function isNavLinkActive(pathname: string, href: string): boolean {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(`${href}/`)
}

type NavLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & {
    /** A locale-free path, e.g. `/pricing`. */
    href: string
    /** Classes added only while the link's page is showing. */
    activeClassName?: string
}

/**
 * A header/menu link that marks itself as the current page (`aria-current="page"` plus
 * `activeClassName`). A client leaf so the header around it can stay a server component; the
 * pathname is known while rendering, so the active state is in the server HTML too.
 */
export function NavLink({ href, className, activeClassName, ...props }: NavLinkProps) {
    const active = isNavLinkActive(usePathname() ?? '', href)
    return (
        <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(className, active && activeClassName)}
            {...props}
        />
    )
}
