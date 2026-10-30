import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AI_BYOK_KEY_HEADER, AI_ERROR_CODES, AI_MAX_GROUP_DESCRIPTION_LENGTH, PRO_AI_MONTHLY_CREDITS } from '@tabmerger/shared'
import { useDescribeGroup } from '@/hooks/useAI'
import { AiRequestError, QuotaExceededError } from '@/lib/aiErrors'
import { clearByokKey, saveByokKey } from '@/lib/byokKey'
import type { Tab } from '@/lib/types'

/**
 * `useDescribeGroup`: what it sends to `/api/ai/describe-group` (decrypted name + title/url only,
 * the model, the own key in its header), what it refuses before sending, and how the untrusted
 * reply is cleaned before it can become a note.
 */

const { mockUseAuth, mockUseEntitlements, mockUseAppSettings, mockUseAiUsage, mockTrackEvent } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockUseAppSettings: vi.fn(),
  mockUseAiUsage: vi.fn(),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true, AI_MANAGED_ENABLED: true, AI_BYOK_ENABLED: true }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => mockUseAppSettings() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
vi.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ data: { available: [] } }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/lib/encryptionKey', () => ({ getEncryptionKeyState: vi.fn().mockResolvedValue('absent') }))

/** Shaped like an Anthropic key, but too short to look like a real one to the secret scanner. */
const KEY = 'sk-ant-test-xxxxxxxxxxxxxxxx'

const TABS: Tab[] = [
  { id: 0, title: 'Docs', url: 'https://docs.example.com', favIconUrl: 'https://docs.example.com/f.ico', note: 'private note' } as Tab,
  { id: 0, title: 'Blog', url: 'https://blog.example.com' } as Tab,
]

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
}

const fetchMock = () => globalThis.fetch as ReturnType<typeof vi.fn>
const lastRequest = () => {
  const [url, init] = fetchMock().mock.calls.at(-1) as [string, RequestInit]
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) }
}
const okJson = (body: unknown) => fetchMock().mockResolvedValue({ ok: true, json: async () => body })

async function describeGroup(input = { groupName: 'Research', tabs: TABS }) {
  const { result } = renderHook(() => useDescribeGroup(), { wrapper: makeWrapper() })
  let out: { description: string | null } | undefined
  await act(async () => { out = await result.current.mutateAsync(input) })
  return out!
}

async function describeGroupError(): Promise<unknown> {
  const { result } = renderHook(() => useDescribeGroup(), { wrapper: makeWrapper() })
  let caught: unknown
  await act(async () => {
    try {
      await result.current.mutateAsync({ groupName: 'Research', tabs: TABS })
    } catch (err) {
      caught = err
    }
  })
  return caught
}

beforeEach(async () => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn()
  await clearByokKey()
  mockUseAuth.mockReturnValue({ session: { access_token: 'tok', user: { id: 'u1' } } })
  mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'managed' })
  mockUseAppSettings.mockReturnValue({ data: { aiModel: 'auto', aiDescribeGroupEnabled: true } })
  mockUseAiUsage.mockReturnValue({ remaining: PRO_AI_MONTHLY_CREDITS, used: 0, cap: PRO_AI_MONTHLY_CREDITS, loading: false, known: true })
})

describe('useDescribeGroup — the request', () => {
  it('posts the group name and only each tab\'s title and URL, with the model and a Bearer token', async () => {
    okJson({ description: 'Docs and a blog.' })
    await describeGroup()
    const { url, headers, body } = lastRequest()
    expect(url).toMatch(/\/api\/ai\/describe-group$/)
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers[AI_BYOK_KEY_HEADER]).toBeUndefined()
    expect(body).toEqual({
      groupName: 'Research',
      tabs: [
        { title: 'Docs', url: 'https://docs.example.com' },
        { title: 'Blog', url: 'https://blog.example.com' },
      ],
      model: 'auto',
    })
    expect(mockTrackEvent).toHaveBeenCalledWith('ai_feature_used', { feature_name: 'describe' })
  })

  it('an own-key plan sends the saved key in its header, never in the body', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    await saveByokKey('u1', KEY)
    okJson({ description: 'x' })
    await describeGroup()
    const { headers, body } = lastRequest()
    expect(headers[AI_BYOK_KEY_HEADER]).toBe(KEY)
    expect(JSON.stringify(body)).not.toContain(KEY)
  })
})

describe('useDescribeGroup — the reply is untrusted', () => {
  it('collapses whitespace, drops control and bidi-control characters and trims', async () => {
    okJson({ description: '  Docs\n\tand\u0007 a ‮blog.  ' })
    expect(await describeGroup()).toEqual({ description: 'Docs and a blog.' })
  })

  it('caps a runaway reply at AI_MAX_GROUP_DESCRIPTION_LENGTH', async () => {
    okJson({ description: 'y'.repeat(AI_MAX_GROUP_DESCRIPTION_LENGTH + 50) })
    const { description } = await describeGroup()
    expect(description).toBe('y'.repeat(AI_MAX_GROUP_DESCRIPTION_LENGTH))
  })

  it.each([
    ['blank', { description: ' \n ' }],
    ['not a string', { description: 42 }],
    ['missing', {}],
    ['not an object', 'Docs'],
    ['null', null],
  ])('a %s reply is null (nothing to write)', async (_name, reply) => {
    okJson(reply)
    expect(await describeGroup()).toEqual({ description: null })
  })
})

describe('useDescribeGroup — refused before anything is sent', () => {
  it('without AI features', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: false })
    expect(await describeGroupError()).toBeInstanceOf(Error)
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('when "Describe group" is turned off in Settings', async () => {
    mockUseAppSettings.mockReturnValue({ data: { aiDescribeGroupEnabled: false } })
    const err = await describeGroupError()
    expect((err as Error).message).toBe('“Describe groups and windows” is turned off in Settings')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('without a session', async () => {
    mockUseAuth.mockReturnValue({ session: null })
    expect(((await describeGroupError()) as Error).message).toBe('Not authenticated')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('an own-key plan with no key on this device: the key-missing error (fixed in Settings)', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    const err = await describeGroupError()
    expect(err).toBeInstanceOf(AiRequestError)
    expect((err as AiRequestError).code).toBe(AI_ERROR_CODES.byokKeyMissing)
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('a known balance too low for the estimate: quota exceeded', async () => {
    mockUseAiUsage.mockReturnValue({ remaining: 0, used: 100, cap: 100, loading: false, known: true })
    expect(await describeGroupError()).toBeInstanceOf(QuotaExceededError)
    expect(fetchMock()).not.toHaveBeenCalled()
  })
})

describe('useDescribeGroup — server errors', () => {
  it('a 429 is QuotaExceededError', async () => {
    fetchMock().mockResolvedValue({ ok: false, status: 429, text: async () => JSON.stringify({ error: AI_ERROR_CODES.quotaExceeded }) })
    expect(await describeGroupError()).toBeInstanceOf(QuotaExceededError)
  })

  it('a coded error is AiRequestError with that code', async () => {
    fetchMock().mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify({ error: AI_ERROR_CODES.byokKeyInvalid }) })
    const err = await describeGroupError()
    expect(err).toBeInstanceOf(AiRequestError)
    expect((err as AiRequestError).code).toBe(AI_ERROR_CODES.byokKeyInvalid)
  })
})
