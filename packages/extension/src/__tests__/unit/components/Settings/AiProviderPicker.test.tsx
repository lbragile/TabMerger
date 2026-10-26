import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AI_PROVIDERS, type AiProvider } from '@tabmerger/shared'
import { AiProviderPicker } from '@/components/Settings/AiProviderPicker'
import { t } from '@/lib/i18n'

function renderPicker(value: AiProvider | null, onChange = vi.fn()) {
  const ref = React.createRef<HTMLFieldSetElement>()
  render(React.createElement(AiProviderPicker, { ref, value, onChange }))
  return { onChange, ref }
}

describe('AiProviderPicker', () => {
  it('is a group labelled "AI provider", described by its hint, with nothing checked until a pick', () => {
    const { ref } = renderPicker(null)
    const group = screen.getByRole('group', { name: t('settings.ai.provider.label') })
    expect(ref.current).toBe(group)
    const hint = screen.getByText(t('settings.ai.provider.description'))
    expect(group.getAttribute('aria-describedby')).toBe(hint.id)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.value)).toEqual([...AI_PROVIDERS])
    expect(radios.some((r) => r.checked)).toBe(false)
  })

  it('checks the given provider and reports a new pick', async () => {
    const { onChange } = renderPicker('openai')
    expect((screen.getByRole('radio', { name: 'OpenAI' }) as HTMLInputElement).checked).toBe(true)
    await userEvent.click(screen.getByRole('radio', { name: 'Gemini' }))
    expect(onChange).toHaveBeenCalledWith('google')
  })

  it('arrow keys move the pick like any radio group', async () => {
    const { onChange } = renderPicker('anthropic')
    screen.getByRole('radio', { name: 'Anthropic' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('openai')
  })
})
