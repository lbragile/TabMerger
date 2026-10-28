import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AI_ERROR_CODES,
  AI_ESTIMATE_EXAMPLES,
  AI_MODELS,
  AI_PROVIDER_KEY_LINKS,
  ACCOUNT_AI_CREDITS_ANCHOR,
  PRO_AI_MONTHLY_CREDITS,
  aiModelsForProvider,
  estimateAiCredits
} from '@tabmerger/shared'
import { AiSettings } from '@/components/Settings/AiSettings'
import { AiRequestError } from '@/lib/aiErrors'
import { costLevel, estimatesFor, organizesFor } from '@/lib/aiModel'
import {
  AI_BYOK_KEY_STORAGE_KEY,
  AI_BYOK_PROVIDER_STORAGE_KEY,
  clearByokKey,
  getByokKey,
  getPickedByokProvider,
  saveByokKey,
  setPickedByokProvider
} from '@/lib/byokKey'
import { buyCreditsUrl } from '@/lib/buyCredits'
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
// This suite tests the AI settings' own logic with AI on; getters let a test turn an option off
const flags = vi.hoisted(() => ({ managed: true, byok: true }))
vi.mock('@/lib/aiFlag', () => ({
  get AI_ENABLED() {
    return flags.managed || flags.byok
  },
  get AI_MANAGED_ENABLED() {
    return flags.managed
  },
  get AI_BYOK_ENABLED() {
    return flags.byok
  }
}))

/** Shaped like an Anthropic key, but too short to look like a real one to the secret scanner. */
const KEY = 'sk-ant-test-xxxxxxxxxxxxxxxx'
/** Shaped like OpenAI and Google keys; built at run time so no key-shaped literal is in the source. */
const OPENAI_KEY = 'sk-proj-' + 'y'.repeat(24)
const GOOGLE_KEY = 'AIza' + 'z'.repeat(35)

const tabsCreate = vi.fn()
Object.assign(globalThis.chrome, { tabs: { create: tabsCreate } })

function renderSettings(model: string | undefined = 'auto', onModelChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(AiSettings, { model: model as never, onModelChange }))
  )
  return Object.assign(onModelChange, { unmount: view.unmount })
}

const CAP = PRO_AI_MONTHLY_CREDITS

/** The own-key settings once loaded (they render nothing while the saved key is read). */
const ready = () => screen.findByTestId('ai-plan-line')
const user = () => userEvent.setup({ pointerEventsCheck: 0 })
/** The provider dropdown's trigger, named by its "AI provider" heading. */
const providerSelect = () => screen.getByRole('combobox', { name: t('settings.ai.provider.label') })
/** The model dropdown's trigger, named by its "AI model" heading. */
const modelSelect = () => screen.getByRole('combobox', { name: t('settings.ai.model.label') })
const optionValue = (option: HTMLElement, prefix: string) => option.getAttribute('data-testid')!.slice(prefix.length)

/** Opens a dropdown and returns its options; `close()` it again before touching the rest. */
async function openSelect(trigger: HTMLElement) {
  await user().click(trigger)
  return screen.findAllByRole('option')
}

async function closeSelect() {
  await user().keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

/** The model dropdown's choices, in order (opens and closes it). */
async function modelValues() {
  const options = await openSelect(modelSelect())
  const values = options.map((o) => optionValue(o, 'ai-model-'))
  await closeSelect()
  return values
}

/** Opens the model dropdown and returns one option (left open). */
async function modelOption(choice: string) {
  await openSelect(modelSelect())
  return screen.getByTestId(`ai-model-${choice}`)
}

async function pick(label: 'Anthropic' | 'OpenAI' | 'Gemini') {
  await openSelect(providerSelect())
  await user().click(screen.getByRole('option', { name: label }))
  await waitFor(() => expect(providerSelect().textContent).toBe(label))
  await screen.findByTestId('ai-byok-key-setting')
}

async function typeAndSave(key: string) {
  await userEvent.type(screen.getByTestId('ai-byok-key-input'), key)
  await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.save') }))
}

beforeEach(async () => {
  // Radix Select needs these in jsdom
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
  vi.clearAllMocks()
  flags.managed = true
  flags.byok = true
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

  it('own key with no key saved: asks for one', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    renderSettings()
    expect((await ready()).textContent).toBe(t('settings.ai.plan.byokNoKey'))
  })

  it('own key with a key saved: names the provider the key belongs to', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    await saveByokKey('u1', OPENAI_KEY)
    renderSettings()
    await waitFor(() => expect(screen.getByTestId('ai-plan-line').textContent).toBe(t('settings.ai.plan.byok', { provider: 'OpenAI' })))
  })

  it('renders nothing until the AI mode is known', () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: null })
    renderSettings()
    expect(screen.queryByTestId('ai-plan-line')).toBeNull()
  })
})

describe('AiSettings — managed plans are unchanged', () => {
  it('no provider picker and no key field: Anthropic models, with the stored choice shown', async () => {
    renderSettings('claude-sonnet-5-5')
    expect(screen.queryByTestId('ai-provider-picker')).toBeNull()
    expect(screen.queryByRole('combobox', { name: t('settings.ai.provider.label') })).toBeNull()
    expect(screen.queryByTestId('ai-byok-key-input')).toBeNull()
    expect(screen.queryByTestId('ai-provider-links')).toBeNull()
    expect(modelSelect().textContent).toBe(AI_MODELS['claude-sonnet-5-5'].label)
    const options = await openSelect(modelSelect())
    expect(options.map((o) => optionValue(o, 'ai-model-'))).toEqual(['auto', ...aiModelsForProvider('anthropic')])
    expect(options.find((o) => o.getAttribute('aria-selected') === 'true')?.getAttribute('data-testid')).toBe('ai-model-claude-sonnet-5-5')
    for (const id of aiModelsForProvider('anthropic')) expect(screen.getByRole('option', { name: new RegExp(`^${AI_MODELS[id].label}`) })).toBeTruthy()
    expect(screen.queryByText(AI_MODELS['gpt-6-luna'].label)).toBeNull()
  })

  it('ignores a provider picked for an own key on this device', async () => {
    await setPickedByokProvider('u1', 'google')
    renderSettings()
    await waitFor(async () => expect(await getPickedByokProvider('u1')).toBe('google'))
    // the Anthropic list stays, whatever an own-key pick says
    expect(await modelValues()).toEqual(['auto', ...aiModelsForProvider('anthropic')])
  })

  it('an unknown stored choice shows Auto', () => {
    renderSettings('gpt-9')
    expect(modelSelect().textContent).toBe(t('settings.ai.model.auto'))
  })

  it('choosing a model updates the draft', async () => {
    const onChange = renderSettings('auto')
    await user().click(await modelOption('claude-haiku-5-5'))
    expect(onChange).toHaveBeenCalledWith('claude-haiku-5-5')
  })

  it('shows credits per example from the shared estimate, and organizes a month', async () => {
    renderSettings()
    const opus = await modelOption('claude-opus-5-5')
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
})

describe('AiSettings — own key: provider first', () => {
  beforeEach(() => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
  })

  it('with nothing picked, shows only the labelled provider dropdown with its placeholder: no key field, links or models', async () => {
    renderSettings()
    await ready()
    const picker = providerSelect()
    expect(picker.textContent).toBe(t('settings.ai.provider.placeholder'))
    expect(picker.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.queryByTestId('ai-byok-key-input')).toBeNull()
    expect(screen.queryByTestId('ai-provider-links')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('combobox', { name: t('settings.ai.model.label') })).toBeNull()
    expect(screen.queryByTestId('ai-model-picker')).toBeNull()
    const options = await openSelect(picker)
    expect(options.map((o) => optionValue(o, 'ai-provider-'))).toEqual(['anthropic', 'openai', 'google'])
    expect(options.some((o) => o.getAttribute('aria-selected') === 'true')).toBe(false)
    await closeSelect()
    // The dev-only test key needs a provider: none yet, even in this dev build
    expect(import.meta.env.DEV).toBe(true)
    expect(screen.queryByTestId('ai-byok-test-key')).toBeNull()
  })

  it('offers the dev-only test key once a provider is picked (dev build)', async () => {
    renderSettings()
    await ready()
    await pick('Gemini')
    expect(screen.getByRole('button', { name: t('settings.ai.key.testKey') })).toBeTruthy()
  })

  it.each([
    ['Anthropic', 'anthropic', 'sk-ant-…'],
    ['OpenAI', 'openai', 'sk-proj-…'],
    ['Gemini', 'google', 'AIza…']
  ] as const)('picking %s shows its key field, its setup links and only its models', async (label, provider, placeholder) => {
    renderSettings()
    await ready()
    await pick(label)
    const input = screen.getByLabelText(t('settings.ai.key.label', { provider: label })) as HTMLInputElement
    expect(input.placeholder).toBe(placeholder)
    expect(screen.getByRole('link', { name: t('settings.ai.key.guideLink') }).getAttribute('href')).toBe(AI_PROVIDER_KEY_LINKS[provider].guide)
    expect(screen.getByRole('link', { name: t('settings.ai.key.keysLink', { provider: label }) }).getAttribute('href')).toBe(
      AI_PROVIDER_KEY_LINKS[provider].keys
    )
    // models show before any key is saved, and only this provider's
    expect(await modelValues()).toEqual(['auto', ...aiModelsForProvider(provider)])
    expect(screen.queryByTestId('ai-byok-key-masked')).toBeNull()
  })

  it('keeps the storage-and-spending copy once a provider is picked', async () => {
    renderSettings()
    await ready()
    await pick('Anthropic')
    expect(screen.getByText(t('settings.ai.key.note'))).toBeTruthy()
    expect(screen.getByTestId('ai-provider-links').textContent).toContain(t('settings.ai.key.getKey'))
  })

  it('setup links open in a new tab, without an opener or referrer', async () => {
    renderSettings()
    await ready()
    await pick('Gemini')
    for (const link of within(screen.getByTestId('ai-provider-links')).getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
    await userEvent.click(screen.getByRole('link', { name: t('settings.ai.key.guideLink') }))
    expect(tabsCreate).toHaveBeenLastCalledWith({ url: AI_PROVIDER_KEY_LINKS.google.guide, active: true })
    await userEvent.click(screen.getByRole('link', { name: t('settings.ai.key.keysLink', { provider: 'Gemini' }) }))
    expect(tabsCreate).toHaveBeenLastCalledWith({ url: AI_PROVIDER_KEY_LINKS.google.keys, active: true })
  })

  it('remembers a picked provider without a key on this device, so reopening Settings keeps it', async () => {
    const first = renderSettings()
    await ready()
    await pick('OpenAI')
    await waitFor(async () => expect(await getPickedByokProvider('u1')).toBe('openai'))
    first.unmount()

    renderSettings()
    await ready()
    await waitFor(() => expect(providerSelect().textContent).toBe('OpenAI'))
    expect(screen.getByTestId('ai-byok-key-input')).toBeTruthy()
    expect(await modelValues()).toEqual(['auto', ...aiModelsForProvider('openai')])
  })

  it('preselects the saved key’s provider and shows the key masked with Replace and Remove', async () => {
    await saveByokKey('u1', GOOGLE_KEY)
    renderSettings()
    await ready()
    expect(providerSelect().textContent).toBe('Gemini')
    expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe('AIza…zzzz')
    expect(screen.getByRole('button', { name: t('settings.ai.key.replace') })).toBeTruthy()
    expect(screen.getByRole('button', { name: t('settings.ai.key.remove') })).toBeTruthy()
    expect(await modelValues()).toEqual(['auto', ...aiModelsForProvider('google')])
    expect(screen.queryByTestId('ai-byok-switch-note')).toBeNull()
  })

  it("own key: each model has a cost level and no figures", async () => {
    await saveByokKey('u1', GOOGLE_KEY)
    renderSettings('gemini-4-argon')
    await ready()
    const picker = screen.getByTestId('ai-model-picker')
    expect(screen.getByTestId('ai-model-selected-info').textContent).toBe(t('settings.ai.cost.high'))
    await openSelect(modelSelect())
    expect(screen.getByTestId('ai-model-gemini-3.1-flash-lite').textContent).toContain(t('settings.ai.cost.low'))
    expect(screen.getByTestId('ai-model-gemini-3.8-flash').textContent).toContain(t('settings.ai.cost.medium'))
    expect(screen.getByTestId('ai-model-gemini-4-argon').textContent).toContain(t('settings.ai.cost.high'))
    for (const scope of [picker, screen.getByRole('listbox')]) {
      expect(scope.textContent).not.toMatch(/[$€£]|US\$|credit/i)
      for (const el of scope.querySelectorAll('[aria-label],[title]')) {
        expect(`${el.getAttribute('aria-label') ?? ''}${el.getAttribute('title') ?? ''}`).not.toMatch(/[$]/)
      }
    }
    expect(screen.getByText(t('settings.ai.model.byokDescription'))).toBeTruthy()
  })

  it('own key, Auto: names the cost level of the model it uses for each example', async () => {
    await saveByokKey('u1', OPENAI_KEY)
    renderSettings()
    await ready()
    await waitFor(() => expect(providerSelect().textContent).toBe('OpenAI'))
    const expected = estimatesFor('auto', 'openai').map((e) => {
      const action = t(`settings.ai.estimate.action.${e.action}`, { count: e.tabs })
      return t('settings.ai.estimate.item', { action, amount: t(`settings.ai.cost.${costLevel(e.model)}`) })
    })
    // under the row while Auto is chosen, and in the Auto option
    for (const item of expected) expect(screen.getByTestId('ai-model-selected-info').textContent).toContain(item)
    const auto = await modelOption('auto')
    for (const item of expected) expect(auto.textContent).toContain(item)
  })

  it('a stored model of another provider shows as Auto', async () => {
    await saveByokKey('u1', OPENAI_KEY)
    renderSettings('claude-opus-5-5')
    await ready()
    await waitFor(() => expect(providerSelect().textContent).toBe('OpenAI'))
    expect(modelSelect().textContent).toBe(t('settings.ai.model.auto'))
    expect((await modelOption('auto')).getAttribute('aria-selected')).toBe('true')
  })

  it('choosing a model of a picked provider before saving a key updates the draft', async () => {
    const onChange = renderSettings()
    await ready()
    await pick('OpenAI')
    await user().click(await modelOption('gpt-6-astra'))
    expect(onChange).toHaveBeenCalledWith('gpt-6-astra')
  })
})

describe('AiSettings — own key: key checks and save', () => {
  beforeEach(() => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
  })

  it.each([
    ['Anthropic', OPENAI_KEY, 'OpenAI'],
    ['OpenAI', GOOGLE_KEY, 'Gemini'],
    ['Gemini', KEY, 'Anthropic']
  ] as const)('with %s picked, a key of another provider gets an inline error and is neither sent nor saved', async (picked, key, detected) => {
    renderSettings()
    await ready()
    await pick(picked)
    await typeAndSave(key)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(t('settings.ai.key.wrongProvider', { detected, provider: picked }))
    const input = screen.getByTestId('ai-byok-key-input')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id)
    expect(mockAiPost).not.toHaveBeenCalled()
    expect(await getByokKey('u1')).toBeNull()
  })

  it('editing the key clears the inline error', async () => {
    renderSettings()
    await ready()
    await pick('Anthropic')
    await typeAndSave(OPENAI_KEY)
    await screen.findByRole('alert')
    await userEvent.type(screen.getByTestId('ai-byok-key-input'), 'x')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('ai-byok-key-input').getAttribute('aria-invalid')).toBeNull()
  })

  it('rejects a malformed key, naming the picked provider, without calling the server or saving it', async () => {
    renderSettings()
    await ready()
    await pick('OpenAI')
    await typeAndSave('sk-live-nope')
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.invalidFormat', { provider: 'OpenAI' }))
    expect(mockAiPost).not.toHaveBeenCalled()
    expect(await getByokKey('u1')).toBeNull()
  })

  it('verifies with the server first, then saves it, shows it masked and forgets the pick', async () => {
    mockAiPost.mockResolvedValue({ ok: true, provider: 'anthropic' })
    renderSettings()
    await ready()
    await pick('Anthropic')
    await typeAndSave(KEY)

    await waitFor(() => expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe('sk-ant-…xxxx'))
    expect(mockAiPost).toHaveBeenCalledWith('/api/ai/byok/verify', {}, 'tok', { byokKey: KEY })
    expect(await getByokKey('u1')).toEqual({ key: KEY, provider: 'anthropic' })
    await waitFor(async () => expect(await getPickedByokProvider('u1')).toBeNull())
    expect(providerSelect().textContent).toBe('Anthropic')
    // only the masked form is on screen
    expect(document.body.textContent).not.toContain(KEY)
  })

  it.each([
    ['OpenAI', OPENAI_KEY, 'openai', 'sk-…yyyy'],
    ['Gemini', GOOGLE_KEY, 'google', 'AIza…zzzz']
  ] as const)('saves a %s key with its provider and masks it the way that provider writes keys', async (label, key, provider, masked) => {
    mockAiPost.mockResolvedValue({ ok: true, provider })
    renderSettings()
    await ready()
    await pick(label)
    await typeAndSave(key)
    await waitFor(() => expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe(masked))
    expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toEqual({ userId: 'u1', key, provider })
  })

  it('does not save a key when the server reports a different provider than its shape says', async () => {
    mockAiPost.mockResolvedValue({ ok: true, provider: 'google' })
    renderSettings()
    await ready()
    await pick('OpenAI')
    await typeAndSave(OPENAI_KEY)
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.verifyFailed'))
    expect(await getByokKey('u1')).toBeNull()
  })

  it('does not save a key the provider rejects, and says why', async () => {
    mockAiPost.mockRejectedValue(new AiRequestError(AI_ERROR_CODES.byokKeyInvalid, 400, t('errors.ai.byokKeyInvalid')))
    renderSettings()
    await ready()
    await pick('Anthropic')
    await typeAndSave(KEY)
    expect((await screen.findByRole('alert')).textContent).toBe(t('errors.ai.byokKeyInvalid'))
    expect(await getByokKey('u1')).toBeNull()
  })

  it('a verify failure without a code (offline, 5xx) shows the generic message and saves nothing', async () => {
    mockAiPost.mockRejectedValue(new Error('network'))
    renderSettings()
    await ready()
    await pick('Anthropic')
    await typeAndSave(KEY)
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.verifyFailed'))
    expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toBeUndefined()
  })

  it('Remove deletes the saved key, keeps its provider picked and moves focus to the key field', async () => {
    await saveByokKey('u1', KEY)
    renderSettings()
    await screen.findByTestId('ai-byok-key-masked')
    await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.remove') }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('ai-byok-key-input')))
    expect(await getByokKey('u1')).toBeNull()
    expect(providerSelect().textContent).toBe('Anthropic')
    expect(await getPickedByokProvider('u1')).toBe('anthropic')
    expect(await modelValues()).toEqual(['auto', ...aiModelsForProvider('anthropic')])
  })

  it('Replace then Cancel returns to the masked key and puts focus back on Replace', async () => {
    await saveByokKey('u1', KEY)
    renderSettings()
    await screen.findByTestId('ai-byok-key-masked')
    await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.replace') }))
    expect(screen.getByTestId('ai-byok-key-input')).toBeTruthy()
    await userEvent.click(screen.getByTestId('ai-byok-cancel'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: t('settings.ai.key.replace') })))
    expect(screen.getByTestId('ai-byok-key-masked')).toBeTruthy()
  })
})

describe('AiSettings — own key: switching provider with a key saved', () => {
  beforeEach(async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    await saveByokKey('u1', OPENAI_KEY)
  })

  it('says the saved key stays in use, offers the new provider’s key field and models, and Cancel goes back', async () => {
    renderSettings()
    await ready()
    await pick('Gemini')

    const note = screen.getByTestId('ai-byok-switch-note')
    expect(note.textContent).toBe(t('settings.ai.key.switching', { saved: 'OpenAI', provider: 'Gemini' }))
    const input = screen.getByTestId('ai-byok-key-input')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(note.id)
    expect((input as HTMLInputElement).placeholder).toBe('AIza…')
    expect(screen.queryByTestId('ai-byok-key-masked')).toBeNull()
    expect(await modelValues()).toEqual(['auto', ...aiModelsForProvider('google')])
    // the saved key is untouched, and the plan line still names it
    expect(await getByokKey('u1')).toEqual({ key: OPENAI_KEY, provider: 'openai' })
    expect(screen.getByTestId('ai-plan-line').textContent).toBe(t('settings.ai.plan.byok', { provider: 'OpenAI' }))

    await userEvent.click(screen.getByTestId('ai-byok-cancel'))
    await waitFor(() => expect(providerSelect().textContent).toBe('OpenAI'))
    await waitFor(() => expect(document.activeElement).toBe(providerSelect()))
    expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe('sk-…yyyy')
    expect(screen.queryByTestId('ai-byok-switch-note')).toBeNull()
    expect(await modelValues()).toEqual(['auto', ...aiModelsForProvider('openai')])
    await waitFor(async () => expect(await getPickedByokProvider('u1')).toBeNull())
  })

  it('a switch is remembered across reopening Settings', async () => {
    await setPickedByokProvider('u1', 'anthropic')
    renderSettings()
    await ready()
    expect(providerSelect().textContent).toBe('Anthropic')
    expect(screen.getByTestId('ai-byok-switch-note').textContent).toBe(t('settings.ai.key.switching', { saved: 'OpenAI', provider: 'Anthropic' }))
  })

  it('picking the saved key’s provider again ends the switch and forgets the pick', async () => {
    renderSettings()
    await ready()
    await pick('Gemini')
    await waitFor(async () => expect(await getPickedByokProvider('u1')).toBe('google'))
    await pick('OpenAI')
    expect(screen.queryByTestId('ai-byok-switch-note')).toBeNull()
    await waitFor(async () => expect(await getPickedByokProvider('u1')).toBeNull())
  })

  it('saving a key of the new provider replaces the saved key and resets a model of the old provider to auto', async () => {
    mockAiPost.mockResolvedValue({ ok: true, provider: 'google' })
    const onChange = renderSettings('gpt-6-astra')
    await ready()
    await pick('Gemini')
    await typeAndSave(GOOGLE_KEY)
    await waitFor(() => expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe('AIza…zzzz'))
    expect(onChange).toHaveBeenCalledWith('auto')
    expect(await getByokKey('u1')).toEqual({ key: GOOGLE_KEY, provider: 'google' })
    expect(screen.queryByTestId('ai-byok-switch-note')).toBeNull()
    await waitFor(async () => expect(await getPickedByokProvider('u1')).toBeNull())
  })

  it('keeps a model choice that already fits the new key', async () => {
    mockAiPost.mockResolvedValue({ ok: true, provider: 'google' })
    const onChange = renderSettings('gemini-4-argon')
    await ready()
    await pick('Gemini')
    await typeAndSave(GOOGLE_KEY)
    await screen.findByText('AIza…zzzz')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a key of the old provider pasted while switching is refused as a mismatch', async () => {
    renderSettings()
    await ready()
    await pick('Gemini')
    await typeAndSave(OPENAI_KEY)
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.wrongProvider', { detected: 'OpenAI', provider: 'Gemini' }))
    expect(mockAiPost).not.toHaveBeenCalled()
  })

  it('stores the pick in its own storage key, never next to the key itself', async () => {
    renderSettings()
    await ready()
    await pick('Anthropic')
    await waitFor(async () =>
      expect((await chrome.storage.local.get(AI_BYOK_PROVIDER_STORAGE_KEY))[AI_BYOK_PROVIDER_STORAGE_KEY]).toEqual({ userId: 'u1', provider: 'anthropic' })
    )
    expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toEqual({ userId: 'u1', key: OPENAI_KEY, provider: 'openai' })
  })
})

describe('AiSettings — Buy more credits', () => {
  const buy = () => screen.queryByRole('link', { name: t('settings.ai.buyCreditsLabel') })
  const usage = (remaining: number, cap: number, known = true) =>
    mockUseAiUsage.mockReturnValue({ used: Math.max(0, cap - remaining), remaining, cap, loading: !known, known })

  it('managed Pro AI: a link next to the credits line, to the account page credits section in a new tab', () => {
    renderSettings()
    const link = buy()!
    expect(link).toBeTruthy()
    expect(link.textContent).toBe(t('settings.ai.buyCredits'))
    // the accessible name keeps the visible words and says a new tab opens
    expect(t('settings.ai.buyCreditsLabel').startsWith(t('settings.ai.buyCredits'))).toBe(true)
    expect(link.getAttribute('href')).toBe(buyCreditsUrl())
    expect(link.getAttribute('href')).toBe(`${import.meta.env.VITE_WEB_APP_URL}/account#${ACCOUNT_AI_CREDITS_ANCHOR}`)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByTestId('ai-plan-line').parentElement!.contains(link)).toBe(true)
  })

  it('clicking it opens the buy-credits page through the tabs API', async () => {
    renderSettings()
    await userEvent.click(buy()!)
    expect(tabsCreate).toHaveBeenCalledTimes(1)
    expect(tabsCreate).toHaveBeenCalledWith({ url: buyCreditsUrl(), active: true })
  })

  it('own key (BYOK): hidden', async () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    renderSettings()
    await ready()
    expect(buy()).toBeNull()
    expect(screen.queryByTestId('ai-buy-credits')).toBeNull()
  })

  it('without Pro AI: hidden', () => {
    mockUseEntitlements.mockReturnValue({ aiFeatures: false, aiMode: 'managed' })
    renderSettings()
    expect(screen.getByTestId('ai-plan-line')).toBeTruthy()
    expect(screen.queryByTestId('ai-buy-credits')).toBeNull()
  })

  it("hidden while TabMerger's AI is off, even if the plan says managed", () => {
    flags.managed = false
    renderSettings()
    expect(screen.queryByTestId('ai-buy-credits')).toBeNull()
  })

  it('hidden while every AI option is off', () => {
    flags.managed = false
    flags.byok = false
    renderSettings()
    expect(screen.queryByTestId('ai-buy-credits')).toBeNull()
  })

  it.each([
    [251, 'normal'],
    [250, 'normal'],
    [249, 'low']
  ] as const)('%i of 2,500 left (10%% = 250): %s emphasis', (remaining, emphasis) => {
    usage(remaining, 2500)
    renderSettings()
    const link = screen.getByTestId('ai-buy-credits')
    expect(link.getAttribute('data-emphasis')).toBe(emphasis)
    // a button look below the threshold, a plain link above it; a link with the same name either way
    expect(link.className.includes('bg-primary')).toBe(emphasis === 'low')
    expect(link.className.includes('hover:underline')).toBe(emphasis === 'normal')
    expect(buy()).toBe(link)
  })

  it('takes the share of the total with packs bought this month', () => {
    usage(299, 3000)
    renderSettings()
    expect(screen.getByTestId('ai-buy-credits').getAttribute('data-emphasis')).toBe('low')
  })

  it('no emphasis while the balance is unknown', () => {
    usage(0, CAP, false)
    renderSettings()
    expect(screen.getByTestId('ai-plan-line').textContent).toBe(t('settings.ai.plan.managedUnknown'))
    expect(screen.getByTestId('ai-buy-credits').getAttribute('data-emphasis')).toBe('normal')
  })

  it('a total of 0 renders, emphasised: nothing is left', () => {
    usage(0, 0)
    renderSettings()
    expect(screen.getByTestId('ai-buy-credits').getAttribute('data-emphasis')).toBe('low')
  })
})
