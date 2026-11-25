/**
 * scripts/sync-blog-posts.mjs: the deploy-time sync that registers every blog post slug in
 * `blog_posts` through `sync_blog_posts(p_slugs, p_token)`, instead of a migration per post.
 * The slug list matches the generated index (placeholders out, scheduled posts in), settings come
 * from the environment or a dotenv file, the request has the RPC's shape, errors exit 1, and the
 * token and key are never printed. fetch is mocked: nothing here touches a database.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BLOG_SOURCES as GENERATED_SOURCES } from '@/generated/blog'
import { utcToday, withoutPlaceholders } from '@/lib/blog/posts'
import { blogSlugs, countOf, main, MISSING_POSTS_SQL, missingWarning, parseEnvFile, readConfig, redact, SYNC_RPC } from '@/scripts/sync-blog-posts.mjs'

const TOKEN = 'test-sync-token-123'
const KEY = 'test-publishable-key-456'
const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.test/', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY, BLOG_SYNC_TOKEN: TOKEN }

function capture() {
  const lines: string[] = []
  return { lines, io: { log: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } }
}

const okFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('the slug list', () => {
  it('is the generated index without placeholders, sorted', () => {
    expect(blogSlugs()).toEqual(Object.keys(withoutPlaceholders(GENERATED_SOURCES)).sort())
  })

  it('includes scheduled posts (their pages go live on their date with no deploy)', () => {
    const today = utcToday()
    const scheduled = Object.entries(GENERATED_SOURCES)
      .filter(([, locales]) => !locales.en?.placeholder && locales.en?.published > today)
      .map(([slug]) => slug)
    for (const slug of scheduled) expect(blogSlugs()).toContain(slug)
  })
})

describe('settings', () => {
  it('reads a dotenv file: comments, export, quotes', () => {
    expect(parseEnvFile('# c\nexport A=1\nB="two words"\nC=\'x\'\n\nBAD LINE\nD = spaced ')).toEqual({ A: '1', B: 'two words', C: 'x', D: 'spaced' })
  })

  it('needs the URL, a public key (publishable or anon) and the token', () => {
    expect(readConfig({}).missing).toHaveLength(3)
    expect(readConfig({ ...ENV, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' })).toMatchObject({ key: 'anon', missing: [] })
    expect(readConfig(ENV)).toMatchObject({ url: 'https://db.example.test', key: KEY, token: TOKEN, missing: [] })
    expect(readConfig({ ...ENV, BLOG_SYNC_TOKEN: '  ' }).missing).toEqual(['BLOG_SYNC_TOKEN'])
  })

  it('redacts every secret', () => {
    expect(redact(`a ${TOKEN} b ${KEY}`, [TOKEN, KEY])).toBe('a *** b ***')
  })
})

describe('the CLI', () => {
  it('--dry-run prints the list and calls nothing, even without settings', async () => {
    const { lines, io } = capture()
    const fetchImpl = vi.fn()
    expect(await main(['--dry-run'], {}, io, fetchImpl)).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    for (const slug of blogSlugs()) expect(lines.join('\n')).toContain(slug)
  })

  it('exits 1 with the missing names, before any request', async () => {
    const { lines, io } = capture()
    const fetchImpl = vi.fn()
    expect(await main([], { NEXT_PUBLIC_SUPABASE_URL: 'https://x.test' }, io, fetchImpl)).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(lines.join('\n')).toMatch(/missing .*PUBLISHABLE_KEY.*BLOG_SYNC_TOKEN/)
  })

  it('posts the slugs and token to the RPC with the public key, and prints the result', async () => {
    const { lines, io } = capture()
    const fetchImpl = okFetch({ added: ['new-post'], missing: [], deleted: 0 })
    expect(await main([], ENV, io, fetchImpl)).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://db.example.test/rest/v1/rpc/${SYNC_RPC}`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ p_slugs: blogSlugs(), p_token: TOKEN })
    const out = lines.join('\n')
    expect(out).toContain('added: 1 (new-post)')
    expect(out).toContain('missing: 0')
    expect(out).toContain('deleted: 0')
    expect(out).not.toContain(TOKEN)
    expect(out).not.toContain(KEY)
  })

  it('warns (and still exits 0) when posts are missing from the list or were deleted', async () => {
    for (const result of [{ added: [], missing: ['old-post'], deleted: [] }, { added: 0, missing: 0, deleted: 2 }]) {
      const { lines, io } = capture()
      expect(await main([], ENV, io, okFetch(result))).toBe(0)
      const warning = lines.find((l) => l.startsWith('::warning::'))
      expect(warning).toBeDefined()
      expect(warning).toContain(`${countOf(result.missing)} post(s) missing`)
      expect(warning).toContain(`${countOf(result.deleted)} deleted`)
      expect(warning).toContain('30 days')
      expect(warning).toContain(MISSING_POSTS_SQL)
    }
  })

  it('does not warn when nothing is missing or deleted', async () => {
    const { lines, io } = capture()
    expect(await main([], ENV, io, okFetch({ added: ['x'], missing: [], deleted: 0 }))).toBe(0)
    expect(lines.some((l) => l.startsWith('::warning::'))).toBe(false)
    expect(missingWarning({})).toBeUndefined()
  })

  it('exits 1 on an RPC error, without printing the token or the key', async () => {
    const { lines, io } = capture()
    const fetchImpl = okFetch({ message: `invalid token ${TOKEN} for key ${KEY}` }, 400)
    expect(await main([], ENV, io, fetchImpl)).toBe(1)
    const out = lines.join('\n')
    expect(out).toMatch(/sync_blog_posts failed \(HTTP 400\)/)
    expect(out).not.toContain(TOKEN)
    expect(out).not.toContain(KEY)
  })

  it('exits 1 when the request itself fails', async () => {
    const { io } = capture()
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    expect(await main([], ENV, io, fetchImpl)).toBe(1)
  })

  it('reads settings from --env-file, with real environment variables winning', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-sync-'))
    const file = path.join(dir, '.env.production.local')
    fs.writeFileSync(file, `NEXT_PUBLIC_SUPABASE_URL="https://from-file.test"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${KEY}"\nBLOG_SYNC_TOKEN="file-token"\n`)
    const { io } = capture()
    const fetchImpl = okFetch({ added: [], missing: [], deleted: [] })
    expect(await main(['--env-file', file], { BLOG_SYNC_TOKEN: TOKEN }, io, fetchImpl)).toBe(0)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://from-file.test/rest/v1/rpc/${SYNC_RPC}`)
    expect(JSON.parse(init.body as string).p_token).toBe(TOKEN)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('exits 1 for a missing env file or a flag without a path', async () => {
    const { io } = capture()
    expect(await main(['--env-file', 'no/such/file.env'], ENV, io, vi.fn())).toBe(1)
    expect(await main(['--env-file'], ENV, io, vi.fn())).toBe(1)
  })
})
