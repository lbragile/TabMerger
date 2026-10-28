import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AI_PROVIDERS, AI_PROVIDER_LABELS, type AiProvider } from '@tabmerger/shared'
import { AiProviderPicker } from '@/components/Settings/AiProviderPicker'
import { AI_SELECT_TRIGGER_CLASS } from '@/components/Settings/settingsControls'
import { t } from '@/lib/i18n'

beforeAll(() => {
  // Radix Select needs these in jsdom
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

function renderPicker(value: AiProvider | null, onChange = vi.fn()) {
  const ref = React.createRef<HTMLButtonElement>()
  render(React.createElement(AiProviderPicker, { ref, value, onChange }))
  return { onChange, ref }
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 })
const trigger = () => screen.getByRole('combobox', { name: t('settings.ai.provider.label') })

describe('AiProviderPicker', () => {
  it('is a dropdown named by the "AI provider" heading, described by its hint, showing the placeholder until a pick', () => {
    const { ref } = renderPicker(null)
    const select = trigger()
    expect(ref.current).toBe(select)
    const heading = screen.getByText(t('settings.ai.provider.label'))
    expect(select.getAttribute('aria-labelledby')).toBe(heading.id)
    const hint = screen.getByText(t('settings.ai.provider.description'))
    expect(select.getAttribute('aria-describedby')).toBe(hint.id)
    expect(select.textContent).toBe(t('settings.ai.provider.placeholder'))
    expect(t('settings.ai.provider.placeholder')).toBe('Choose a provider')
    // Radix marks the placeholder state, which the trigger mutes
    expect(select.hasAttribute('data-placeholder')).toBe(true)
    expect(select.className).toContain('data-[placeholder]:text-muted-foreground')
  })

  it('sizes to its value like the other Settings → AI dropdown, never under the 8rem General width', () => {
    renderPicker('anthropic')
    for (const c of AI_SELECT_TRIGGER_CLASS.split(' ')) expect(trigger().className.split(/\s+/)).toContain(c)
    expect(trigger().className).toMatch(/\bmin-w-32\b/)
    expect(trigger().className).toMatch(/\bw-auto\b/)
  })

  it('lists every provider in order and shows the given one', async () => {
    renderPicker('openai')
    expect(trigger().textContent).toBe('OpenAI')
    expect(trigger().hasAttribute('data-placeholder')).toBe(false)
    await user().click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(AI_PROVIDERS.map((p) => AI_PROVIDER_LABELS[p]))
    expect(options.map((o) => o.getAttribute('data-testid'))).toEqual(AI_PROVIDERS.map((p) => `ai-provider-${p}`))
    expect(screen.getByRole('option', { name: 'OpenAI' }).getAttribute('aria-selected')).toBe('true')
  })

  it('reports a pick made with the mouse', async () => {
    const { onChange } = renderPicker(null)
    const u = user()
    await u.click(trigger())
    await u.click(await screen.findByRole('option', { name: 'Gemini' }))
    expect(onChange).toHaveBeenCalledWith('google')
  })

  it('works from the keyboard: open with Enter, move with the arrows, pick with Enter', async () => {
    const { onChange } = renderPicker('anthropic')
    const u = user()
    trigger().focus()
    await u.keyboard('{Enter}')
    await screen.findByRole('listbox')
    await u.keyboard('{ArrowDown}')
    await u.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('openai')
  })

  it('picking the shown provider again reports nothing', async () => {
    const { onChange } = renderPicker('google')
    const u = user()
    await u.click(trigger())
    await u.click(await screen.findByRole('option', { name: 'Gemini' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
