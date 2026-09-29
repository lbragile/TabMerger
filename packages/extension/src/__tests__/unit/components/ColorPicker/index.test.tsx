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

const hexInput = () => screen.getByRole('textbox', { name: 'Hex colour' }) as HTMLInputElement

describe('ColorPicker', () => {
  it('opens straight into the custom picker, with the preset swatches in the same panel', () => {
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} />)
    expect(hexInput()).toBeInTheDocument()
    expect(document.querySelector('.react-colorful')).toBeInTheDocument()
    for (const color of PRESET_COLORS) expect(screen.getByTitle(color)).toBeInTheDocument()
    // No separate "Custom colour" mode to switch into any more.
    expect(screen.queryByRole('button', { name: 'Custom colour' })).not.toBeInTheDocument()
  })

  it('seeds the hex field from the current value', () => {
    render(<ColorPicker value="rgba(10, 20, 30, 1)" onChange={vi.fn()} />)
    expect(hexInput().value).toBe('#0a141e')
  })

  it('clicking a swatch loads it into the draft without committing', () => {
    const onChange = vi.fn()
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={onChange} />)
    fireEvent.click(screen.getByTitle(PRESET_COLORS[1]))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTitle(PRESET_COLORS[1])).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTitle(PRESET_COLORS[0])).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('color-draft-swatch').style.backgroundColor).not.toBe('')
  })

  it('Apply after a swatch commits the exact preset string (so it stays recognised as a preset)', () => {
    const onChange = vi.fn()
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={onChange} />)
    fireEvent.click(screen.getByTitle(PRESET_COLORS[3]))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith(PRESET_COLORS[3])
  })

  it('marks the swatch matching the current value as selected, and none for a custom value', () => {
    const { unmount } = render(<ColorPicker value={PRESET_COLORS[2]} onChange={vi.fn()} />)
    expect(screen.getByTitle(PRESET_COLORS[2]).className).toContain('ring-foreground')
    unmount()

    render(<ColorPicker value="rgba(1, 2, 3, 1)" onChange={vi.fn()} />)
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
  })

  it('typing a hex that matches no preset clears the swatch selection', () => {
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} />)
    fireEvent.change(hexInput(), { target: { value: '#123456' } })
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
  })

  it('Apply commits the typed hex as rgba', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    fireEvent.change(hexInput(), { target: { value: '#ff0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith('rgba(255, 0, 0, 1)')
  })

  it('Enter in the hex field also commits', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    fireEvent.change(hexInput(), { target: { value: '#00ff00' } })
    fireEvent.keyDown(hexInput(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('rgba(0, 255, 0, 1)')
  })

  it('Cancel calls onCancel and never onChange', () => {
    const onChange = vi.fn()
    const onCancel = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} onCancel={onCancel} />)
    fireEvent.change(hexInput(), { target: { value: '#ff0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores garbage typed into the hex field (Apply commits the last valid draft)', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={onChange} />)
    fireEvent.change(hexInput(), { target: { value: 'not-a-color' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    // HexColorInput never propagates an invalid value upward.
    expect(onChange).toHaveBeenCalledWith('rgba(0, 0, 0, 1)')
  })

  it('re-seeds from the current value on each open (each mount)', () => {
    const { unmount } = render(<ColorPicker value="rgba(10, 20, 30, 1)" onChange={vi.fn()} />)
    fireEvent.change(hexInput(), { target: { value: '#ffffff' } })
    unmount()
    render(<ColorPicker value="rgba(10, 20, 30, 1)" onChange={vi.fn()} />)
    expect(hexInput().value).toBe('#0a141e')
  })

  describe('live preview', () => {
    it('previews typed hex values and clears on Apply', () => {
      withSyncRaf(() => {
        const onPreview = vi.fn()
        render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={vi.fn()} onPreview={onPreview} />)
        fireEvent.change(hexInput(), { target: { value: '#ff0000' } })
        expect(onPreview).toHaveBeenCalledWith('rgba(255, 0, 0, 1)')
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
        expect(onPreview).toHaveBeenLastCalledWith(null)
      })
    })

    it('previews a picked swatch', () => {
      withSyncRaf(() => {
        const onPreview = vi.fn()
        render(<ColorPicker value={PRESET_COLORS[0]} onChange={vi.fn()} onPreview={onPreview} />)
        fireEvent.click(screen.getByTitle(PRESET_COLORS[4]))
        expect(onPreview).toHaveBeenLastCalledWith(PRESET_COLORS[4])
      })
    })

    it('clears on Cancel', () => {
      withSyncRaf(() => {
        const onPreview = vi.fn()
        render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={vi.fn()} onPreview={onPreview} />)
        fireEvent.change(hexInput(), { target: { value: '#ff0000' } })
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(onPreview).toHaveBeenLastCalledWith(null)
      })
    })

    it('clears on unmount (the host popover closing via Escape or an outside click)', () => {
      withSyncRaf(() => {
        const onPreview = vi.fn()
        const { unmount } = render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={vi.fn()} onPreview={onPreview} />)
        fireEvent.change(hexInput(), { target: { value: '#ff0000' } })
        unmount()
        expect(onPreview).toHaveBeenLastCalledWith(null)
      })
    })

    it('a preview still queued when Apply is pressed never fires after the clear', () => {
      const callbacks: FrameRequestCallback[] = []
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        callbacks.push(cb)
        return callbacks.length
      })
      const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
      try {
        const onPreview = vi.fn()
        render(<ColorPicker value="rgba(0, 0, 0, 1)" onChange={vi.fn()} onPreview={onPreview} />)
        fireEvent.change(hexInput(), { target: { value: '#ff0000' } })
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
        expect(onPreview).toHaveBeenLastCalledWith(null)
        expect(cafSpy).toHaveBeenCalled()
      } finally {
        rafSpy.mockRestore()
        cafSpy.mockRestore()
      }
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
            for (const hex of ['#111111', '#222222', '#333333', '#abcdef', '#000000', '#ffffff']) {
              fireEvent.change(hexInput(), { target: { value: hex } })
            }
            fireEvent.click(screen.getByTitle(PRESET_COLORS[5]))
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

    it('focuses no swatch when the current value is a custom colour', () => {
      render(<ColorPicker value="rgba(1, 2, 3, 1)" onChange={vi.fn()} />)
      expect(PRESET_COLORS.map((c) => screen.getByTitle(c))).not.toContain(document.activeElement)
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
