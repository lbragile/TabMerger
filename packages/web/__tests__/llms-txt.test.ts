import { describe, expect, it } from 'vitest'
import { buildLlmsTxt, GET } from '@/app/llms.txt/route'
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

  it('links every page the sitemap lists, on the given origin and without a double slash', () => {
    const text = buildLlmsTxt('https://example.test/')
    for (const { url } of sitemap()) {
      const path = new URL(url).pathname
      expect(text).toContain(`(https://example.test${path === '' ? '/' : path})`)
    }
    expect(text).not.toContain('example.test//')
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
