/**
 * Tests the client-side decrypt path of ShareBundleContent — reading the
 * per-share key from `location.hash`, decrypting the {v:1,iv,ct} snapshot,
 * and the error state when the key is missing or wrong. Also asserts the
 * fragment/key is never forwarded to any server request (og-preview fetch).
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { generateDataKey, encryptBlob, exportKeyToBase64 } from '@tabmerger/shared'
import { ShareBundleContent } from '@/components/ShareBundleContent'

const GROUPS = [
  {
    id: 'g1',
    name: 'Secret Project',
    color: 'rgba(0,0,0,1)',
    windows: [
      { id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Confidential Tab', url: 'https://internal.example' }] },
    ],
  },
]

function setHash(hash: string) {
  window.location.hash = hash
}

describe('ShareBundleContent — encrypted snapshot decrypt path', () => {
  beforeEach(() => {
    setHash('')
  })

  afterEach(() => {
    setHash('')
    vi.restoreAllMocks()
  })

  it('decrypts and renders group content when the correct key is in the URL fragment', async () => {
    const dataKey = await generateDataKey()
    const encrypted = await encryptBlob(dataKey, GROUPS)
    const keyB64 = await exportKeyToBase64(dataKey)
    setHash(`#key=${keyB64}`)

    render(<ShareBundleContent bundle={{ slug: 's1', expiresAt: null, groups: { v: 1, ...encrypted } }} />)

    expect(screen.getByText(/decrypting/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Secret Project')).toBeInTheDocument())
    expect(screen.getByText('Confidential Tab')).toBeInTheDocument()
  })

  it('shows an error state when the URL fragment has no key', async () => {
    const dataKey = await generateDataKey()
    const encrypted = await encryptBlob(dataKey, GROUPS)
    setHash('') // no key at all — e.g. link shared without the fragment

    render(<ShareBundleContent bundle={{ slug: 's1', expiresAt: null, groups: { v: 1, ...encrypted } }} />)

    await waitFor(() => expect(screen.getByText(/can't decrypt/i)).toBeInTheDocument())
  })

  it('shows an error state when the key is wrong (GCM auth tag fails)', async () => {
    const dataKey = await generateDataKey()
    const encrypted = await encryptBlob(dataKey, GROUPS)
    const wrongKey = await generateDataKey()
    const wrongKeyB64 = await exportKeyToBase64(wrongKey)
    setHash(`#key=${wrongKeyB64}`)

    render(<ShareBundleContent bundle={{ slug: 's1', expiresAt: null, groups: { v: 1, ...encrypted } }} />)

    await waitFor(() => expect(screen.getByText(/can't decrypt/i)).toBeInTheDocument())
  })

  it('still renders legacy plaintext bundles (array shape) without a decrypting state', () => {
    render(<ShareBundleContent bundle={{ slug: 's1', expiresAt: null, groups: GROUPS }} />)
    expect(screen.queryByText(/decrypting/i)).not.toBeInTheDocument()
    expect(screen.getByText('Secret Project')).toBeInTheDocument()
  })

  it('never sends location.hash or the key to any fetch call', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ogImage: null }), { status: 200 })
    )

    const dataKey = await generateDataKey()
    const encrypted = await encryptBlob(dataKey, GROUPS)
    const keyB64 = await exportKeyToBase64(dataKey)
    setHash(`#key=${keyB64}`)

    render(<ShareBundleContent bundle={{ slug: 's1', expiresAt: null, groups: { v: 1, ...encrypted } }} />)
    await waitFor(() => expect(screen.getByText('Secret Project')).toBeInTheDocument())

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0])
      expect(url).not.toContain(keyB64)
      expect(url).not.toContain('#key=')
    }
  })
})
