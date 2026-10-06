import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EncryptionSetupModal } from '@/components/Modal/EncryptionSetup'
import { toast } from '@/lib/toast'

function renderModal(onClose = vi.fn()) {
  return render(
    <Dialog open>
      <DialogContent>
        <EncryptionSetupModal onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

const { mockGetEncryptionKeyState, mockSetupEncryption, mockUnlockEncryption } = vi.hoisted(() => ({
  mockGetEncryptionKeyState: vi.fn(),
  mockSetupEncryption: vi.fn().mockResolvedValue(undefined),
  mockUnlockEncryption: vi.fn().mockResolvedValue('unlocked'),
}))

vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: mockGetEncryptionKeyState,
  ENCRYPTION_ALREADY_SET_UP_MESSAGE: 'Encryption is already set up for this account.',
  setupEncryption: mockSetupEncryption,
  unlockEncryption: mockUnlockEncryption,
}))

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))

describe('EncryptionSetupModal — self-detects setup vs unlock mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetupEncryption.mockResolvedValue(undefined)
    mockUnlockEncryption.mockResolvedValue('unlocked')
  })

  it('shows the two-field setup form when no encryption_keys row exists yet', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('absent')
    renderModal()
    expect(await screen.findByRole('heading', { name: 'Set up encryption' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('New passphrase')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Confirm passphrase')).toBeInTheDocument()
  })

  it('shows a single-field unlock form (no confirm) when a key exists but this device has not unlocked it', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    renderModal()
    expect(await screen.findByText('Unlock encryption')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Passphrase')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Confirm passphrase')).toBeNull()
    expect(screen.queryByPlaceholderText('New passphrase')).toBeNull()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled()
  })

  it('calls unlockEncryption and closes on success in unlock mode', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'my passphrase')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(mockUnlockEncryption).toHaveBeenCalledWith('my passphrase'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('unlocks when Enter is pressed in the passphrase field', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'my passphrase{Enter}')
    await waitFor(() => expect(mockUnlockEncryption).toHaveBeenCalledWith('my passphrase'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Encryption unlocked')
  })

  it('does not submit an empty passphrase on Enter', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    const user = userEvent.setup()
    renderModal()
    await user.type(await screen.findByPlaceholderText('Passphrase'), '{Enter}')
    expect(mockUnlockEncryption).not.toHaveBeenCalled()
  })

  it('shows a spinner on the Unlock button while busy', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    let resolveUnlock!: (v: string) => void
    mockUnlockEncryption.mockReturnValueOnce(new Promise((resolve) => { resolveUnlock = resolve }))
    const user = userEvent.setup()
    renderModal()
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'my passphrase')
    const button = screen.getByRole('button', { name: 'Unlock' })
    await user.click(button)
    expect(button).toBeDisabled()
    expect(button.querySelector('svg')).toBeInTheDocument()
    resolveUnlock('unlocked')
  })

  it('offers a retry, never the setup form, when the encryption status could not be checked', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('unknown')
    renderModal()
    expect(await screen.findByRole('heading', { name: /can.t check encryption right now/i })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('New passphrase')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set up encryption' })).toBeNull()
    expect(mockSetupEncryption).not.toHaveBeenCalled()
  })

  it('"Try again" re-checks and shows the unlock form once the server answers that a key exists', async () => {
    mockGetEncryptionKeyState.mockResolvedValueOnce('unknown').mockResolvedValue('present')
    const user = userEvent.setup()
    renderModal()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Unlock encryption')).toBeInTheDocument()
    expect(mockGetEncryptionKeyState).toHaveBeenCalledTimes(2)
    expect(screen.queryByPlaceholderText('New passphrase')).toBeNull()
  })

  it('switches to the unlock form when the server refuses a second key (set up elsewhere meanwhile)', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('absent')
    mockSetupEncryption.mockRejectedValueOnce(new Error('Encryption is already set up for this account.'))
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)
    await user.type(await screen.findByPlaceholderText('New passphrase'), 'passphrase-1')
    await user.type(screen.getByPlaceholderText('Confirm passphrase'), 'passphrase-1')
    await user.click(screen.getByRole('button', { name: 'Set up encryption' }))
    expect(await screen.findByText('Unlock encryption')).toBeInTheDocument()
    expect(screen.getByText('Encryption is already set up for this account.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Passphrase')).toHaveValue('')
    expect(screen.queryByPlaceholderText('Confirm passphrase')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does NOT say "Wrong passphrase" when the unlock request failed (offline): it shows the retry view and keeps the modal open', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockUnlockEncryption.mockResolvedValueOnce('unavailable')
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'my passphrase')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('heading', { name: /can.t check encryption right now/i })).toBeInTheDocument()
    expect(screen.queryByText('Wrong passphrase')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('switches to first-time setup when the key no longer exists on the server (reset from another device)', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockUnlockEncryption.mockResolvedValueOnce('no-key')
    const user = userEvent.setup()
    renderModal()
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'my passphrase')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('heading', { name: 'Set up encryption' })).toBeInTheDocument()
    expect(screen.queryByText('Wrong passphrase')).toBeNull()
  })

  it('shows a wrong-passphrase error without closing when the passphrase does not unwrap the key', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockUnlockEncryption.mockResolvedValueOnce('wrong-passphrase')
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal(onClose)
    await user.type(await screen.findByPlaceholderText('Passphrase'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('Wrong passphrase')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
