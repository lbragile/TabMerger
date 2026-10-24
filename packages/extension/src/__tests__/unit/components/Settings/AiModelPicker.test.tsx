import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { AI_PROVIDERS, PRO_AI_MONTHLY_CREDITS, aiModelsForProvider, type AiMode, type AiModelChoice, type AiProvider } from '@tabmerger/shared'
import { AiModelPicker } from '@/components/Settings/AiModelPicker'
import { t } from '@/lib/i18n'

function renderPicker(provider: AiProvider, aiMode: AiMode = 'byok', value: AiModelChoice = 'auto') {
  render(React.createElement(AiModelPicker, { value, onChange: vi.fn(), aiMode, provider, allowance: PRO_AI_MONTHLY_CREDITS }))
}

const values = () => (screen.getAllByRole('radio') as HTMLInputElement[]).map((r) => r.value)

describe('AiModelPicker', () => {
  it.each(AI_PROVIDERS)('own key on %s: Auto plus only that provider’s models', (provider) => {
    renderPicker(provider)
    expect(values()).toEqual(['auto', ...aiModelsForProvider(provider)])
    for (const other of AI_PROVIDERS.filter((p) => p !== provider)) {
      for (const id of aiModelsForProvider(other)) expect(screen.queryByTestId(`ai-model-${id}`)).toBeNull()
    }
    expect(screen.getByText(t('settings.ai.model.byokDescription'))).toBeTruthy()
  })

  it('always offers a choice: no "add a key first" state', () => {
    renderPicker('openai')
    expect(screen.queryByTestId('ai-model-add-key-first')).toBeNull()
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(1)
  })

  it('a model of another provider shows as Auto', () => {
    renderPicker('google', 'byok', 'claude-opus-5-5')
    expect((screen.getByRole('radio', { name: /auto/i }) as HTMLInputElement).checked).toBe(true)
  })

  it('managed: Anthropic models with credits', () => {
    renderPicker('anthropic', 'managed')
    expect(values()).toEqual(['auto', ...aiModelsForProvider('anthropic')])
    expect(screen.getByText(t('settings.ai.model.managedDescription'))).toBeTruthy()
    expect(screen.getByTestId('ai-model-claude-opus-5-5').textContent).toMatch(/credit/i)
  })
})
