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
  ['/faq', 'FAQ', 'Answers to common questions'],
  ['/changelog', 'Changelog', 'What changed in each release'],
  ['/privacy', 'Privacy', 'What data TabMerger handles and how'],
  ['/terms', 'Terms', 'Terms of service'],
  ['/contact', 'Contact', 'How to reach the maintainer'],
]

/** The llms.txt convention (llmstxt.org): a title, a one-line summary, then links with a note each. */
export function buildLlmsTxt(origin: string): string {
  const base = origin.replace(/\/+$/, '')
  const links = PAGES.map(([path, title, about]) => `- [${title}](${base}${path === '/' ? '/' : path}): ${about}`)
  return [
    '# TabMerger',
    '',
    '> TabMerger is a browser extension that groups your open tabs into named, colour-coded groups you can search, share and restore. It runs on Chrome, Firefox and Edge, and has a free plan that needs no account.',
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
