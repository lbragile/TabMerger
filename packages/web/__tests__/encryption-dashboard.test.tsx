import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroupGrid } from '@/components/dashboard/GroupGrid'
import { EncryptionKeyProvider, useEncryptionKey, clearAllCachedDataKeys } from '@/lib/encryption/context'

const mockGetUser = vi.fn(async () => ({ data: { user: { id: 'u1' } } }))
const mockMaybeSingle = vi.fn(async () => ({ data: { user_id: 'u1', salt: 'AAAA', wrapped_key: 'wk', wrap_iv: 'iv', kdf_iterations: 1000 } }))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  }),
}))

// deriveWrappingKey/unwrapDataKey/export/import involve real WebCrypto — stub them so
// tests don't need a real passphrase-wrapped key, just verify the unlock + cache plumbing.
vi.mock('@tabmerger/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tabmerger/shared')>()
  return {
    ...actual,
    deriveWrappingKey: vi.fn(async () => 'fake-wrapping-key' as unknown as CryptoKey),
    unwrapDataKey: vi.fn(async () => 'fake-data-key' as unknown as CryptoKey),
    exportKeyToBase64: vi.fn(async (key: unknown) => `b64(${key})`),
    importKeyFromBase64: vi.fn(async (b64: string) => b64.replace(/^b64\(/, '').replace(/\)$/, '') as unknown as CryptoKey),
    decryptBlob: vi.fn(async (_key: unknown, blob: unknown) => {
      // In this test the "ciphertext" is a plain object we stashed the plaintext into.
      return (blob as { __plain: unknown }).__plain
    }),
  }
})

const encryptedGroup = {
  id: 'g1',
  name: '',
  color: 'rgba(0,180,204,1)',
  windows: { v: 1, iv: 'iv', ct: 'ct', __plain: { name: 'Work', windows: [{ tabs: [{ title: 'Secret Tab', url: 'https://example.com' }] }] } },
  updated_at: new Date().toISOString(),
}

describe('GroupGrid + encryption', () => {
  beforeEach(() => {
    mockGetUser.mockClear()
    mockMaybeSingle.mockClear()
  })

  it('renders plaintext groups unaffected when nothing is encrypted', () => {
    const plainGroup = {
      id: 'g1',
      name: 'Work',
      color: 'rgba(0,180,204,1)',
      windows: [{ tabs: [{ title: 'Tab 1', url: 'https://example.com' }] }],
      updated_at: new Date().toISOString(),
    }
    render(
      <EncryptionKeyProvider>
        <GroupGrid groups={[plainGroup]} isPro={false} />
      </EncryptionKeyProvider>
    )
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('shows a passphrase prompt instead of the grid when a group is encrypted and locked', async () => {
    render(
      <EncryptionKeyProvider>
        <GroupGrid groups={[encryptedGroup as never]} isPro={false} />
      </EncryptionKeyProvider>
    )
    expect(await screen.findByLabelText('Encryption passphrase')).toBeInTheDocument()
    expect(screen.queryByText('Secret Tab')).not.toBeInTheDocument()
  })

  it('decrypts and renders the group content after a correct passphrase unlocks the session key', async () => {
    render(
      <EncryptionKeyProvider>
        <GroupGrid groups={[encryptedGroup as never]} isPro={false} />
      </EncryptionKeyProvider>
    )
    const input = await screen.findByLabelText('Encryption passphrase')
    fireEvent.change(input, { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(screen.getByText('Work')).toBeInTheDocument())
  })
})

function Probe() {
  const { status } = useEncryptionKey()
  return <span>status:{status}</span>
}

describe('EncryptionKeyProvider', () => {
  it('resolves to "locked" once it finds an encryption_keys row for the signed-in user', async () => {
    render(
      <EncryptionKeyProvider>
        <Probe />
      </EncryptionKeyProvider>
    )
    await waitFor(() => expect(screen.getByText('status:locked')).toBeInTheDocument())
  })

  it('resolves to "no-key" when the user has no encryption_keys row (never sets up encryption)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null })
    render(
      <EncryptionKeyProvider>
        <Probe />
      </EncryptionKeyProvider>
    )
    await waitFor(() => expect(screen.getByText('status:no-key')).toBeInTheDocument())
  })
})
