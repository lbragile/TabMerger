import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ConfirmPreviewImagesModal } from '@/components/Modal/ConfirmPreviewImages'

function renderModal(onConfirm = vi.fn(), onClose = vi.fn()) {
  render(
    <Dialog open>
      <DialogContent>
        <ConfirmPreviewImagesModal data={{ onConfirm }} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
  return { onConfirm, onClose }
}

beforeEach(() => {
  vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.example')
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
})

describe('ConfirmPreviewImagesModal', () => {
  it('renders a title, explanation, and a link to the privacy policy page-previews anchor', () => {
    renderModal()
    expect(screen.getByRole('heading', { name: /turn on page images/i })).toBeTruthy()
    expect(screen.getByText(/isn't linked to your account, logged, or stored/i)).toBeTruthy()
    const link = screen.getByRole('link', { name: /privacy policy/i })
    expect(link).toHaveAttribute('href', 'https://tabmerger.example/privacy#page-previews')
  })

  it('does not call onConfirm when Cancel is clicked, and closes', async () => {
    const user = userEvent.setup()
    const { onConfirm, onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onConfirm and closes when Turn on is clicked', async () => {
    const user = userEvent.setup()
    const { onConfirm, onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: /turn on/i }))
    expect(onConfirm).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the privacy link via chrome.tabs.create instead of in-page navigation', async () => {
    const user = userEvent.setup()
    renderModal()
    const link = screen.getByRole('link', { name: /privacy policy/i })
    await user.click(link)
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://tabmerger.example/privacy#page-previews',
      active: true,
    })
  })
})
