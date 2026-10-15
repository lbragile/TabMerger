import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ColorPicker } from '@/components/ColorPicker'
import { PRESET_COLORS } from '@/lib/types'

/** Tour v2 anchors inside the colour picker: the swatch grid and the Apply button. */
describe('ColorPicker tour anchors', () => {
  it('anchors the grid of swatches, holding every preset and nothing else', () => {
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} />)
    const grid = document.querySelector('[data-tour="color-swatches"]') as HTMLElement
    expect(grid).not.toBeNull()
    expect(grid.querySelectorAll('button')).toHaveLength(PRESET_COLORS.length)
    // Apply and Cancel sit outside the grid, so the ring on the swatches never includes them
    expect(grid.contains(screen.getByRole('button', { name: 'Apply' }))).toBe(false)
  })

  it('anchors Apply, and only Apply (not Cancel)', () => {
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveAttribute('data-tour', 'color-apply')
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('data-tour')
    expect(document.querySelectorAll('[data-tour="color-apply"]')).toHaveLength(1)
  })
})
