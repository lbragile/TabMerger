import { describe, expect, it } from 'vitest'
import { buildLlmsTxt, GET } from '@/app/llms.txt/route'
import { SUPPORTED_LOCALES } from '@tabmerger/shared'
import sitemap from '@/app/sitemap'

describe('llms.txt', () => {
  it('follows the llmstxt.org shape: a title, a summary quote, then link lists', () => {
    const text = buildLlmsTxt('https://example.test')
    const lines = text.split('\n')
    expect(lines[0]).toBe('# TabMerger')
    expect(lines.find((l) => l.startsWith('> '))).toBeTruthy()
    expect(text).toContain('## Pages')
    for (const line of lines.filter((l) => l.startsWith('- '))) {
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

  it('is served as plain text', async () => {
    const res = GET()
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await res.text()).toMatch(/^# TabMerger/)
  })
})
