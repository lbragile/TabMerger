import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { AUTO_ITEM_COLORS } from '@tabmerger/shared'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { SaveSessionModal } from '@/components/Modal/SaveSession'

function renderModal(onSave = vi.fn(), onClose = vi.fn()) {
  render(
    <Dialog open>
      <DialogContent>
        <SaveSessionModal data={{ onSave }} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
  return { onSave, onClose }
}

describe('SaveSessionModal', () => {
  it('replaces window.prompt — renders a name input with Cancel/Save actions', () => {
    renderModal()
    expect(screen.getByLabelText(/session name/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy()
  })

  it('shows a validation error and does not call onSave when the name is empty', () => {
    const { onSave, onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(screen.getByText(/session name is required/i)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onSave with the trimmed name and undefined description and closes on submit', () => {
    const { onSave, onClose } = renderModal()
    fireEvent.change(screen.getByLabelText(/session name/i), { target: { value: '  My Session  ' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('My Session', undefined, undefined)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders an optional description field and passes the trimmed value through on save', () => {
    const { onSave } = renderModal()
    fireEvent.change(screen.getByLabelText(/session name/i), { target: { value: 'My Session' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: '  Weekend reading  ' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('My Session', 'Weekend reading', undefined)
  })

  it('does not require a description to save', () => {
    const { onSave, onClose } = renderModal()
    fireEvent.change(screen.getByLabelText(/session name/i), { target: { value: 'My Session' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('My Session', undefined, undefined)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onSave when Cancel is clicked', () => {
    const { onSave, onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('offers a Color radio group: Random is checked by default and saves no colour (the caller picks one)', () => {
    const { onSave } = renderModal()
    const group = screen.getByRole('radiogroup', { name: 'Color' })
    const radios = within(group).getAllByRole('radio')
    // Random + the ten palette colours, each named
    expect(radios).toHaveLength(1 + AUTO_ITEM_COLORS.length)
    expect(within(group).getByRole('radio', { name: 'Random' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Teal' })).not.toBeChecked()
    fireEvent.change(screen.getByLabelText(/session name/i), { target: { value: 'Work' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('Work', undefined, undefined)
  })

  it('saves the picked palette colour', () => {
    const { onSave } = renderModal()
    const blue = screen.getByRole('radio', { name: 'Blue' })
    fireEvent.click(blue)
    expect(blue).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Random' })).not.toBeChecked()
    fireEvent.change(screen.getByLabelText(/session name/i), { target: { value: 'Work' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('Work', undefined, AUTO_ITEM_COLORS[5])
  })

  it('writes the chosen (or focused) colour by name, and marks the chosen swatch with a check and a 2px ring', () => {
    renderModal()
    const name = screen.getByTestId('session-color-name')
    expect(name).toHaveTextContent('Random')
    const yellow = screen.getByRole('radio', { name: 'Yellow' })
    fireEvent.focus(yellow)
    expect(name).toHaveTextContent('Yellow')
    fireEvent.blur(yellow)
    fireEvent.click(screen.getByRole('radio', { name: 'Teal' }))
    expect(name).toHaveTextContent('Teal')
    const swatch = screen.getByRole('radio', { name: 'Teal' }).nextElementSibling as HTMLElement
    expect(swatch.className).toContain('ring-2')
    // a border that reaches 3:1 on the dialog, on every swatch
    expect(swatch.className).toContain('border-foreground/50')
    // the check is drawn black on a light colour like teal
    expect(swatch.querySelector('svg')?.getAttribute('style')).toContain('rgb(0, 0, 0)')
    const other = screen.getByRole('radio', { name: 'Blue' }).nextElementSibling as HTMLElement
    expect(other.querySelector('svg')).toBeNull()
  })
})
