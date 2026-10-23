import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AI_BYOK_KEY_HEADER, AI_ERROR_CODES, estimateAiCredits } from '@tabmerger/shared'
import { useAutoGroup, useNameGroup, useOrganizeTabs, useTabSummary, aiPost, AiRequestError, QuotaExceededError } from '@/hooks/useAI'
import { isFixedInAiSettings } from '@/lib/aiErrors'
import { AI_BYOK_KEY_STORAGE_KEY, clearByokKey, saveByokKey } from '@/lib/byokKey'
import { t } from '@/lib/i18n'
import type { Tab } from '@/lib/types'

const { mockUseAuth, mockUseEntitlements, mockUseAppSettings, mockUseAiUsage } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockUseAppSettings: vi.fn(),
  mockUseAiUsage: vi.fn()
}))

vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => mockUseAppSettings() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
vi.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ data: { available: [] } }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/encryptionKey', () => ({ getEncryptionKeyState: vi.fn().mockResolvedValue('absent') }))

/** Shaped like an Anthropic key, but too short to look like a real one to the secret scanner. */
const KEY = 'sk-ant-test-xxxxxxxxxxxxxxxx'

const tabs = (n: number): Tab[] => Array.from({ length: n }, (_, i) => ({ id: i, title: `T${i}`, url: `https://e.com/${i}` }) as Tab)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
}

const fetchMock = () => globalThis.fetch as ReturnType<typeof vi.fn>
const lastRequest = () => {
  const [, init] = fetchMock().mock.calls.at(-1) as [string, RequestInit]
  return { headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) }
}

function okJson(body: unknown) {
  fetchMock().mockResolvedValue({ ok: true, json: async () => body })
}

function failWith(status: number, body: unknown) {
  fetchMock().mockResolvedValue({ ok: false, status, text: async () => JSON.stringify(body) })
}

beforeEach(async () => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn()
  await clearByokKey()
  mockUseAuth.mockReturnValue({ session: { access_token: 'tok', user: { id: 'u1' } } })
  mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'managed' })
  mockUseAppSettings.mockReturnValue({ data: { aiModel: 'auto' } })
  mockUseAiUsage.mockReturnValue({ remaining: 2600, used: 0, cap: 2600, loading: false, known: true })
})

describe('model choice in the request body', () => {
  it('sends the chosen model and no key header on a managed plan', async () => {
    mockUseAppSettings.mockReturnValue({ data: { aiModel: 'claude-opus-5-5' } })
    okJson({ name: 'Work' })
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(tabs(3)) })

    const { headers, body } = lastRequest()
    expect(body.model).toBe('claude-opus-5-5')
    expect(headers[AI_BYOK_KEY_HEADER]).toBeUndefined()
  })

  it('a stored model this build does not offer is sent as auto', async () => {
    mockUseAppSettings.mockReturnValue({ data: { aiModel: 'gpt-9' } })
    okJson({ summary: 's' })
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync({ url: 'https://a.com', title: 'A' }) })
    expect(lastRequest().body.model).toBe('auto')
  })

  it('settings saved before the picker existed send auto', async () => {
    mockUseAppSettings.mockReturnValue({ data: {} })
    okJson({ runId: '1', token: 't' })
    const { result } = renderHook(() => useOrganizeTabs(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync() })
    expect(lastRequest().body).toEqual({ model: 'auto' })
  })
})

describe('own Anthropic key (BYOK)', () => {
  beforeEach(() => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
  })

  it('sends the saved key in the X-Anthropic-Key header, never in the body', async () => {
    await saveByokKey('u1', KEY)
    okJson({ groups: [] })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(tabs(2)) })

    const { headers, body } = lastRequest()
    expect(headers[AI_BYOK_KEY_HEADER]).toBe(KEY)
    expect(headers.Authorization).toBe('Bearer tok')
    expect(JSON.stringify(body)).not.toContain(KEY)
    expect(body.model).toBe('auto')
  })

  it('without a saved key, says to add one in Settings and never calls the network', async () => {
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    let caught: unknown
    await act(async () => {
      try { await result.current.mutateAsync(tabs(2)) } catch (e) { caught = e }
    })
    expect(caught).toBeInstanceOf(AiRequestError)
    expect((caught as AiRequestError).code).toBe(AI_ERROR_CODES.byokKeyMissing)
    expect((caught as Error).message).toBe(t('errors.ai.byokKeyMissing'))
    expect(isFixedInAiSettings(caught)).toBe(true)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("a key saved by another account on this device is not used", async () => {
    await saveByokKey('someone-else', KEY)
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync(tabs(1)) })).rejects.toThrow(t('errors.ai.byokKeyMissing'))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a tab summary hover with no key saved does not reach the network either', async () => {
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync({ url: 'https://a.com', title: 'A' }) })).rejects.toThrow()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('skips the credit estimate check: own-key plans have no TabMerger credits', async () => {
    await saveByokKey('u1', KEY)
    mockUseAiUsage.mockReturnValue({ remaining: 0, used: 0, cap: 0, loading: false, known: true })
    okJson({ groups: [] })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(tabs(500)) })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('managed credits: estimate check before sending', () => {
  it('refuses a request whose estimate is more than the credits left, without calling the network', async () => {
    mockUseAppSettings.mockReturnValue({ data: { aiModel: 'claude-opus-5-5' } })
    const needed = estimateAiCredits('claude-opus-5-5', 'groupTabs', 100)
    mockUseAiUsage.mockReturnValue({ remaining: needed - 1, used: 0, cap: 2600, loading: false, known: true })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    let caught: unknown
    await act(async () => {
      try { await result.current.mutateAsync(tabs(100)) } catch (e) { caught = e }
    })
    expect(caught).toBeInstanceOf(QuotaExceededError)
    expect((caught as QuotaExceededError).needed).toBe(needed)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('sends a request whose estimate fits, even with few credits left (a cheaper model)', async () => {
    const needed = estimateAiCredits('claude-haiku-5-5', 'groupTabs', 100)
    mockUseAiUsage.mockReturnValue({ remaining: needed, used: 0, cap: 2600, loading: false, known: true })
    okJson({ groups: [] })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(tabs(100)) })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not refuse on a balance that is not known (still loading or the read failed)', async () => {
    mockUseAiUsage.mockReturnValue({ remaining: 0, used: 0, cap: 2600, loading: false, known: false })
    okJson({ name: 'x' })
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(tabs(1)) })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('aiPost error codes', () => {
  const codes = Object.values(AI_ERROR_CODES).filter((c) => c !== AI_ERROR_CODES.quotaExceeded)

  it.each(codes)('%s becomes an AiRequestError with a translated message', async (code) => {
    failWith(code === AI_ERROR_CODES.overloaded ? 503 : 400, { error: code })
    const err = await aiPost('/api/ai/name-group', {}, 'tok').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiRequestError)
    expect((err as AiRequestError).code).toBe(code)
    expect((err as Error).message).not.toMatch(/^AI request failed: \d/)
    expect((err as Error).message).not.toMatch(/^errors\./)
  })

  it('an error code this build does not know gets the generic message', async () => {
    failWith(500, { error: 'ai_something_new' })
    const err = await aiPost('/api/ai/name-group', {}, 'tok').catch((e: unknown) => e)
    expect((err as Error).message).toBe(t('errors.ai.failed'))
  })

  it('429 ai_quota_exceeded is a QuotaExceededError carrying needed and remaining', async () => {
    failWith(429, { error: AI_ERROR_CODES.quotaExceeded, needed: 52, remaining: 3 })
    const err = await aiPost('/api/ai/organize', {}, 'tok').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(QuotaExceededError)
    expect(err).toMatchObject({ isQuotaExceeded: true, needed: 52, remaining: 3 })
  })

  it('an own-key rate limit is not mistaken for running out of TabMerger credits', async () => {
    failWith(400, { error: AI_ERROR_CODES.byokRateLimited })
    const err = await aiPost('/api/ai/group-tabs', {}, 'tok').catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(QuotaExceededError)
    expect(isFixedInAiSettings(err)).toBe(false)
  })

  it('an invalid own key points to Settings', async () => {
    failWith(400, { error: AI_ERROR_CODES.byokKeyInvalid })
    const err = await aiPost('/api/ai/group-tabs', {}, 'tok').catch((e: unknown) => e)
    expect(isFixedInAiSettings(err)).toBe(true)
  })

  it('sends the key header only when one is given', async () => {
    okJson({ ok: true })
    await aiPost('/api/ai/byok/verify', {}, 'tok', { byokKey: KEY })
    expect(lastRequest().headers[AI_BYOK_KEY_HEADER]).toBe(KEY)
    await aiPost('/api/ai/name-group', {}, 'tok')
    expect(lastRequest().headers[AI_BYOK_KEY_HEADER]).toBeUndefined()
  })
})

describe('the key never lands in appSettings', () => {
  it('is stored under its own chrome.storage.local key', async () => {
    await saveByokKey('u1', KEY)
    const stored = await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY)
    expect(stored[AI_BYOK_KEY_STORAGE_KEY]).toEqual({ userId: 'u1', key: KEY })
    expect(AI_BYOK_KEY_STORAGE_KEY).not.toBe('appSettings')
  })
})
