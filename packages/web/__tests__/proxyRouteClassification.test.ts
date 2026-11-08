/**
 * Guards `needsSession` (proxy.ts) against drift: the route list is read from the filesystem, so
 * a new route or page must be classified here, and any file that reads the cookie session on the
 * server (imports lib/supabase/server or lib/currentPlan) must be classified as needing it, or its
 * visitors' expired access tokens are never refreshed and they look signed out.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => ({ auth: { getUser: vi.fn() } })) }))

const WEB_ROOT = path.resolve(__dirname, '..')
const APP = path.join(WEB_ROOT, 'app')

/** Every `route.ts` / `page.tsx` under `dir`, as absolute paths. */
function entries(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return entries(full)
    return /^(route\.tsx?|page\.tsx)$/.test(name) ? [full] : []
  })
}

/** `app/[locale]/(marketing)/faq/page.tsx` -> `/faq`; `app/api/sessions/[id]/route.ts` -> `/api/sessions/1`. */
function urlPath(file: string): string {
  const rel = path.relative(APP, path.dirname(file)).split(path.sep)
  const segments = rel
    .filter((s) => s !== '[locale]' && !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => (s.startsWith('[') ? '1' : s))
  return '/' + segments.join('/')
}

/** Routes and pages that read the cookie session on the server. Anything else must not. */
const SESSION_ROUTES = new Set([
  '/dashboard',
  '/account',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/sign-in',
  '/auth/sign-up',
  '/api/auth/callback',
  '/api/auth/sign-out',
  '/api/billing/cancel-subscription',
  '/api/billing/keep-current-plan',
  '/api/billing/resume-subscription',
  '/api/billing/switch-interval',
  '/api/billing/switch-plan',
  '/api/billing-portal',
  '/api/checkout',
  '/api/checkout/credits',
  '/api/sessions/1',
  '/api/plan',
])

/** Public pages and routes: Bearer token, signature, service role or nothing at all. */
const PUBLIC_ROUTES = new Set([
  '/',
  '/beta',
  '/changelog',
  '/contact',
  '/faq',
  '/features',
  '/pricing',
  '/privacy',
  '/terms',
  '/uninstalled',
  '/sentry-test',
  '/share/demo',
  '/share/1',
  '/llms.txt',
  '/indexnow.txt',
  '/api/ai/byok/verify',
  '/api/ai/describe-group',
  '/api/ai/dev-usage',
  '/api/ai/group-tabs',
  '/api/ai/name-group',
  '/api/ai/organize',
  '/api/ai/suggest-sessions',
  '/api/ai/tab-summary',
  '/api/contact',
  '/api/cron/web-heartbeat',
  '/api/health',
  '/api/og-preview',
  '/api/portal',
  '/api/track',
  '/api/uninstall-feedback',
  '/api/webhooks/stripe',
])

const files = entries(APP)
/** Imports `createClient` (cookie session) from the server client, or the plan reader built on it. */
const SESSION_READERS = {
  test: (source: string) =>
    source.includes('/lib/currentPlan') ||
    source
      .split('\n')
      .some((line) => line.startsWith('import') && line.includes('lib/supabase/server') && /\bcreateClient\b/.test(line)),
}

describe('needsSession classification', () => {
  it('finds the routes and pages (the walk is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('has every route and page classified: a new one fails here until it is added to a list', () => {
    const unclassified = files.map(urlPath).filter((p) => !SESSION_ROUTES.has(p) && !PUBLIC_ROUTES.has(p))
    expect(unclassified).toEqual([])
  })

  it('lists no route that no longer exists', () => {
    const present = new Set(files.map(urlPath))
    const stale = [...SESSION_ROUTES, ...PUBLIC_ROUTES].filter((p) => !present.has(p))
    expect(stale).toEqual([])
  })

  it('classifies no route in both lists', () => {
    expect([...SESSION_ROUTES].filter((p) => PUBLIC_ROUTES.has(p))).toEqual([])
  })

  it.each([...SESSION_ROUTES])('needsSession is true for %s', async (p) => {
    const { needsSession } = await import('@/proxy')
    expect(needsSession(p)).toBe(true)
    expect(needsSession(`/es${p === '/' ? '' : p}`)).toBe(true)
  })

  it.each([...PUBLIC_ROUTES])('needsSession is false for %s', async (p) => {
    const { needsSession } = await import('@/proxy')
    expect(needsSession(p)).toBe(false)
  })

  it('every file that reads the cookie session directly is classified as needing it', async () => {
    const { needsSession } = await import('@/proxy')
    const readers = files.filter((f) => SESSION_READERS.test(readFileSync(f, 'utf8')))
    expect(readers.length).toBeGreaterThan(5)
    const missed = readers.map(urlPath).filter((p) => !needsSession(p))
    expect(missed).toEqual([])
  })

  it('every page under the signed-in route group needs the session', async () => {
    const { needsSession } = await import('@/proxy')
    const appGroup = entries(path.join(APP, '[locale]', '(app)')).map(urlPath)
    expect(appGroup.length).toBeGreaterThan(0)
    expect(appGroup.filter((p) => !needsSession(p))).toEqual([])
  })
})
