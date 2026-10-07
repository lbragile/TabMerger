import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

// Tag what Next <Link> renders, so a client-side navigation can be told from a plain anchor.
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} data-next-link="" {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}))

import { Hero } from '@/components/marketing/Hero'
import { InstallButtons } from '@/components/marketing/InstallButtons'
import { FinalCta } from '@/components/marketing/FinalCta'
import { ShareInstallCta } from '@/components/ShareInstallCta'
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist'
import { PricingCard } from '@/components/pricing/PricingCard'
import { PricingTable } from '@/components/pricing/PricingTable'
import FeaturesPage from '@/app/(marketing)/features/page'
import ShareDemoPage from '@/app/(marketing)/share/demo/page'
import PricingPage from '@/app/(marketing)/pricing/page'

const CHROME_STABLE = 'https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc'
const CHROME_BETA = 'https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd'
const FIREFOX_STABLE = 'https://addons.mozilla.org/firefox/addon/tabmerger/'
const FIREFOX_BETA_GUIDE = '/beta?download=firefox#firefox'
const EDGE_STABLE = 'https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn'

const DEPLOYMENTS = [
  { label: 'production', vercelEnv: 'production', chrome: CHROME_STABLE, firefox: FIREFOX_STABLE, edge: EDGE_STABLE },
  { label: 'preview', vercelEnv: 'preview', chrome: CHROME_BETA, firefox: FIREFOX_BETA_GUIDE, edge: CHROME_BETA },
  { label: 'local (no Vercel environment)', vercelEnv: '', chrome: CHROME_BETA, firefox: FIREFOX_BETA_GUIDE, edge: CHROME_BETA },
] as const

function expectNewTab(link: HTMLElement) {
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(link).not.toHaveAttribute('data-next-link')
}

/** The Firefox beta link: same tab, and a client-side navigation (see StoreLink). */
function expectClientSideNavigation(link: HTMLElement) {
  expect(link).not.toHaveAttribute('target')
  expect(link).not.toHaveAttribute('rel')
  expect(link).toHaveAttribute('data-next-link')
}

describe.each(DEPLOYMENTS)('install links on $label', ({ vercelEnv, chrome, firefox, edge }) => {
  const isProduction = vercelEnv === 'production'

  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    // Never set in the deployed bundles, so nothing may depend on it.
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('Hero links Chrome, Firefox and Edge', () => {
    render(<Hero />)
    const chromeLink = screen.getByRole('link', { name: /install for chrome/i })
    const firefoxLink = screen.getByRole('link', { name: /firefox/i })
    const edgeLink = screen.getByRole('link', { name: /edge/i })

    expect(chromeLink).toHaveAttribute('href', chrome)
    expect(firefoxLink).toHaveAttribute('href', firefox)
    expect(edgeLink).toHaveAttribute('href', edge)

    expectNewTab(chromeLink)
    expectNewTab(edgeLink)
    if (isProduction) expectNewTab(firefoxLink)
    else expectClientSideNavigation(firefoxLink)
  })

  it('Hero keeps its button styling on every link (Button asChild)', () => {
    render(<Hero />)
    for (const name of [/install for chrome/i, /firefox/i, /edge/i]) {
      expect(screen.getByRole('link', { name }).className).toMatch(/inline-flex/)
    }
  })

  it('InstallButtons links Chrome, Firefox and Edge', () => {
    render(<InstallButtons />)
    const chromeLink = screen.getByRole('link', { name: /add to chrome/i })
    const firefoxLink = screen.getByRole('link', { name: /add to firefox/i })
    const edgeLink = screen.getByRole('link', { name: /add to edge/i })

    expect(chromeLink).toHaveAttribute('href', chrome)
    expect(firefoxLink).toHaveAttribute('href', firefox)
    expect(edgeLink).toHaveAttribute('href', edge)

    expectNewTab(chromeLink)
    expectNewTab(edgeLink)
    if (isProduction) expectNewTab(firefoxLink)
    else expectClientSideNavigation(firefoxLink)
  })

  it('FinalCta links the Chrome listing', () => {
    render(<FinalCta />)
    const link = screen.getByRole('link', { name: /install for chrome/i })
    expect(link).toHaveAttribute('href', chrome)
    expectNewTab(link)
  })

  it('ShareInstallCta links the Chrome listing', () => {
    render(<ShareInstallCta />)
    const link = screen.getByRole('link', { name: /install free/i })
    expect(link).toHaveAttribute('href', chrome)
    expectNewTab(link)
  })

  it('the features page links the Chrome listing', () => {
    render(<FeaturesPage />)
    const link = screen.getByRole('link', { name: /add to chrome/i })
    expect(link).toHaveAttribute('href', chrome)
    expectNewTab(link)
  })

  it('the share demo page links the Chrome listing', () => {
    render(<ShareDemoPage />)
    const link = screen.getByRole('link', { name: /install free/i })
    expect(link).toHaveAttribute('href', chrome)
    expectNewTab(link)
  })

  it('the pricing page hands the Chrome listing to the Free card\'s "Install free"', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render((await PricingPage()) as React.ReactElement)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Install free' }))

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(chrome, '_blank', 'noopener')
  })
})

// Client components cannot tell the deployments apart, so they use exactly the link they are given.
describe('client components use the install link passed from the server', () => {
  const INSTALL_HREF = 'https://store.example/tabmerger'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(['production', 'preview'])(
    'PricingCard "Install free" opens the given link whatever the environment says (%s)',
    async (vercelEnv) => {
      vi.stubEnv('VERCEL_ENV', vercelEnv)
      vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', vercelEnv)
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)
      render(
        <PricingCard
          tier="free"
          name="Free"
          monthlyPrice={0}
          yearlyPrice={0}
          features={['Feature A']}
          interval="monthly"
          installHref={INSTALL_HREF}
        />
      )

      await userEvent.setup().click(screen.getByRole('button', { name: 'Install free' }))

      expect(open).toHaveBeenCalledTimes(1)
      expect(open).toHaveBeenCalledWith(INSTALL_HREF, '_blank', 'noopener')
    }
  )

  it('PricingTable passes its link to the Free card', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<PricingTable installHref={INSTALL_HREF} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Install free' }))

    expect(open).toHaveBeenCalledWith(INSTALL_HREF, '_blank', 'noopener')
  })

  it('OnboardingChecklist links its install step to the given listing, in a new tab', () => {
    render(<OnboardingChecklist isSignedIn={false} isPro={false} installHref={CHROME_BETA} />)
    const link = screen.getByRole('link', { name: 'Install the TabMerger extension' })
    expect(link).toHaveAttribute('href', CHROME_BETA)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('OnboardingChecklist keeps its internal steps in the same tab', () => {
    render(<OnboardingChecklist isSignedIn={false} isPro={false} installHref={CHROME_STABLE} />)
    const checklist = screen.getByText('Get started with TabMerger').closest('div')!.parentElement as HTMLElement
    const signIn = within(checklist).getByRole('link', { name: 'Sign in to enable cloud sync' })
    expect(signIn).toHaveAttribute('href', '/auth/sign-in')
    expect(signIn).not.toHaveAttribute('target')
    expect(signIn).not.toHaveAttribute('rel')
  })
})
