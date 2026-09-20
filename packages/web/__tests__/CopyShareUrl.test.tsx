import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { CopyShareUrl } from '@/components/CopyShareUrl'

function setHash(hash: string) {
  window.location.hash = hash
}

describe('CopyShareUrl', () => {
  afterEach(() => {
    setHash('')
  })

  it('appends the current location hash (decryption key) to the displayed/copied url', async () => {
    setHash('#key=super-secret')
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })

    render(<CopyShareUrl url="https://tabmerger.app/share/abc123" />)

    expect(screen.getByText('https://tabmerger.app/share/abc123#key=super-secret')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://tabmerger.app/share/abc123#key=super-secret'
    )
  })

  it('renders the plain url when there is no fragment', () => {
    render(<CopyShareUrl url="https://tabmerger.app/share/abc123" />)
    expect(screen.getByText('https://tabmerger.app/share/abc123')).toBeInTheDocument()
  })
})
