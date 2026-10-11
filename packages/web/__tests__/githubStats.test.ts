import { describe, it, expect, vi, afterEach } from 'vitest'
import { getGithubStarCount, GITHUB_STATS_REVALIDATE_SECONDS } from '@/lib/githubStats'

/** Stubs fetch to answer once with `body` (or a non-OK response when `ok` is false). */
function stubFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getGithubStarCount', () => {
  it('returns stargazers_count from the repo API', async () => {
    stubFetch({ stargazers_count: 187 })
    expect(await getGithubStarCount()).toBe(187)
  })

  it('accepts zero', async () => {
    stubFetch({ stargazers_count: 0 })
    expect(await getGithubStarCount()).toBe(0)
  })

  it('requests the repo URL with the GitHub headers, hourly revalidation and a timeout signal', async () => {
    const fetchMock = stubFetch({ stargazers_count: 1 })
    await getGithubStarCount()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }]
    expect(url).toBe('https://api.github.com/repos/lbragile/TabMerger')
    expect(init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(GITHUB_STATS_REVALIDATE_SECONDS).toBe(3600)
    expect(init.next).toEqual({ revalidate: 3600 })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns null on a non-OK response (rate limited, 404, 500)', async () => {
    stubFetch({ stargazers_count: 187 }, false)
    expect(await getGithubStarCount()).toBeNull()
  })

  it('returns null, without throwing, when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(getGithubStarCount()).resolves.toBeNull()
  })

  it('returns null when the body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      })),
    )
    await expect(getGithubStarCount()).resolves.toBeNull()
  })

  it.each([
    ['negative', { stargazers_count: -1 }],
    ['fractional', { stargazers_count: 1.5 }],
    ['a string', { stargazers_count: '187' }],
    ['missing', {}],
    ['null', { stargazers_count: null }],
    ['NaN', { stargazers_count: NaN }],
    ['Infinity', { stargazers_count: Infinity }],
    ['beyond the safe integer range', { stargazers_count: Number.MAX_SAFE_INTEGER + 1 }],
    ['a null body', null],
    ['an array body', []],
  ])('returns null when the count is %s', async (_label, body) => {
    stubFetch(body)
    expect(await getGithubStarCount()).toBeNull()
  })
})
