import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AI_ERROR_CODES, AI_ESTIMATE_EXAMPLES, AI_MODELS, AI_MODEL_CHOICES, estimateAiCredits } from '@tabmerger/shared'
import { AiSettings } from '@/components/Settings/AiSettings'
import { AiRequestError } from '@/lib/aiErrors'
import { estimatesFor, organizesFor } from '@/lib/aiModel'
import { AI_BYOK_KEY_STORAGE_KEY, clearByokKey, getByokKey, saveByokKey } from '@/lib/byokKey'
import { formatNumber, t } from '@/lib/i18n'

const { mockUseEntitlements, mockUseAiUsage, mockAiPost, mockToast } = vi.hoisted(() => ({
  mockUseEntitlements: vi.fn(),
  mockUseAiUsage: vi.fn(),
  mockAiPost: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, session: { access_token: 'tok' } }) }))
vi.mock('@/hooks/useAI', () => ({ aiPost: mockAiPost }))
vi.mock('@/lib/toast', () => ({ toast: mockToast }))

/** Shaped like an Anthropic key, but too short to look like a real one to the secret scanner. */
const KEY = 'sk-ant-test-xxxxxxxxxxxxxxxx'

const tabsCreate = vi.fn()
Object.assign(globalThis.chrome, { tabs: { create: tabsCreate } })

function renderSettings(model: string | undefined = 'auto', onModelChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(AiSettings, { model: model as never, onModelChange }))
  )
  return onModelChange
}

beforeEach(async () => {
  vi.clearAllMocks()
  await clearByokKey()
  mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'managed' })
  mockUseAiUsage.mockReturnValue({ used: 760, remaining: 1840, cap: 2600, loading: false, known: true })
})

describe('AiSettings — plan line', () => {
  it("managed: TabMerger's key with the credits left this month", () => {
    renderSettings()
    expect(screen.getByTestId('ai-plan-line').textContent).toBe(
      t('settings.ai.plan.managed', { remaining: formatNumber(1840), cap: formatNumber(2600) })
    )
  })

  it('managed with an unknown balance: no made-up numbers', () => {
    mockUseAiUsage.mockReturnValue({ used: 0, remaining: 2600, cap: 2600, loading: false, known: false })
    renderSettings()
    expect(screen.getByTestId('ai-plan-line').textContent).toBe(t('settings.ai.plan.managedUnknown'))
  })

  it('own key: says so and shows the key field', () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    renderSettings()
    expect(screen.getByTestId('ai-plan-line').textContent).toBe(t('settings.ai.plan.byok'))
    expect(screen.getByLabelText(t('settings.ai.key.label'))).toBeTruthy()
  })

  it('managed plans have no key field', () => {
    renderSettings()
    expect(screen.queryByTestId('ai-byok-key-input')).toBeNull()
  })

  it('renders nothing until the AI mode is known', () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: null })
    renderSettings()
    expect(screen.queryByTestId('ai-plan-line')).toBeNull()
  })
})

describe('AiSettings — model picker', () => {
  it('lists Auto then every model, as a radio group with the stored choice checked', () => {
    renderSettings('claude-sonnet-5-5')
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.value)).toEqual([...AI_MODEL_CHOICES])
    expect(radios.find((r) => r.checked)?.value).toBe('claude-sonnet-5-5')
    expect(screen.getByRole('group', { name: t('settings.ai.model.label') })).toBeTruthy()
    for (const model of Object.values(AI_MODELS)) expect(screen.getByText(model.label)).toBeTruthy()
  })

  it('an unknown stored choice shows Auto checked', () => {
    renderSettings('gpt-9')
    expect((screen.getByRole('radio', { name: /auto/i }) as HTMLInputElement).checked).toBe(true)
  })

  it('choosing a model updates the draft', async () => {
    const onChange = renderSettings('auto')
    await userEvent.click(screen.getByTestId('ai-model-claude-haiku-5-5'))
    expect(onChange).toHaveBeenCalledWith('claude-haiku-5-5')
  })

  it('managed: shows credits per example from the shared estimate, and organizes a month', () => {
    renderSettings()
    const opus = screen.getByTestId('ai-model-claude-opus-5-5')
    for (const { action, tabs } of AI_ESTIMATE_EXAMPLES) {
      const credits = estimateAiCredits('claude-opus-5-5', action, tabs)
      expect(opus.textContent).toContain(t('settings.ai.estimate.credits', { count: credits, formatted: formatNumber(credits) }))
    }
    const perMonth = organizesFor('claude-opus-5-5', 2600)!
    expect(opus.textContent).toContain(t('settings.ai.estimate.perMonth', { count: perMonth.count, formatted: formatNumber(perMonth.count) }))
    expect(perMonth.count).toBe(Math.floor(2600 / estimateAiCredits('claude-opus-5-5', 'organize', perMonth.tabs)))
  })

  it("auto: each example is estimated on that feature's own default model", () => {
    const [auto] = [estimatesFor('auto')]
    for (const e of auto) {
      const model = e.action === 'organize' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5'
      expect(e.credits).toBe(estimateAiCredits(model, e.action, e.tabs))
    }
  })

  it('own key: shows dollars billed by Anthropic and no credits', () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    renderSettings()
    const sonnet = screen.getByTestId('ai-model-claude-sonnet-5-5')
    expect(sonnet.textContent).toContain('$')
    expect(sonnet.textContent).not.toMatch(/credit/i)
    expect(screen.getByText(t('settings.ai.model.byokDescription'))).toBeTruthy()
  })
})

describe('AiSettings — own key', () => {
  beforeEach(() => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
  })

  it('rejects a malformed key without calling the server or saving it', async () => {
    renderSettings()
    await userEvent.type(screen.getByTestId('ai-byok-key-input'), 'sk-live-nope')
    await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.save') }))
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.invalidFormat'))
    expect(mockAiPost).not.toHaveBeenCalled()
    expect(await getByokKey('u1')).toBeNull()
  })

  it('verifies with the server first, then saves it and shows it masked', async () => {
    mockAiPost.mockResolvedValue({ ok: true })
    renderSettings()
    await userEvent.type(screen.getByTestId('ai-byok-key-input'), KEY)
    await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.save') }))

    await waitFor(() => expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe('sk-ant-…xxxx'))
    expect(mockAiPost).toHaveBeenCalledWith('/api/ai/byok/verify', {}, 'tok', { byokKey: KEY })
    expect(await getByokKey('u1')).toBe(KEY)
    // only the masked form is on screen
    expect(document.body.textContent).not.toContain(KEY)
  })

  it('does not save a key Anthropic rejects, and says why', async () => {
    mockAiPost.mockRejectedValue(new AiRequestError(AI_ERROR_CODES.byokKeyInvalid, 400, t('errors.ai.byokKeyInvalid')))
    renderSettings()
    await userEvent.type(screen.getByTestId('ai-byok-key-input'), KEY)
    await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.save') }))
    expect((await screen.findByRole('alert')).textContent).toBe(t('errors.ai.byokKeyInvalid'))
    expect(await getByokKey('u1')).toBeNull()
  })

  it('a verify failure without a code (offline, 5xx) shows the generic message and saves nothing', async () => {
    mockAiPost.mockRejectedValue(new Error('network'))
    renderSettings()
    await userEvent.type(screen.getByTestId('ai-byok-key-input'), KEY)
    await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.save') }))
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.verifyFailed'))
    expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toBeUndefined()
  })

  it('Remove deletes the saved key', async () => {
    await saveByokKey('u1', KEY)
    renderSettings()
    const masked = await screen.findByTestId('ai-byok-key-masked')
    await userEvent.click(within(masked.parentElement!).getByRole('button', { name: t('settings.ai.key.remove') }))
    await waitFor(() => expect(screen.getByTestId('ai-byok-key-input')).toBeTruthy())
    expect(await getByokKey('u1')).toBeNull()
  })

  it('links to the Anthropic console to create a key and set a spending limit', async () => {
    renderSettings()
    await userEvent.click(screen.getByText(t('settings.ai.key.consoleLink')))
    expect(tabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('console.anthropic.com') }))
  })
})
