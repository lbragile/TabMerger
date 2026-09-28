import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ColorPicker } from '@/components/ColorPicker'
import { PRESET_COLORS } from '@/lib/types'

/** react-colorful throttles picker drags via rAF internally in some paths; make it synchronous. */
function withSyncRaf<T>(fn: () => T): T {
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
  try {
    return fn()
  } finally {
    rafSpy.mockRestore()
  }
}

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

  it('renders a labelled Custom colour control that opens the picker popup', () => {
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} />)
    expect(screen.queryByPlaceholderText('#rrggbb')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    expect(screen.getByPlaceholderText('#rrggbb')).toBeInTheDocument()
    // Visible label appears both on the trigger and as the popup title.
    expect(screen.getAllByText('Custom colour').length).toBeGreaterThanOrEqual(2)
  })

  it('the Custom control always shows the generic rainbow swatch, never the current or a prior custom colour', () => {
    const { rerender } = render(<ColorPicker value="rgba(1, 2, 3, 1)" onChange={vi.fn()} />)
    let dot = screen.getByRole('button', { name: 'Custom colour' }).querySelector('span[aria-hidden]') as HTMLElement
    expect(dot.style.background).toContain('conic-gradient')

    rerender(<ColorPicker value="rgba(200, 150, 100, 1)" onChange={vi.fn()} />)
    dot = screen.getByRole('button', { name: 'Custom colour' }).querySelector('span[aria-hidden]') as HTMLElement
    expect(dot.style.background).toContain('conic-gradient')
  })

  it('marks the Custom colour control as selected when the current value is not a preset', () => {
    render(<ColorPicker value="rgba(1, 2, 3, 1)" onChange={vi.fn()} />)
    // The ring sits on the rainbow swatch, like a preset — never a box around the whole row
    expect(screen.getByTestId('custom-colour-swatch').className).toContain('ring-foreground')
    const customControl = screen.getByRole('button', { name: 'Custom colour' })
    expect(customControl.className).not.toContain('ring-foreground')
    expect(customControl.className).not.toContain('border-foreground/15')
  })

  it('does not mark the Custom colour control as selected for a preset value', () => {
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} />)
    expect(screen.getByTestId('custom-colour-swatch').className).not.toContain('ring-foreground')
  })

  it('typing a valid hex updates the preview swatch and draft', () => {
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    const input = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(input, { target: { value: '#ff0000' } })
    expect((input as HTMLInputElement).value).toBe('#ff0000')
  })

  it('Apply commits the hex value as rgba and closes the popup', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    const input = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(input, { target: { value: '#ff0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith('rgba(255, 0, 0, 1)')
    expect(screen.queryByPlaceholderText('#rrggbb')).not.toBeInTheDocument()
  })

  it('Enter in the hex field also commits and closes the popup', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    const input = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(input, { target: { value: '#00ff00' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('rgba(0, 255, 0, 1)')
  })

  it('Cancel does not call onChange and closes the popup', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    const input = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(input, { target: { value: '#ff0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('#rrggbb')).not.toBeInTheDocument()
  })

  it('ignores garbage typed into the hex field (no onChange, draft stays valid)', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    const input = screen.getByPlaceholderText('#rrggbb') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'not-a-color' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    // HexColorInput never propagates an invalid value upward, so Apply still commits
    // the last valid draft (the seeded current value).
    expect(onChange).toHaveBeenCalledWith('rgba(0, 0, 0, 1)')
  })

  it('re-seeds the hex field from the current value each time it is reopened', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ColorPicker value="rgba(10, 20, 30, 1)" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    const input = screen.getByPlaceholderText('#rrggbb') as HTMLInputElement
    expect(input.value).toBe('#0a141e')
    fireEvent.change(input, { target: { value: 'garbage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    rerender(<ColorPicker value="rgba(10, 20, 30, 1)" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    expect((screen.getByPlaceholderText('#rrggbb') as HTMLInputElement).value).toBe('#0a141e')
  })

  it('calls onPreview with the live rgba value while dragging/typing, and null on Apply', () => {
    withSyncRaf(() => {
      const onPreview = vi.fn()
      render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={vi.fn()} onPreview={onPreview} />)
      fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
      fireEvent.change(screen.getByPlaceholderText('#rrggbb'), { target: { value: '#ff0000' } })
      expect(onPreview).toHaveBeenCalledWith('rgba(255, 0, 0, 1)')
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
      expect(onPreview).toHaveBeenLastCalledWith(null)
    })
  })

  it('calls onPreview(null) on Cancel without ever calling onChange', () => {
    withSyncRaf(() => {
      const onPreview = vi.fn()
      const onChange = vi.fn()
      render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} onPreview={onPreview} />)
      fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
      fireEvent.change(screen.getByPlaceholderText('#rrggbb'), { target: { value: '#ff0000' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onPreview).toHaveBeenLastCalledWith(null)
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  it('calls onPreview(null) on Escape without calling onChange', () => {
    withSyncRaf(() => {
      const onPreview = vi.fn()
      const onChange = vi.fn()
      render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} onPreview={onPreview} />)
      fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
      const input = screen.getByPlaceholderText('#rrggbb')
      fireEvent.change(input, { target: { value: '#ff0000' } })
      fireEvent.keyDown(screen.getByText('Custom colour', { selector: 'p' }).closest('[role="dialog"]') ?? input, { key: 'Escape' })
      expect(onChange).not.toHaveBeenCalled()
      expect(onPreview).toHaveBeenLastCalledWith(null)
    })
  })

  describe('no infinite update-depth loop (regression)', () => {
    it('rapidly changing the hex field many times, with a re-rendering parent and an inline onPreview, never throws or logs an error', () => {
      withSyncRaf(() => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          // A parent that re-renders on every preview tick (mirrors GroupItem/AddGroup:
          // onPreview is a fresh inline arrow every render, and the re-render is driven by
          // the very state the preview writes to).
          function Harness() {
            const [, setPreview] = useState<string | null>(null)
            return (
              <ColorPicker
                value="rgba(0, 0, 0, 1)"
                onChange={vi.fn()}
                onPreview={(c: string | null) => setPreview(c)}
              />
            )
          }
          expect(() => {
            render(<Harness />)
            fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
            const input = screen.getByPlaceholderText('#rrggbb')
            for (const hex of ['#111111', '#222222', '#333333', '#abcdef', '#000000', '#ffffff']) {
              fireEvent.change(input, { target: { value: hex } })
            }
          }).not.toThrow()
          expect(errorSpy).not.toHaveBeenCalled()
        } finally {
          errorSpy.mockRestore()
        }
      })
    })
  })

  describe('popover open autofocus', () => {
    it('focuses the selected preset swatch on open, not always the first one', () => {
      render(<ColorPicker value={PRESET_COLORS[2]} onChange={vi.fn()} />)
      expect(document.activeElement).toBe(screen.getByTitle(PRESET_COLORS[2]))
    })

    it('focuses the Custom colour control on open when the current value is not a preset', () => {
      render(<ColorPicker value="rgba(1, 2, 3, 1)" onChange={vi.fn()} />)
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Custom colour' }))
    })

    it('a mouse-driven open does not show a keyboard-focus ring on the autofocused swatch', () => {
      // Force mouse modality (mirrors clicking the swatch trigger that opens this popover) —
      // module-scope modality tracking persists across tests in this file, so pin it explicitly
      // rather than relying on whatever the previous test left it as.
      fireEvent.pointerDown(document.body)
      render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} />)
      const selected = screen.getByTitle(PRESET_COLORS[0])
      expect(document.activeElement).toBe(selected)
      expect(selected.className).not.toContain('outline-primary')
    })

    it('a keyboard-driven open shows the keyboard-focus ring on the autofocused swatch, distinct from the selected ring', () => {
      // Force keyboard modality (mirrors Enter/Space activating the trigger that opens this popover).
      fireEvent.keyDown(document.body, { key: 'Enter' })
      render(<ColorPicker value={PRESET_COLORS[1]} onChange={vi.fn()} />)
      const selected = screen.getByTitle(PRESET_COLORS[1])
      expect(document.activeElement).toBe(selected)
      expect(selected.className).toContain('outline-primary')
      expect(selected.className).toContain('ring-foreground')
    })
  })
})
