import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    expect(onSave).toHaveBeenCalledWith('My Session', undefined)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders an optional description field and passes the trimmed value through on save', () => {
    const { onSave } = renderModal()
    fireEvent.change(screen.getByLabelText(/session name/i), { target: { value: 'My Session' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: '  Weekend reading  ' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('My Session', 'Weekend reading')
  })

  it('does not require a description to save', () => {
    const { onSave, onClose } = renderModal()
    fireEvent.change(screen.getByLabelText(/session name/i), { target: { value: 'My Session' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('My Session', undefined)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onSave when Cancel is clicked', () => {
    const { onSave, onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
