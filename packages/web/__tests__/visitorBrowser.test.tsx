import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const userAgent = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(userAgent.value ? { 'user-agent': userAgent.value } : {}),
}))

import { detectInstallBrowser, getVisitorBrowser, orderInstallBrowsers } from '@/lib/visitorBrowser'
import { Hero } from '@/components/marketing/Hero'
import { InstallButtons } from '@/components/marketing/InstallButtons'
import { FinalCta } from '@/components/marketing/FinalCta'
import { ShareInstallCta } from '@/components/ShareInstallCta'
import FeaturesPage from '@/app/[locale]/(marketing)/features/page'

const UA = {
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  curl: 'curl/8.4.0',
}

describe('detectInstallBrowser', () => {
  it.each([
    ['Chrome', UA.chrome, 'chrome'],
    ['Firefox', UA.firefox, 'firefox'],
    ['Edge (also reports Chrome/)', UA.edge, 'edge'],
  ] as const)('detects %s', (_label, ua, expected) => {
    expect(detectInstallBrowser(ua)).toBe(expected)
  })

  it.each([
    ['a bot', UA.bot],
    ['curl', UA.curl],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to Chrome for %s', (_label, ua) => {
    expect(detectInstallBrowser(ua)).toBe('chrome')
  })
})

describe('orderInstallBrowsers', () => {
  it.each([
    ['chrome', ['chrome', 'firefox', 'edge']],
    ['firefox', ['firefox', 'chrome', 'edge']],
    ['edge', ['edge', 'chrome', 'firefox']],
  ] as const)('puts %s first and keeps every browser', (primary, expected) => {
    expect(orderInstallBrowsers(primary)).toEqual(expected)
  })
})

describe('getVisitorBrowser', () => {
  afterEach(() => {
    userAgent.value = null
  })

  it('reads the request User-Agent header', async () => {
    userAgent.value = UA.firefox
    await expect(getVisitorBrowser()).resolves.toBe('firefox')
  })

  it('falls back to Chrome without a User-Agent header', async () => {
    await expect(getVisitorBrowser()).resolves.toBe('chrome')
  })
})

/** Accessible names of the install links, in document order. */
function installLinkNames(container: HTMLElement, pattern: RegExp) {
  return within(container)
    .getAllByRole('link')
    .map((link) => link.textContent?.trim() ?? '')
    .filter((name) => pattern.test(name))
}

describe('InstallButtons browser ordering', () => {
  it.each([
    [undefined, ['Add to Chrome', 'Add to Firefox', 'Add to Edge']],
    ['chrome', ['Add to Chrome', 'Add to Firefox', 'Add to Edge']],
    ['firefox', ['Add to Firefox', 'Add to Chrome', 'Add to Edge']],
    ['edge', ['Add to Edge', 'Add to Chrome', 'Add to Firefox']],
  ] as const)('browser=%s: leads with it and still shows all three', (browser, expected) => {
    const { container } = render(<InstallButtons browser={browser} />)
    expect(installLinkNames(container, /^Add to/)).toEqual(expected)
  })

  it('gives only the leading button the filled treatment', () => {
    render(<InstallButtons browser="firefox" />)
    const firefox = screen.getByRole('link', { name: /add to firefox/i })
    const chrome = screen.getByRole('link', { name: /add to chrome/i })
    const edge = screen.getByRole('link', { name: /add to edge/i })
    expect(firefox).toHaveAttribute('data-primary')
    expect(firefox.className).toMatch(/bg-white/)
    for (const secondary of [chrome, edge]) {
      expect(secondary).not.toHaveAttribute('data-primary')
      expect(secondary.className).toMatch(/bg-transparent/)
      expect(secondary.className).not.toMatch(/bg-white/)
    }
  })
})

describe('Hero browser ordering', () => {
  it.each([
    [undefined, ['Install for Chrome — free', 'Firefox', 'Edge']],
    ['firefox', ['Install for Firefox — free', 'Chrome', 'Edge']],
    ['edge', ['Install for Edge — free', 'Chrome', 'Firefox']],
  ] as const)('browser=%s: the large primary button is that browser', (browser, expected) => {
    const { container } = render(<Hero browser={browser} />)
    expect(installLinkNames(container, /Chrome|Firefox|Edge/)).toEqual(expected)
  })

  it('renders the non-matching browsers as outline buttons', () => {
    render(<Hero browser="firefox" />)
    const primary = screen.getByRole('link', { name: /install for firefox/i })
    // The icon's label is part of the accessible name, so match on the visible text.
    const byText = (text: string) => screen.getAllByRole('link').find((l) => l.textContent?.trim() === text)!
    const chrome = byText('Chrome')
    const edge = byText('Edge')
    expect(primary.className).toMatch(/bg-primary/)
    expect(primary.className).not.toMatch(/border-input/)
    for (const secondary of [chrome, edge]) {
      expect(secondary.className).toMatch(/border-input/)
      expect(secondary.className).not.toMatch(/bg-primary/)
    }
    expect(screen.queryByRole('link', { name: /install for chrome/i })).not.toBeInTheDocument()
  })
})

describe('single-button install CTAs follow the visitor browser', () => {
  afterEach(() => {
    userAgent.value = null
  })

  it.each([
    [undefined, 'Install for Chrome — free'],
    ['firefox', 'Install for Firefox — free'],
    ['edge', 'Install for Edge — free'],
  ] as const)('FinalCta browser=%s', (browser, label) => {
    const { container } = render(<FinalCta browser={browser} />)
    expect(installLinkNames(container, /^Install for/)).toEqual([label])
  })

  it('ShareInstallCta shows the visitor browser icon', () => {
    render(<ShareInstallCta browser="edge" />)
    expect(within(screen.getByRole('link', { name: /install free/i })).getByRole('img', { name: /edge/i })).toBeInTheDocument()
  })

  it.each([
    [UA.firefox, "Add to Firefox — It's Free"],
    [UA.edge, "Add to Edge — It's Free"],
    [null, "Add to Chrome — It's Free"],
  ])('the features page header button installs for the request browser', async (ua, label) => {
    userAgent.value = ua
    const { container } = render(await FeaturesPage())
    expect(installLinkNames(container, /^Add to/)).toEqual([label])
  })
})
