import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import path from 'node:path'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AI_MAX_GROUP_NAME_LENGTH, AI_MAX_TITLE_LENGTH, AI_MAX_URL_LENGTH } from '@tabmerger/shared'
import {
  useAutoGroup,
  useDescribeGroup,
  useNameGroup,
  useOrganizeTabs,
  useSuggestSessions,
  useTabSummary
} from '@/hooks/useAI'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'

/**
 * What each `useAI` mutation sends, checked against the web app's own request parsers
 * (`packages/web/lib/ai-validation.ts`): every route must still accept the trimmed payload and
 * read the same tabs from it as from the untrimmed one, and nothing else is sent (no icons, no
 * ids the route ignores). The parsers are loaded from the web package at run time; their one
 * `@/` import (`@/lib/ai-prompt-safety`) is mapped to the web file in vitest.config.ts.
 */

const { mockUseAuth, mockUseEntitlements, mockUseAppSettings, mockUseAiUsage, mockGetEncryptionKeyState } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockUseAppSettings: vi.fn(),
  mockUseAiUsage: vi.fn(),
  mockGetEncryptionKeyState: vi.fn()
}))

vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true, AI_MANAGED_ENABLED: true, AI_BYOK_ENABLED: true }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => mockUseAppSettings() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
vi.mock('@/lib/encryptionKey', () => ({ getEncryptionKeyState: mockGetEncryptionKeyState }))

type ParseResult = { ok: true; data: unknown } | { ok: false; error: string }
type Parser = (body: unknown) => ParseResult
let web: Record<'parseGroupTabsBody' | 'parseNameGroupBody' | 'parseDescribeGroupBody' | 'parseTabSummaryBody' | 'parseSuggestSessionsBody' | 'parseOrganizeBody', Parser>

beforeAll(async () => {
  web = await import(/* @vite-ignore */ path.resolve(__dirname, '../../../../../web/lib/ai-validation.ts'))
})

// A tab as the popup holds it: every field the browser gives, a long title, a long URL with a
// fragment, and a data: icon of 200 KB.
const LONG_TITLE = 'Quarterly report '.repeat(40)
const LONG_URL = `https://docs.example.com/${'section/'.repeat(100)}page#${'f'.repeat(1000)}`
const ICON = `data:image/png;base64,${'A'.repeat(200_000)}`
const tab = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `${LONG_TITLE}${id}`,
  url: `${LONG_URL}${id}`,
  favIconUrl: ICON,
  pinned: false,
  windowId: 7,
  lastAccessed: 1,
  ...extra
})
const TABS = [tab(1), tab(2), tab(3, { url: `data:text/html,${'x'.repeat(100_000)}` })]

const group = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Group ${'n'.repeat(200)} ${id}`,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  info: 'private info',
  note: 'private note',
  windows: [{ id: 1, incognito: false, focused: true, starred: true, note: 'window note', tabs: TABS }],
  ...extra
})

const fetchMock = () => globalThis.fetch as ReturnType<typeof vi.fn>
const sentBody = (): Record<string, unknown> => JSON.parse(fetchMock().mock.calls[0][1].body as string)
const sentBytes = () => (fetchMock().mock.calls[0][1].body as string).length

/** The untrimmed body the route would have received before the extension cut it. */
const untrimmedTabs = () => TABS.map((t) => ({ ...t }))

function expectParsedSame(parse: Parser, sent: unknown, untrimmed: unknown) {
  const fromSent = parse(sent)
  expect(fromSent.ok, JSON.stringify(fromSent)).toBe(true)
  expect(fromSent).toEqual(parse(untrimmed))
}

function makeWrapper(groups?: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  if (groups) qc.setQueryData(GROUPS_QUERY_KEY, { active: { id: 'now', index: 0 }, available: groups })
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
  mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'managed' })
  mockUseAppSettings.mockReturnValue({ data: { aiDailyThrottle: false, aiModel: 'auto' } })
  mockUseAiUsage.mockReturnValue({ remaining: 1_000_000, used: 0, cap: 1_000_000, loading: false, known: true })
  mockGetEncryptionKeyState.mockResolvedValue('present')
})

describe('useAI payloads — exactly what each route reads, cut to its lengths', () => {
  it('group-tabs: { tabs: { id, title, url }[], model }', async () => {
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(TABS as never) })

    const body = sentBody()
    expect(Object.keys(body).sort()).toEqual(['model', 'tabs'])
    for (const t of body.tabs as Record<string, unknown>[]) expect(Object.keys(t).sort()).toEqual(['id', 'title', 'url'])
    expect((body.tabs as { id: number }[]).map((t) => t.id)).toEqual([1, 2, 3])
    expect(sentBytes()).toBeLessThan(5_000)
    expectParsedSame(web.parseGroupTabsBody, body, { tabs: untrimmedTabs() })
  })

  it('name-group: { tabs: { title, url }[], model }', async () => {
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(TABS as never) })

    const body = sentBody()
    expect(Object.keys(body).sort()).toEqual(['model', 'tabs'])
    for (const t of body.tabs as Record<string, unknown>[]) expect(Object.keys(t).sort()).toEqual(['title', 'url'])
    expectParsedSame(web.parseNameGroupBody, body, { tabs: untrimmedTabs() })
  })

  it('describe-group: { groupName, tabs: { title, url }[], model }', async () => {
    const groupName = 'G'.repeat(AI_MAX_GROUP_NAME_LENGTH + 50)
    const { result } = renderHook(() => useDescribeGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync({ groupName, tabs: TABS as never }) })

    const body = sentBody()
    expect(Object.keys(body).sort()).toEqual(['groupName', 'model', 'tabs'])
    expect(body.groupName).toHaveLength(AI_MAX_GROUP_NAME_LENGTH)
    for (const t of body.tabs as Record<string, unknown>[]) expect(Object.keys(t).sort()).toEqual(['title', 'url'])
    expectParsedSame(web.parseDescribeGroupBody, body, { groupName, tabs: untrimmedTabs() })
  })

  it('tab-summary: { title, url, model }', async () => {
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync({ url: TABS[0].url, title: TABS[0].title }) })

    const body = sentBody()
    expect(Object.keys(body).sort()).toEqual(['model', 'title', 'url'])
    expect((body.title as string).length).toBeLessThanOrEqual(AI_MAX_TITLE_LENGTH)
    expect((body.url as string).length).toBeLessThanOrEqual(AI_MAX_URL_LENGTH)
    expectParsedSame(web.parseTabSummaryBody, body, { url: TABS[0].url, title: TABS[0].title })
  })

  it('a huge data: URL stays far under the one-tab body cap (64 KB)', async () => {
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync({ url: ICON, title: 'Image' }) })

    expect(sentBytes()).toBeLessThan(1_000)
    expectParsedSame(web.parseTabSummaryBody, sentBody(), { url: ICON, title: 'Image' })
  })

  it('suggest-sessions: { groups: { id, name, tabs: { title, url }[] }[], model }', async () => {
    const groups = [group('g1'), group('g2')]
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(groups as never) })

    const body = sentBody()
    expect(Object.keys(body).sort()).toEqual(['groups', 'model'])
    for (const g of body.groups as Record<string, unknown>[]) {
      expect(Object.keys(g).sort()).toEqual(['id', 'name', 'tabs'])
      expect(g.name).toHaveLength(AI_MAX_GROUP_NAME_LENGTH)
      for (const t of g.tabs as Record<string, unknown>[]) expect(Object.keys(t).sort()).toEqual(['title', 'url'])
    }
    const untrimmed = { groups: groups.map((g) => ({ id: g.id, name: g.name, tabs: untrimmedTabs() })) }
    expectParsedSame(web.parseSuggestSessionsBody, body, untrimmed)
  })

  it('organize: { groups: { id, name, permanent, tabs: { title, url }[] }[], model }, tour practice groups left out', async () => {
    const groups = [group('now', { permanent: true }), group('g1'), group('demo', { tourDemo: true })]
    const { result } = renderHook(() => useOrganizeTabs(), { wrapper: makeWrapper(groups) })
    await act(async () => { await result.current.mutateAsync() })

    const body = sentBody()
    expect(Object.keys(body).sort()).toEqual(['groups', 'model'])
    expect((body.groups as { id: string }[]).map((g) => g.id)).toEqual(['now', 'g1'])
    for (const g of body.groups as Record<string, unknown>[]) {
      expect(Object.keys(g).sort()).toEqual(['id', 'name', 'permanent', 'tabs'])
      for (const t of g.tabs as Record<string, unknown>[]) expect(Object.keys(t).sort()).toEqual(['title', 'url'])
    }
    const untrimmed = {
      groups: groups.slice(0, 2).map((g, i) => ({ id: g.id, name: g.name, permanent: i === 0, tabs: untrimmedTabs() }))
    }
    expectParsedSame(web.parseOrganizeBody, body, untrimmed)
  })

  it('group lists: a tab without a string URL is sent without one, so the server drops it as before', async () => {
    const odd = { id: 0, title: 'No URL' }
    const groups = [group('g1', { windows: [{ id: 1, tabs: [odd, TABS[0]] }] })]
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(groups as never) })

    const body = sentBody() as { groups: { tabs: Record<string, unknown>[] }[] }
    expect(body.groups[0].tabs[0]).toEqual({ title: 'No URL' })
    const untrimmed = { groups: [{ id: 'g1', name: groups[0].name, tabs: [odd, { ...TABS[0] }] }] }
    expectParsedSame(web.parseSuggestSessionsBody, body, untrimmed)
  })
})
