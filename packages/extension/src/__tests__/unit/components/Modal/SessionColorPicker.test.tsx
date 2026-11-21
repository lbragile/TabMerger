import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { AUTO_ITEM_COLORS } from '@tabmerger/shared'
import { RANDOM_SESSION_COLOR, SessionColorPicker } from '@/components/Modal/SessionColorPicker'

/**
 * The Color row's layout classes. jsdom has no layout, so the one-row guarantee itself is measured
 * in the e2e spec (sessionColorPickerRow.spec.ts); this pins the classes that make it fit: Random
 * plus the ten swatches need ~390px of the dialog's 398px only with `gap-1.5` and the `px-1` chip.
 */
describe('SessionColorPicker layout', () => {
  it('lays the radiogroup out as one row: tight gap, centred items, wrap only as a safety net', () => {
    render(<SessionColorPicker value={RANDOM_SESSION_COLOR} onChange={vi.fn()} />)
    const group = screen.getByRole('radiogroup', { name: 'Color' })
    expect(group).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-1.5')
    // the old 8px gap pushed the last swatch onto a second line
    expect(group).not.toHaveClass('gap-2')
  })

  it('renders all 11 radios in order: Random first, then every palette colour (none dropped)', () => {
    render(<SessionColorPicker value={RANDOM_SESSION_COLOR} onChange={vi.fn()} />)
    const radios = within(screen.getByRole('radiogroup', { name: 'Color' })).getAllByRole('radio')
    expect(radios).toHaveLength(11)
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([RANDOM_SESSION_COLOR, ...AUTO_ITEM_COLORS])
  })

  it('keeps the Random chip tight (px-1) so long labels such as "Случайный" still fit the row', () => {
    render(<SessionColorPicker value={RANDOM_SESSION_COLOR} onChange={vi.fn()} />)
    const chip = screen.getByRole('radio', { name: 'Random' }).nextElementSibling as HTMLElement
    expect(chip).toHaveClass('h-6', 'px-1')
    expect(chip).not.toHaveClass('px-2')
  })

  it('keeps the swatches at 24px so they meet the 24px target size', () => {
    render(<SessionColorPicker value={AUTO_ITEM_COLORS[0]} onChange={vi.fn()} />)
    const swatch = screen.getByRole('radio', { name: 'Red' }).nextElementSibling as HTMLElement
    expect(swatch).toHaveClass('h-6', 'w-6', 'ring-2', 'ring-offset-2')
  })
})
