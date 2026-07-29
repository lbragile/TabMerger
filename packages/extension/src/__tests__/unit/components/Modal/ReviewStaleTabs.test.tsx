import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ReviewStaleTabsModal } from '@/components/Modal/ReviewStaleTabs'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

describe('ReviewStaleTabsModal', () => {
  it('lists the stale tabs and pluralizes correctly', () => {
    const staleTabs = [
      { id: 1, title: 'Stale A', url: 'https://a.com' },
      { id: 2, title: 'Stale B', url: 'https://b.com' },
    ]
    renderModal(<ReviewStaleTabsModal data={{ staleTabs, onRemoveAll: vi.fn() }} onClose={vi.fn()} />)
    expect(screen.getByText('Stale A')).toBeTruthy()
    expect(screen.getByText('Stale B')).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove 2 tabs/i })).toBeTruthy()
  })

  it('singularizes when only one stale tab', () => {
    renderModal(
      <ReviewStaleTabsModal
        data={{ staleTabs: [{ id: 1, title: 'Solo', url: 'https://a.com' }], onRemoveAll: vi.fn() }}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /remove 1 tab$/i })).toBeTruthy()
  })

  it('remove-all button invokes onRemoveAll and closes the modal', () => {
    const onRemoveAll = vi.fn()
    const onClose = vi.fn()
    renderModal(
      <ReviewStaleTabsModal
        data={{ staleTabs: [{ id: 1, title: 'A', url: 'https://a.com' }], onRemoveAll }}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /remove 1 tab$/i }))
    expect(onRemoveAll).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('close button calls onClose without removing', () => {
    const onRemoveAll = vi.fn()
    const onClose = vi.fn()
    renderModal(
      <ReviewStaleTabsModal data={{ staleTabs: [], onRemoveAll }} onClose={onClose} />
    )
    // Radix's DialogContent also renders an "X" close button with the same accessible
    // name ("Close"), rendered after our footer button — grab the first match (ours).
    const closeButtons = screen.getAllByRole('button', { name: 'Close' })
    fireEvent.click(closeButtons[0])
    expect(onRemoveAll).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
