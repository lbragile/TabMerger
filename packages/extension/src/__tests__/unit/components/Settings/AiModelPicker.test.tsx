import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AI_MODELS, AI_PROVIDERS, PRO_AI_MONTHLY_CREDITS, aiModelsForProvider, type AiMode, type AiModelChoice, type AiProvider } from '@tabmerger/shared'
import { AiModelPicker } from '@/components/Settings/AiModelPicker'
import { AI_SELECT_TRIGGER_CLASS } from '@/components/Settings/settingsControls'
import { costLevel, organizesFor } from '@/lib/aiModel'
import { formatNumber, t } from '@/lib/i18n'

beforeAll(() => {
  // Radix Select needs these in jsdom
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

function renderPicker(provider: AiProvider, aiMode: AiMode = 'byok', value: AiModelChoice = 'auto', onChange = vi.fn()) {
  render(React.createElement(AiModelPicker, { value, onChange, aiMode, provider, allowance: PRO_AI_MONTHLY_CREDITS }))
  return onChange
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 })
const trigger = () => screen.getByRole('combobox', { name: t('settings.ai.model.label') })
const selectedInfo = () => screen.getByTestId('ai-model-selected-info')

/** Opens the list and returns its options. */
async function open() {
  await user().click(trigger())
  return screen.findAllByRole('option')
}

const values = (options: HTMLElement[]) => options.map((o) => o.getAttribute('data-testid')?.replace(/^ai-model-/, ''))

describe('AiModelPicker', () => {
  it('is a dropdown named by the "AI model" heading, described by its hint and the chosen model’s info', () => {
    renderPicker('openai')
    const select = trigger()
    const heading = screen.getByText(t('settings.ai.model.label'))
    expect(select.getAttribute('aria-labelledby')).toBe(heading.id)
    const hint = screen.getByText(t('settings.ai.model.byokDescription'))
    expect(select.getAttribute('aria-describedby')?.split(' ')).toEqual([hint.id, selectedInfo().id])
    for (const c of AI_SELECT_TRIGGER_CLASS.split(' ')) expect(select.className.split(/\s+/)).toContain(c)
  })

  it.each(AI_PROVIDERS)('own key on %s: Auto first, then only that provider’s models', async (provider) => {
    renderPicker(provider)
    expect(values(await open())).toEqual(['auto', ...aiModelsForProvider(provider)])
    for (const other of AI_PROVIDERS.filter((p) => p !== provider)) {
      for (const id of aiModelsForProvider(other)) expect(screen.queryByTestId(`ai-model-${id}`)).toBeNull()
    }
  })

  it('always offers a choice: no "add a key first" state', async () => {
    renderPicker('openai')
    expect(screen.queryByTestId('ai-model-add-key-first')).toBeNull()
    expect((await open()).length).toBeGreaterThan(1)
  })

  it('the trigger shows only the chosen model’s name; its info stays visible under the row', () => {
    renderPicker('openai', 'byok', 'gpt-6-astra')
    expect(trigger().textContent).toBe(AI_MODELS['gpt-6-astra'].label)
    expect(selectedInfo().textContent).toBe(t(`settings.ai.cost.${costLevel('gpt-6-astra')}`))
  })

  it('each option names its model and carries its cost level on a muted second line', async () => {
    renderPicker('google')
    await open()
    for (const id of aiModelsForProvider('google')) {
      const option = screen.getByTestId(`ai-model-${id}`)
      const [name, info] = Array.from(option.querySelectorAll(':scope > span:last-child > span'))
      expect(name.textContent).toBe(AI_MODELS[id].label)
      expect(info.textContent).toBe(t(`settings.ai.cost.${costLevel(id)}`))
      expect(info.className).toContain('text-muted-foreground')
    }
  })

  it('Auto is marked recommended and says what it does, in the list and under the row', async () => {
    renderPicker('anthropic')
    expect(trigger().textContent).toBe(t('settings.ai.model.auto'))
    expect(selectedInfo().textContent).toContain(t('settings.ai.model.autoDescription'))
    await open()
    const auto = screen.getByRole('option', { name: new RegExp(t('settings.ai.model.auto')) })
    expect(auto.getAttribute('data-testid')).toBe('ai-model-auto')
    expect(within(auto).getByText(t('settings.ai.model.recommended'))).toBeTruthy()
    expect(auto.textContent).toContain(t('settings.ai.model.autoDescription'))
  })

  it('a model of another provider shows as Auto', async () => {
    renderPicker('google', 'byok', 'claude-opus-5-5')
    expect(trigger().textContent).toBe(t('settings.ai.model.auto'))
    await open()
    expect(screen.getByTestId('ai-model-auto').getAttribute('aria-selected')).toBe('true')
  })

  it('picking a model with the mouse reports it', async () => {
    const onChange = renderPicker('openai')
    await open()
    await user().click(screen.getByTestId('ai-model-gpt-6-astra'))
    expect(onChange).toHaveBeenCalledWith('gpt-6-astra')
  })

  it('works from the keyboard: open with Enter, move with the arrows, pick with Enter', async () => {
    const onChange = renderPicker('anthropic')
    const u = user()
    trigger().focus()
    await u.keyboard('{Enter}')
    await screen.findByRole('listbox')
    await u.keyboard('{ArrowDown}')
    await u.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith(aiModelsForProvider('anthropic')[0])
  })

  it('typing a model’s name jumps to it (typeahead reads the name, not the info line)', async () => {
    const onChange = renderPicker('google')
    const u = user()
    trigger().focus()
    await u.keyboard('{Enter}')
    await screen.findByRole('listbox')
    await u.keyboard('Gemini 4')
    await u.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('gemini-4-argon')
  })

  it('managed: Anthropic models with credits, and organizes a month for the chosen one under the row', async () => {
    renderPicker('anthropic', 'managed', 'claude-opus-5-5')
    expect(screen.getByText(t('settings.ai.model.managedDescription'))).toBeTruthy()
    const perMonth = organizesFor('claude-opus-5-5', PRO_AI_MONTHLY_CREDITS)!
    expect(selectedInfo().textContent).toMatch(/credit/i)
    expect(selectedInfo().textContent).toContain(t('settings.ai.estimate.perMonth', { count: perMonth.count, formatted: formatNumber(perMonth.count) }))
    expect(values(await open())).toEqual(['auto', ...aiModelsForProvider('anthropic')])
    expect(screen.getByTestId('ai-model-claude-opus-5-5').textContent).toMatch(/credit/i)
  })
})
