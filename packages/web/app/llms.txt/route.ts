import { FREE_TIER_LIMITS, STORE_LISTING_URL, formatUsd, getPricingTier } from '@tabmerger/shared'
import { GITHUB_REPO_URL } from '@/lib/github'
import { getMetadataBase } from '@/lib/utils'

// Static: built once, like robots.txt and the sitemap, which it sits beside.
export const dynamic = 'force-static'

/**
 * Pages worth pointing an AI crawler at, with one line on each. The same public marketing pages
 * the sitemap lists (the beta tester guide is left out for the same reason: it is not served on
 * production). Nothing private, and nothing the pages themselves don't already say.
 */
const PAGES: ReadonlyArray<readonly [path: string, title: string, about: string]> = [
  ['/', 'Home', 'What TabMerger is and how to install it'],
  ['/features', 'Features', 'Everything TabMerger can do'],
  ['/pricing', 'Pricing', 'The free plan and the paid plans'],
  ['/compare', 'Compare', 'TabMerger next to OneTab, Session Buddy, Toby, Workona and five more tab managers, from each product’s own pages'],
  ['/faq', 'FAQ', 'Answers to common questions'],
  ['/changelog', 'Changelog', 'What changed in each release'],
  ['/privacy', 'Privacy', 'What data TabMerger handles and how'],
  ['/terms', 'Terms', 'Terms of service'],
  ['/contact', 'Contact', 'How to reach the maintainer'],
]

/**
 * Short facts an answer engine can quote as they are. Every number comes from the shared plan
 * constants and every claim is one the site's own copy or the public store listings make (pricing,
 * features, FAQ; "works offline" is in the Firefox listing summary). Nothing on
 * AI: the site still shows it as coming soon or gated by flags, and this file is static.
 */
function keyFacts(): string[] {
  const pro = getPricingTier('pro')
  return [
    `- The free plan includes up to ${FREE_TIER_LIMITS.groups} groups, ${FREE_TIER_LIMITS.tabs} tabs, ${FREE_TIER_LIMITS.urlRules} URL rules and ${FREE_TIER_LIMITS.sessions} saved sessions, and needs no account.`,
    '- Works offline. Saved tabs stay in your browser unless you turn on sync (Pro); on the free plan nothing leaves your browser.',
    `- Pro costs ${formatUsd(pro.monthlyPrice)} a month or ${formatUsd(pro.yearlyPrice)} a year, and you can cancel anytime from your account page.`,
    '- Pro adds unlimited groups, tabs, URL rules and sessions, and cloud sync across every browser you sign into.',
    '- Pro cloud sync is end-to-end encrypted on your device before it reaches TabMerger’s servers. The servers store only ciphertext and never hold the key, so TabMerger cannot read your groups or tabs.',
    '- Browsers: Chrome, Firefox and Edge, plus Brave, Vivaldi, Arc and Opera from the Chrome Web Store (Opera through its "Install Chrome Extensions" add-on). Safari isn’t supported.',
  ]
}

/** The stable store listings, one per store. Edge can also install from the Chrome Web Store. */
const INSTALL: ReadonlyArray<readonly [store: string, url: string, browsers: string]> = [
  ['Chrome Web Store', STORE_LISTING_URL.CHROME_STABLE, 'Chrome, Brave, Vivaldi, Arc, Opera and Edge'],
  ['Firefox Add-ons', STORE_LISTING_URL.FIREFOX_STABLE, 'Firefox'],
  ['Edge Add-ons', STORE_LISTING_URL.EDGE_STABLE, 'Microsoft Edge'],
]

/**
 * The llms.txt convention (llmstxt.org): a title, a one-line summary, then sections. Key facts
 * and install links come first so a quote of the top of the file is already accurate.
 */
export function buildLlmsTxt(origin: string): string {
  const base = origin.replace(/\/+$/, '')
  const links = PAGES.map(([path, title, about]) => `- [${title}](${base}${path === '/' ? '/' : path}): ${about}`)
  return [
    '# TabMerger',
    '',
    '> TabMerger is a browser extension that groups your open tabs into named, colour-coded groups you can search, share and restore. It runs on Chrome, Firefox and Edge, and has a free plan that needs no account.',
    '',
    '## Key facts',
    '',
    ...keyFacts(),
    '',
    '## Install',
    '',
    ...INSTALL.map(([store, url, browsers]) => `- [${store}](${url}): ${browsers}`),
    '',
    '## Pages',
    '',
    ...links,
    '',
    '## Source',
    '',
    `- [GitHub](${GITHUB_REPO_URL}): the source code, issues and releases`,
    '',
  ].join('\n')
}

export function GET() {
  return new Response(buildLlmsTxt(getMetadataBase().origin), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
