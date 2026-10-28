import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AI_PROVIDERS, AI_PROVIDER_LABELS, type AiProvider } from '@tabmerger/shared'
import { AiProviderPicker } from '@/components/Settings/AiProviderPicker'
import { AI_SELECT_TRIGGER_CLASS, AI_SELECT_WIDTH } from '@/components/Settings/settingsControls'
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

  it('has the one fixed Settings → AI width (12rem), whatever it shows, and cuts a long value with an ellipsis', () => {
    renderPicker(null)
    const placeholderClasses = trigger().className
    for (const c of AI_SELECT_TRIGGER_CLASS.split(' ')) expect(placeholderClasses.split(/\s+/)).toContain(c)
    expect(placeholderClasses.split(/\s+/).filter((c) => /^(min-|max-)?w-/.test(c))).toEqual([AI_SELECT_WIDTH])
    expect(AI_SELECT_WIDTH).toBe('w-48')
    // the shared trigger's line clamp gives way to truncate, which draws the ellipsis
    expect(placeholderClasses).toContain('[&>span]:truncate')
    expect(placeholderClasses).not.toContain('[&>span]:line-clamp-1')
  })

  it('keeps the full text in the trigger’s title: the placeholder, then the picked provider', () => {
    const { unmount } = render(React.createElement(AiProviderPicker, { value: null, onChange: vi.fn() }))
    expect(trigger().getAttribute('title')).toBe(t('settings.ai.provider.placeholder'))
    unmount()
    renderPicker('google')
    expect(trigger().getAttribute('title')).toBe('Gemini')
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
