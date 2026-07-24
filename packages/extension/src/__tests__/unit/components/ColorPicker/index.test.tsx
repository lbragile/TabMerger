import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ColorPicker } from '@/components/ColorPicker'
import { PRESET_COLORS } from '@/lib/types'

describe('ColorPicker', () => {
  it('renders a swatch button for every preset color', () => {
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} />)
    const swatches = screen.getAllByTitle(/rgba?\(/i)
    expect(swatches.length).toBeGreaterThanOrEqual(PRESET_COLORS.length)
  })

  it('calls onChange with the preset color when a swatch is clicked', () => {
    const onChange = vi.fn()
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={onChange} />)
    fireEvent.click(screen.getByTitle(PRESET_COLORS[1]))
    expect(onChange).toHaveBeenCalledWith(PRESET_COLORS[1])
  })

  it('converts a valid hex input to rgba on blur', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    const input = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(input, { target: { value: '#ff0000' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith('rgba(255, 0, 0, 1)')
  })

  it('converts a valid hex input to rgba on Enter key', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    const input = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(input, { target: { value: '#00ff00' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('rgba(0, 255, 0, 1)')
  })

  it('resets hex input to current value when blurred with invalid hex', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(10, 20, 30, 1)" onChange={onChange} />)
    const input = screen.getByPlaceholderText('#rrggbb') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'not-a-color' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('#0a141e')
  })

  it('accepts shorthand 3-digit hex', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    const input = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(input, { target: { value: '#f00' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith('rgba(255, 0, 0, 1)')
  })
})
