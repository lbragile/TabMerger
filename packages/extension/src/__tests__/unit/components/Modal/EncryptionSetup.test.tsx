import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EncryptionSetupModal } from '@/components/Modal/EncryptionSetup'

function renderModal(onClose = vi.fn()) {
  return render(
    <Dialog open>
      <DialogContent>
        <EncryptionSetupModal onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

const { mockHasEncryptionKey, mockSetupEncryption, mockUnlockEncryption } = vi.hoisted(() => ({
  mockHasEncryptionKey: vi.fn(),
  mockSetupEncryption: vi.fn().mockResolvedValue(undefined),
  mockUnlockEncryption: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/encryptionKey', () => ({
  hasEncryptionKey: mockHasEncryptionKey,
  setupEncryption: mockSetupEncryption,
  unlockEncryption: mockUnlockEncryption,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

describe('EncryptionSetupModal — self-detects setup vs unlock mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetupEncryption.mockResolvedValue(undefined)
    mockUnlockEncryption.mockResolvedValue(true)
  })

  it('shows the two-field setup form when no encryption_keys row exists yet', async () => {
    mockHasEncryptionKey.mockResolvedValue(false)
    renderModal()
    expect(await screen.findByRole('heading', { name: 'Set up encryption' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('New passphrase')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Confirm passphrase')).toBeInTheDocument()
  })

  it('shows the two-field unlock form (with confirm) when a key exists but this device has not unlocked it', async () => {
    mockHasEncryptionKey.mockResolvedValue(true)
    renderModal()
    expect(await screen.findByText('Unlock encryption')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Passphrase')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Confirm passphrase')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('New passphrase')).toBeNull()
  })

  it('calls unlockEncryption and closes on success in unlock mode', async () => {
    mockHasEncryptionKey.mockResolvedValue(true)
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'my passphrase')
    await user.type(screen.getByPlaceholderText('Confirm passphrase'), 'my passphrase')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUnlockEncryption).toHaveBeenCalledWith('my passphrase'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows a mismatch error without calling unlockEncryption when the two fields differ', async () => {
    mockHasEncryptionKey.mockResolvedValue(true)
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'one')
    await user.type(screen.getByPlaceholderText('Confirm passphrase'), 'two')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Passphrases do not match')).toBeInTheDocument()
    expect(mockUnlockEncryption).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a spinner on the Save button while busy', async () => {
    mockHasEncryptionKey.mockResolvedValue(true)
    let resolveUnlock!: (v: boolean) => void
    mockUnlockEncryption.mockReturnValueOnce(new Promise((resolve) => { resolveUnlock = resolve }))
    const user = userEvent.setup()
    renderModal()
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'my passphrase')
    await user.type(screen.getByPlaceholderText('Confirm passphrase'), 'my passphrase')
    const button = screen.getByRole('button', { name: 'Save' })
    await user.click(button)
    expect(button).toBeDisabled()
    expect(button.querySelector('svg')).toBeInTheDocument()
    resolveUnlock(true)
  })

  it('shows a wrong-passphrase error without closing when unlockEncryption returns false', async () => {
    mockHasEncryptionKey.mockResolvedValue(true)
    mockUnlockEncryption.mockResolvedValueOnce(false)
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'wrong')
    await user.type(screen.getByPlaceholderText('Confirm passphrase'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Wrong passphrase')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
