/**
 * Active nav links: `isNavLinkActive`, and the `aria-current="page"` + active look it drives on
 * the header bar's links and the menu panel's rows.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The page being shown, as the locale-aware usePathname returns it (no locale prefix).
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('@/i18n/navigation', async () => ({
  ...(await import('./helpers/intl')).createNavigationMock((await import('next/link')).default),
  usePathname: () => nav.pathname,
}))

// Navbar reads no session itself; the account controls read it in the browser. Signed out.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}))
vi.mock('@/lib/githubStats', () => ({ getGithubStarCount: async () => null }))

import { NavLink, isNavLinkActive } from '@/components/layout/NavLink'
import { Navbar } from '@/components/layout/Navbar'
import { MobileNavToggle } from '@/components/layout/MobileNavToggle'

const MAIN_LINKS = ['Features', 'Pricing', 'Compare', 'Changelog', 'FAQ']

/**
 * Asserts `el` has none of `classes`. `.not.toHaveClass(a, b)` only fails when every one is
 * present, so each class is checked on its own.
 */
function expectNoClass(el: HTMLElement, ...classes: string[]) {
  for (const c of classes) expect(el, c).not.toHaveClass(c)
}

describe('isNavLinkActive', () => {
  it('matches the page itself', () => {
    expect(isNavLinkActive('/pricing', '/pricing')).toBe(true)
  })

  it('matches a page below it', () => {
    expect(isNavLinkActive('/compare/onetab', '/compare')).toBe(true)
    expect(isNavLinkActive('/compare/onetab/details', '/compare')).toBe(true)
  })

  it('does not match a sibling that only shares the prefix', () => {
    expect(isNavLinkActive('/pricingx', '/pricing')).toBe(false)
    expect(isNavLinkActive('/features', '/pricing')).toBe(false)
  })

  it('matches the root only on the home page', () => {
    expect(isNavLinkActive('/', '/')).toBe(true)
    expect(isNavLinkActive('/pricing', '/')).toBe(false)
    expect(isNavLinkActive('/', '/pricing')).toBe(false)
  })
})

describe('NavLink', () => {
  beforeEach(() => {
    nav.pathname = '/'
  })

  it('marks its page as current and adds the active classes', () => {
    nav.pathname = '/pricing'
    render(
      <NavLink href="/pricing" className="px-2 text-text2" activeClassName="bg-primary/10 text-primary">
        x
      </NavLink>
    )
    const link = screen.getByRole('link', { name: 'x' })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveAttribute('href', '/pricing')
    // The active text colour replaces the resting one rather than both being set.
    expect(link).toHaveClass('px-2', 'bg-primary/10', 'text-primary')
    expect(link).not.toHaveClass('text-text2')
  })

  it('leaves other pages unmarked, with only their own classes', () => {
    nav.pathname = '/features'
    render(
      <NavLink href="/pricing" className="px-2 text-text2" activeClassName="bg-primary/10 text-primary">
        x
      </NavLink>
    )
    const link = screen.getByRole('link', { name: 'x' })
    expect(link).not.toHaveAttribute('aria-current')
    expect(link).toHaveClass('px-2', 'text-text2')
    expectNoClass(link, 'bg-primary/10', 'text-primary')
  })

  it('passes other Link props through (onClick)', async () => {
    const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault())
    render(
      <NavLink href="/pricing" onClick={onClick}>
        x
      </NavLink>
    )
    await userEvent.setup().click(screen.getByRole('link', { name: 'x' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Navbar link bar: active page', () => {
  async function renderBar() {
    let container!: HTMLElement
    await act(async () => {
      container = render(await Navbar()).container
    })
    return container.querySelector('header nav') as HTMLElement
  }

  it('marks only the current page link as current', async () => {
    nav.pathname = '/pricing'
    const bar = await renderBar()
    const pricing = within(bar).getByRole('link', { name: 'Pricing' })
    expect(pricing).toHaveAttribute('aria-current', 'page')
    // A square teal tint that stays teal while hovered: the base rounding, resting grey text and
    // grey hover are replaced, not left alongside.
    expect(pricing).toHaveClass('bg-primary/10', 'text-primary', 'rounded-none', 'hover:bg-primary/12', 'hover:text-primary')
    expectNoClass(pricing, 'rounded-lg', 'text-text2', 'hover:bg-surface2', 'hover:text-foreground')
    // Same box as the others: no padding, height, border or weight change while active.
    expect(pricing).toHaveClass('h-8', 'px-2', 'xl:px-3')
    expectNoClass(pricing, 'font-medium', 'border')
    for (const name of MAIN_LINKS.filter((n) => n !== 'Pricing')) {
      const other = within(bar).getByRole('link', { name })
      expect(other).not.toHaveAttribute('aria-current')
      // Inactive links keep their rounded grey look and hover.
      expect(other).toHaveClass('rounded-lg', 'text-text2', 'hover:bg-surface2', 'hover:text-foreground')
      expectNoClass(other, 'rounded-none', 'text-primary', 'bg-primary/10')
    }
  })

  it('marks Compare on a page below /compare and keeps Changelog bar-from-xl while active', async () => {
    nav.pathname = '/compare/onetab'
    let bar = await renderBar()
    expect(within(bar).getByRole('link', { name: 'Compare' })).toHaveAttribute('aria-current', 'page')

    document.body.innerHTML = ''
    nav.pathname = '/changelog'
    bar = await renderBar()
    const changelog = within(bar).getByRole('link', { name: 'Changelog' })
    expect(changelog).toHaveAttribute('aria-current', 'page')
    expect(changelog).toHaveClass('hidden', 'xl:flex')
  })

  it('marks nothing on a page with no nav link (home)', async () => {
    nav.pathname = '/'
    const bar = await renderBar()
    expect(within(bar).getAllByRole('link').filter((l) => l.hasAttribute('aria-current'))).toHaveLength(0)
  })
})

describe('MobileNavToggle panel: active page', () => {
  async function openPanel(account: Parameters<typeof MobileNavToggle>[0]['account']) {
    const user = userEvent.setup()
    render(<MobileNavToggle account={account} />)
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open menu' }))
    })
    return screen.getByRole('navigation', { name: 'Menu' })
  }

  it('marks only the current page row among the main links', async () => {
    nav.pathname = '/faq'
    const panel = await openPanel({ status: 'signedOut' })
    const faq = within(panel).getByRole('link', { name: 'FAQ' })
    expect(faq).toHaveAttribute('aria-current', 'page')
    expect(faq).toHaveClass('bg-primary/10', 'text-primary', 'rounded-none', 'hover:bg-primary/12', 'h-10', 'px-3')
    expectNoClass(faq, 'rounded-lg', 'text-text2', 'hover:bg-surface2', 'hover:text-foreground')
    for (const name of MAIN_LINKS.filter((n) => n !== 'FAQ')) {
      const other = within(panel).getByRole('link', { name })
      expect(other).not.toHaveAttribute('aria-current')
      expect(other).toHaveClass('rounded-lg', 'text-text2')
      expect(other).not.toHaveClass('text-primary')
    }
  })

  it.each([
    ['/dashboard', 'Dashboard'],
    ['/account', 'Account'],
  ])('marks the signed-in %s row', async (pathname, name) => {
    nav.pathname = pathname
    const panel = await openPanel({ status: 'signedIn', email: ['user', 'example.test'].join('@') })
    const row = within(panel).getByRole('link', { name })
    expect(row).toHaveAttribute('aria-current', 'page')
    expect(row).toHaveClass('bg-primary/10', 'text-primary', 'rounded-none')
    expectNoClass(row, 'rounded-lg', 'text-text2')
    const current = within(panel).getAllByRole('link').filter((l) => l.hasAttribute('aria-current'))
    expect(current).toHaveLength(1)
  })
})
