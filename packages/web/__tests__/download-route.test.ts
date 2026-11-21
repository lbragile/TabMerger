/**
 * `/download`: the short install link. Sends each browser to its store for the deployment
 * answering (stable on production, beta elsewhere) and anything that can't install the extension
 * to the homepage's install section; never indexed or cached.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { downloadTarget } from '@/lib/download'
import { BETA_STORE_LINKS, STABLE_STORE_LINKS } from '@/lib/storeLinks'

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0',
  brave: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
}

describe('downloadTarget', () => {
  it.each([
    ['chrome', 'chrome'],
    ['edge', 'edge'],
    ['firefox', 'firefox'],
    ['brave', 'chrome'],
    ['safari', null],
    ['android', null],
    ['iphone', null],
    ['bot', null],
  ] as const)('%s → %s', (agent, expected) => {
    expect(downloadTarget(UA[agent])).toBe(expected)
  })

  it('sends a missing header to the homepage', () => {
    expect(downloadTarget(null)).toBeNull()
    expect(downloadTarget('')).toBeNull()
  })
})

describe('GET /download', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function get(agent: string, vercelEnv: string) {
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    vi.resetModules()
    const { GET } = await import('@/app/download/route')
    return GET(new NextRequest('https://tabmerger.example/download', { headers: { 'user-agent': agent } }))
  }

  it.each([
    ['production', STABLE_STORE_LINKS],
    ['preview', BETA_STORE_LINKS],
  ] as const)('redirects each browser to its store on %s', async (env, links) => {
    for (const browser of ['chrome', 'edge', 'firefox'] as const) {
      const res = await get(UA[browser], env)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(new URL(links[browser], 'https://tabmerger.example').href)
      expect(res.headers.get('x-robots-tag')).toBe('noindex')
      expect(res.headers.get('cache-control')).toContain('no-store')
    }
  })

  it('sends Safari, phones and bots to the homepage install section', async () => {
    for (const agent of [UA.safari, UA.iphone, UA.android, UA.bot]) {
      const res = await get(agent, 'production')
      expect(res.headers.get('location')).toBe('https://tabmerger.example/#install')
    }
  })
})
