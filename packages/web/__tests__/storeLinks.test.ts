import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORE_LISTING_URL } from '@tabmerger/shared'
import {
  BETA_GUIDE_FIREFOX_ID,
  BETA_GUIDE_START_FIREFOX,
  BETA_GUIDE_START_PARAM,
  BETA_STORE_LINKS,
  STABLE_STORE_LINKS,
  getStoreLinks,
  storeLinkProps,
} from '@/lib/storeLinks'

const CHROME_STABLE = 'https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc'
const CHROME_BETA = 'https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd'
const FIREFOX_STABLE = 'https://addons.mozilla.org/firefox/addon/tabmerger/'
const EDGE_STABLE = 'https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn'

function stubDeployment(vercelEnv: string) {
  vi.stubEnv('VERCEL_ENV', vercelEnv)
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
}

describe('getStoreLinks', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the three stable listings on the production deployment', () => {
    stubDeployment('production')
    expect(getStoreLinks()).toEqual({ chrome: CHROME_STABLE, firefox: FIREFOX_STABLE, edge: EDGE_STABLE })
  })

  it.each([
    ['the preview deployment', 'preview'],
    ['a development deployment', 'development'],
    ['no Vercel environment (local dev, tests)', ''],
  ])('returns the beta targets on %s', (_label, vercelEnv) => {
    stubDeployment(vercelEnv)
    expect(getStoreLinks()).toEqual({
      chrome: CHROME_BETA,
      firefox: '/beta?download=firefox#firefox',
      edge: CHROME_BETA,
    })
  })

  it('does not treat a production build (NODE_ENV) as the production deployment', () => {
    // The preview site is a production build too; only the Vercel target decides.
    vi.stubEnv('NODE_ENV', 'production')
    stubDeployment('preview')
    expect(getStoreLinks()).toEqual(BETA_STORE_LINKS)
  })

  it('reads the deployment on each call, not once at import', () => {
    stubDeployment('production')
    expect(getStoreLinks()).toEqual(STABLE_STORE_LINKS)
    stubDeployment('preview')
    expect(getStoreLinks()).toEqual(BETA_STORE_LINKS)
  })

  it('builds both sets from the shared listing constants', () => {
    expect(STABLE_STORE_LINKS.chrome).toBe(STORE_LISTING_URL.CHROME_STABLE)
    expect(STABLE_STORE_LINKS.firefox).toBe(STORE_LISTING_URL.FIREFOX_STABLE)
    expect(STABLE_STORE_LINKS.edge).toBe(STORE_LISTING_URL.EDGE_STABLE)
    expect(BETA_STORE_LINKS.chrome).toBe(STORE_LISTING_URL.CHROME_BETA)
    // No Edge beta exists: Edge installs the Chrome BETA item.
    expect(BETA_STORE_LINKS.edge).toBe(STORE_LISTING_URL.CHROME_BETA)
    // The guide's Firefox step, with the flag that asks the guide to start the beta file.
    expect(BETA_STORE_LINKS.firefox).toBe(
      `/beta?${BETA_GUIDE_START_PARAM}=${BETA_GUIDE_START_FIREFOX}#${BETA_GUIDE_FIREFOX_ID}`
    )
    expect(BETA_STORE_LINKS.firefox.endsWith('#firefox')).toBe(true)
  })
})

describe('storeLinkProps', () => {
  it.each([CHROME_STABLE, CHROME_BETA, FIREFOX_STABLE, EDGE_STABLE])(
    'opens the store listing %s in a new tab without leaking the opener',
    (href) => {
      expect(storeLinkProps(href)).toEqual({ href, target: '_blank', rel: 'noopener noreferrer' })
    }
  )

  it('keeps the internal Firefox beta link in the same tab', () => {
    expect(storeLinkProps(BETA_STORE_LINKS.firefox)).toEqual({ href: '/beta?download=firefox#firefox' })
  })
})

// --- Source scan: the rules above only hold if nothing sidesteps the helper. ---

const WEB_ROOT = join(__dirname, '..')
const SOURCE_DIRS = ['app', 'components', 'lib']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const SOURCES = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(WEB_ROOT, dir))).map((path) => ({
  path: relative(WEB_ROOT, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}))

function filesMatching(pattern: RegExp, except: string[] = []): string[] {
  return SOURCES.filter(({ path, text }) => !except.includes(path) && pattern.test(text)).map(({ path }) => path)
}

describe('install links in the web app source', () => {
  it('finds the source files', () => {
    expect(SOURCES.length).toBeGreaterThan(50)
  })

  it('never links to the Chrome Web Store home page', () => {
    expect(filesMatching(/chrome\.google\.com\/webstore/)).toEqual([])
  })

  it('writes no store listing URL or item ID as a literal', () => {
    const literal =
      /chromewebstore\.google\.com\/detail\/(tabmerger|inmiaj|nbolj)|addons\.mozilla\.org\/firefox\/addon\/tabmerger|microsoftedge\.microsoft\.com\/addons|inmiajapbpafmhjleiebcamfhkfnlgoc|nboljhidpjakiohfdkdjkcljdehcapcd|eogjdfjemlgmbblgkjlcgdehbeoodbfn/
    expect(filesMatching(literal)).toEqual([])
  })

  it('never decides the deployment inside a client component', () => {
    // The browser has no VERCEL_ENV, so a client component would always pick the beta links.
    // Client components take the resolved link as a prop from a server component instead.
    const clientComponents = SOURCES.filter(({ text }) => /^\s*['"]use client['"]/.test(text))
    expect(clientComponents.length).toBeGreaterThan(10)
    const offenders = clientComponents
      .filter(({ text }) => /import\s*\{[^}]*\b(getStoreLinks|isProductionDeployment)\b[^}]*\}/.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })
})
