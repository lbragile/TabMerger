import { describe, expect, it } from 'vitest'
import { buildLlmsTxt, GET } from '@/app/llms.txt/route'
import {
  FREE_TIER_LIMITS,
  PRO_AI_MONTHLY_CREDITS,
  STORE_LISTING_URL,
  SUPPORTED_LOCALES,
  formatUsd,
  getPricingTier,
} from '@tabmerger/shared'
import { AI_AVAILABILITY } from '@/lib/aiFlag'
import sitemap from '@/app/sitemap'

describe('llms.txt', () => {
  it('follows the llmstxt.org shape: a title, a summary quote, then sections; the link sections hold only links', () => {
    const text = buildLlmsTxt('https://example.test')
    const lines = text.split('\n')
    expect(lines[0]).toBe('# TabMerger')
    expect(lines.find((l) => l.startsWith('> '))).toBeTruthy()
    expect(text).toContain('## Pages')
    // "Key facts" is prose bullets; every other section is a list of links.
    let section = ''
    const linkLines = lines.filter((l) => {
      if (l.startsWith('## ')) section = l
      return section !== '## Key facts' && l.startsWith('- ')
    })
    expect(linkLines.length).toBeGreaterThan(0)
    for (const line of linkLines) {
      expect(line).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)\s]+\)(: .+)?$/)
    }
  })

  it('links the English version of every page the sitemap lists, on the given origin and without a double slash', () => {
    const text = buildLlmsTxt('https://example.test/')
    // The sitemap lists every language version; llms.txt points at the English (unprefixed) one.
    const englishPaths = new Set(
      sitemap().map(({ url }) => {
        const segments = new URL(url).pathname.split('/')
        const rest = (SUPPORTED_LOCALES as readonly string[]).includes(segments[1]) ? `/${segments.slice(2).join('/')}` : segments.join('/')
        return rest === '' ? '/' : rest
      })
    )
    for (const path of englishPaths) expect(text).toContain(`(https://example.test${path})`)
    expect(text).not.toContain('example.test//')
  })

  it('links no locale-prefixed or pseudo-locale URL', () => {
    const text = buildLlmsTxt('https://example.test')
    for (const locale of [...SUPPORTED_LOCALES.filter((l) => l !== 'en'), 'en-XA']) {
      expect(text).not.toContain(`example.test/${locale}/`)
      expect(text).not.toContain(`example.test/${locale})`)
    }
  })

  it('never mentions the beta guide or private areas', () => {
    const text = buildLlmsTxt('https://example.test')
    for (const hidden of ['/beta', '/dashboard', '/account', '/auth', '/api', '/share']) {
      expect(text).not.toContain(`example.test${hidden}`)
    }
  })

  it('states the plan facts from the shared constants, before the page list', () => {
    const text = buildLlmsTxt('https://example.test')
    const pro = getPricingTier('pro')
    expect(text.indexOf('## Key facts')).toBeGreaterThan(0)
    expect(text.indexOf('## Key facts')).toBeLessThan(text.indexOf('## Pages'))
    expect(text).toContain(`up to ${FREE_TIER_LIMITS.groups} groups, ${FREE_TIER_LIMITS.tabs} tabs`)
    expect(text).toContain(`${formatUsd(pro.monthlyPrice)} a month or ${formatUsd(pro.yearlyPrice)} a year`)
    expect(text).toContain('end-to-end encrypted')
    expect(text).toContain('Works offline')
  })

  it('links the three stable store listings under Install', () => {
    const text = buildLlmsTxt('https://example.test')
    const install = text.slice(text.indexOf('## Install'), text.indexOf('## Pages'))
    for (const url of [STORE_LISTING_URL.CHROME_STABLE, STORE_LISTING_URL.FIREFOX_STABLE, STORE_LISTING_URL.EDGE_STABLE]) {
      expect(install).toContain(`(${url})`)
    }
  })

  describe('Pro AI follows the same flags as the pricing page', () => {
    const OFF = { managed: false, byok: false, any: false }
    const BYOK_ONLY = { managed: false, byok: true, any: true }
    const ALL_ON = { managed: true, byok: true, any: true }
    const proAi = getPricingTier('pro_ai')

    it('says nothing about AI while no Pro AI option is on sale (the site shows "Coming soon")', () => {
      expect(buildLlmsTxt('https://example.test', OFF)).not.toMatch(/\bAI\b/)
    })

    it('states both Pro AI options, their PRICING_TIERS prices and the monthly credits when all AI is on', () => {
      const text = buildLlmsTxt('https://example.test', ALL_ON)
      const facts = text.slice(text.indexOf('## Key facts'), text.indexOf('## Install'))
      expect(facts).toContain('Pro AI includes everything in Pro')
      expect(facts).toContain(`${formatUsd(proAi.monthlyPrice)} a month or ${formatUsd(proAi.yearlyPrice)} a year`)
      expect(facts).toContain(`${PRO_AI_MONTHLY_CREDITS.toLocaleString('en-US')} AI credits a month`)
      expect(facts).toContain(`${formatUsd(proAi.byok!.monthlyPrice)} a month or ${formatUsd(proAi.byok!.yearlyPrice)} a year`)
      // The feature list keeps "AI" capitalised and has the model choice as its own clause.
      expect(facts).toContain('tab preview with AI summary, and you choose the AI model.')
    })

    it('states only the own-provider option when only that one is on sale', () => {
      const text = buildLlmsTxt('https://example.test', BYOK_ONLY)
      expect(text).toContain('Pro AI with your own AI provider')
      expect(text).not.toContain('Pro AI on TabMerger’s AI')
      expect(text).not.toContain('AI credits')
    })

    it('defaults to the build-time flags', () => {
      expect(buildLlmsTxt('https://example.test')).toBe(buildLlmsTxt('https://example.test', AI_AVAILABILITY))
    })
  })

  it('is served as plain text', async () => {
    const res = GET()
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await res.text()).toMatch(/^# TabMerger/)
  })
})
