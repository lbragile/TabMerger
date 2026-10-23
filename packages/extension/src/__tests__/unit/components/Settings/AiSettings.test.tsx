import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AI_ERROR_CODES,
  AI_ESTIMATE_EXAMPLES,
  AI_MODELS,
  AI_PROVIDER_KEY_URLS,
  PRO_AI_MONTHLY_CREDITS,
  aiModelsForProvider,
  estimateAiCredits
} from '@tabmerger/shared'
import { AiSettings } from '@/components/Settings/AiSettings'
import { AiRequestError } from '@/lib/aiErrors'
import { costLevel, estimatesFor, organizesFor } from '@/lib/aiModel'
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
/** Shaped like OpenAI and Google keys; built at run time so no key-shaped literal is in the source. */
const OPENAI_KEY = 'sk-proj-' + 'y'.repeat(24)
const GOOGLE_KEY = 'AIza' + 'z'.repeat(35)

const tabsCreate = vi.fn()
Object.assign(globalThis.chrome, { tabs: { create: tabsCreate } })

function renderSettings(model: string | undefined = 'auto', onModelChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(AiSettings, { model: model as never, onModelChange }))
  )
  return onModelChange
}

const CAP = PRO_AI_MONTHLY_CREDITS

async function typeAndSave(key: string) {
  await userEvent.type(screen.getByTestId('ai-byok-key-input'), key)
  await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.save') }))
}

beforeEach(async () => {
  vi.clearAllMocks()
  await clearByokKey()
  mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'managed' })
  mockUseAiUsage.mockReturnValue({ used: 760, remaining: CAP - 760, cap: CAP, loading: false, known: true })
})

describe('AiSettings — plan line', () => {
  it("managed: TabMerger's key with the credits left this month", () => {
    renderSettings()
    expect(screen.getByTestId('ai-plan-line').textContent).toBe(
      t('settings.ai.plan.managed', { remaining: formatNumber(CAP - 760), cap: formatNumber(CAP) })
    )
  })

  it('managed with an unknown balance: no made-up numbers', () => {
    mockUseAiUsage.mockReturnValue({ used: 0, remaining: CAP, cap: CAP, loading: false, known: false })
    renderSettings()
    expect(screen.getByTestId('ai-plan-line').textContent).toBe(t('settings.ai.plan.managedUnknown'))
  })

  it('own key with no key saved: asks for one and shows the key field', () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    renderSettings()
    expect(screen.getByTestId('ai-plan-line').textContent).toBe(t('settings.ai.plan.byokNoKey'))
    expect(screen.getByLabelText(t('settings.ai.key.label'))).toBeTruthy()
  })

  it('own key with a key saved: names the provider the key belongs to', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    await saveByokKey('u1', OPENAI_KEY)
    renderSettings()
    await waitFor(() => expect(screen.getByTestId('ai-plan-line').textContent).toBe(t('settings.ai.plan.byok', { provider: 'OpenAI' })))
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
  it('managed: lists Auto then the Anthropic models only, as a radio group with the stored choice checked', () => {
    renderSettings('claude-sonnet-5-5')
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.value)).toEqual(['auto', ...aiModelsForProvider('anthropic')])
    expect(radios.find((r) => r.checked)?.value).toBe('claude-sonnet-5-5')
    expect(screen.getByRole('group', { name: t('settings.ai.model.label') })).toBeTruthy()
    for (const id of aiModelsForProvider('anthropic')) expect(screen.getByText(AI_MODELS[id].label)).toBeTruthy()
    expect(screen.queryByText(AI_MODELS['gpt-6-luna'].label)).toBeNull()
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
    const perMonth = organizesFor('claude-opus-5-5', CAP)!
    expect(opus.textContent).toContain(t('settings.ai.estimate.perMonth', { count: perMonth.count, formatted: formatNumber(perMonth.count) }))
    expect(perMonth.count).toBe(Math.floor(CAP / estimateAiCredits('claude-opus-5-5', 'organize', perMonth.tabs)))
  })

  it("auto: each example is estimated on that feature's own default model, per provider", () => {
    for (const e of estimatesFor('auto')) {
      expect(e.credits).toBe(estimateAiCredits(e.action === 'organize' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', e.action, e.tabs))
    }
    for (const e of estimatesFor('auto', 'openai')) {
      expect(e.model).toBe(e.action === 'organize' ? 'gpt-6.1-sol' : 'gpt-6-luna')
    }
  })

  it("own key: offers only the saved key's provider's models, each with a cost level and no figures", async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    await saveByokKey('u1', GOOGLE_KEY)
    renderSettings()
    await waitFor(() =>
      expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['auto', ...aiModelsForProvider('google')])
    )
    expect(screen.getByTestId('ai-model-gemini-3.1-flash-lite').textContent).toContain(t('settings.ai.cost.low'))
    expect(screen.getByTestId('ai-model-gemini-3.8-flash').textContent).toContain(t('settings.ai.cost.medium'))
    expect(screen.getByTestId('ai-model-gemini-4-argon').textContent).toContain(t('settings.ai.cost.high'))
    const picker = screen.getByRole('group', { name: t('settings.ai.model.label') })
    // no dollar amounts or credit counts anywhere in the own-key picker, including labels
    expect(picker.textContent).not.toMatch(/[$€£]|US\$|credit/i)
    for (const el of picker.querySelectorAll('[aria-label],[title]')) {
      expect(`${el.getAttribute('aria-label') ?? ''}${el.getAttribute('title') ?? ''}`).not.toMatch(/[$]/)
    }
    expect(screen.getByText(t('settings.ai.model.byokDescription'))).toBeTruthy()
  })

  it('own key, Auto: names the cost level of the model it uses for each example', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    await saveByokKey('u1', OPENAI_KEY)
    renderSettings()
    const auto = await screen.findByTestId('ai-model-auto')
    for (const e of estimatesFor('auto', 'openai')) {
      const action = t(`settings.ai.estimate.action.${e.action}`, { count: e.tabs })
      expect(auto.textContent).toContain(t('settings.ai.estimate.item', { action, amount: t(`settings.ai.cost.${costLevel(e.model)}`) }))
    }
  })

  it('own key with no key saved: asks for a key before offering models', () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    renderSettings()
    expect(screen.getByTestId('ai-model-add-key-first').textContent).toBe(t('settings.ai.model.addKeyFirst'))
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('a stored model of another provider shows as Auto', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    await saveByokKey('u1', OPENAI_KEY)
    renderSettings('claude-opus-5-5')
    await waitFor(() => expect((screen.getByRole('radio', { name: /auto/i }) as HTMLInputElement).checked).toBe(true))
  })
})

describe('AiSettings — own key', () => {
  beforeEach(() => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
  })

  it('rejects a malformed key without calling the server or saving it', async () => {
    renderSettings()
    await typeAndSave('sk-live-nope')
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.invalidFormat'))
    expect(mockAiPost).not.toHaveBeenCalled()
    expect(await getByokKey('u1')).toBeNull()
  })

  it('verifies with the server first, then saves it and shows it masked', async () => {
    mockAiPost.mockResolvedValue({ ok: true, provider: 'anthropic' })
    renderSettings()
    await typeAndSave(KEY)

    await waitFor(() => expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe('sk-ant-…xxxx'))
    expect(mockAiPost).toHaveBeenCalledWith('/api/ai/byok/verify', {}, 'tok', { byokKey: KEY })
    expect(await getByokKey('u1')).toEqual({ key: KEY, provider: 'anthropic' })
    // only the masked form is on screen
    expect(document.body.textContent).not.toContain(KEY)
  })

  it.each([
    ['OpenAI', OPENAI_KEY, 'openai', 'sk-…yyyy'],
    ['Google', GOOGLE_KEY, 'google', 'AIza…zzzz']
  ])('saves a %s key with its provider and masks it the way that provider writes keys', async (_label, key, provider, masked) => {
    mockAiPost.mockResolvedValue({ ok: true, provider })
    renderSettings()
    await typeAndSave(key)
    await waitFor(() => expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe(masked))
    expect(await getByokKey('u1')).toEqual({ key, provider })
    expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toEqual({ userId: 'u1', key, provider })
  })

  it('saving a key of another provider resets a model of the old provider to auto', async () => {
    mockAiPost.mockResolvedValue({ ok: true, provider: 'openai' })
    const onChange = renderSettings('claude-opus-5-5')
    await typeAndSave(OPENAI_KEY)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('auto'))
  })

  it('keeps a model choice that still fits the new key', async () => {
    mockAiPost.mockResolvedValue({ ok: true, provider: 'openai' })
    const onChange = renderSettings('gpt-6-astra')
    await typeAndSave(OPENAI_KEY)
    await screen.findByTestId('ai-byok-key-masked')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not save a key when the server reports a different provider than its shape says', async () => {
    mockAiPost.mockResolvedValue({ ok: true, provider: 'google' })
    renderSettings()
    await typeAndSave(OPENAI_KEY)
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.verifyFailed'))
    expect(await getByokKey('u1')).toBeNull()
  })

  it('does not save a key the provider rejects, and says why', async () => {
    mockAiPost.mockRejectedValue(new AiRequestError(AI_ERROR_CODES.byokKeyInvalid, 400, t('errors.ai.byokKeyInvalid')))
    renderSettings()
    await typeAndSave(KEY)
    expect((await screen.findByRole('alert')).textContent).toBe(t('errors.ai.byokKeyInvalid'))
    expect(await getByokKey('u1')).toBeNull()
  })

  it('a verify failure without a code (offline, 5xx) shows the generic message and saves nothing', async () => {
    mockAiPost.mockRejectedValue(new Error('network'))
    renderSettings()
    await typeAndSave(KEY)
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.verifyFailed'))
    expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toBeUndefined()
  })

  it('Remove deletes the saved key', async () => {
    await saveByokKey('u1', KEY)
    renderSettings()
    await screen.findByTestId('ai-byok-key-masked')
    await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.remove') }))
    await waitFor(() => expect(screen.getByTestId('ai-byok-key-input')).toBeTruthy())
    expect(await getByokKey('u1')).toBeNull()
  })

  it("with no key saved, links to each provider's key page", async () => {
    renderSettings()
    for (const [label, provider] of [['Anthropic', 'anthropic'], ['OpenAI', 'openai'], ['Google', 'google']] as const) {
      await userEvent.click(screen.getByRole('link', { name: label }))
      expect(tabsCreate).toHaveBeenLastCalledWith(expect.objectContaining({ url: AI_PROVIDER_KEY_URLS[provider] }))
    }
  })

  it("with a key saved, links to that provider's page to manage it and its spending limit", async () => {
    await saveByokKey('u1', GOOGLE_KEY)
    renderSettings()
    await userEvent.click(await screen.findByText(t('settings.ai.key.manageLink', { provider: 'Google' })))
    expect(tabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: AI_PROVIDER_KEY_URLS.google }))
  })
})
