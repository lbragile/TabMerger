import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { UPDATE_AVAILABLE_STORAGE_KEY, UPDATE_BANNER_DISMISSED_STORAGE_KEY } from '@tabmerger/shared'
import { UpdateAvailableBanner } from '@/components/UpdateAvailableBanner'

/**
 * UpdateAvailableBanner: shows a recorded update, restarts via runtime.reload, dismisses for that
 * version only, reacts to storage changes and is announced politely.
 */

let store: Map<string, unknown>
let reload: ReturnType<typeof vi.fn>
let changeListeners: ((changes: Record<string, unknown>, area: string) => void)[]

beforeEach(() => {
  store = new Map()
  reload = vi.fn()
  changeListeners = []
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '3.4.0' }), reload },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v)
        }),
        remove: vi.fn(),
      },
      onChanged: {
        addListener: (cb: (c: Record<string, unknown>, a: string) => void) => changeListeners.push(cb),
        removeListener: vi.fn(),
      },
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('UpdateAvailableBanner', () => {
  it('renders nothing without a recorded update', async () => {
    const { container } = render(<UpdateAvailableBanner />)
    await waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the version, warns the popup will close, and is a status region', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.5.0', detectedAt: 1 })
    render(<UpdateAvailableBanner />)
    const banner = await screen.findByRole('status', { name: 'Update available' })
    expect(banner).toHaveTextContent('Version 3.5.0 is ready. Restarting closes this popup.')
    expect(banner.className).toContain('min-w-0')
  })

  it('Restart to update reloads the extension', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.5.0', detectedAt: 1 })
    render(<UpdateAvailableBanner />)
    const button = await screen.findByRole('button', { name: /Restart TabMerger to update to version 3\.5\.0/ })
    expect(button).toHaveTextContent('Restart to update')
    fireEvent.click(button)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('Dismiss hides it and remembers that version', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.5.0', detectedAt: 1 })
    render(
      <>
        <UpdateAvailableBanner />
        <button type="button">after</button>
      </>
    )
    const dismiss = await screen.findByRole('button', { name: 'Dismiss the update notice for version 3.5.0' })
    dismiss.focus()
    fireEvent.click(dismiss)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(store.get(UPDATE_BANNER_DISMISSED_STORAGE_KEY)).toBe('3.5.0')
    // focus moves on to the next control instead of falling to the body
    await waitFor(() => expect(screen.getByRole('button', { name: 'after' })).toHaveFocus())
  })

  it('stays hidden for a dismissed version but comes back for a newer one', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.5.0', detectedAt: 1 })
    store.set(UPDATE_BANNER_DISMISSED_STORAGE_KEY, '3.5.0')
    render(<UpdateAvailableBanner />)
    await waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.6.0', detectedAt: 2 })
    act(() => changeListeners.forEach((cb) => cb({ [UPDATE_AVAILABLE_STORAGE_KEY]: {} }, 'local')))
    expect(await screen.findByRole('status')).toHaveTextContent('Version 3.6.0 is ready.')
  })

  it('ignores changes to other keys and other storage areas', async () => {
    render(<UpdateAvailableBanner />)
    await waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled())
    const calls = vi.mocked(chrome.storage.local.get).mock.calls.length
    act(() => {
      changeListeners.forEach((cb) => cb({ other: {} }, 'local'))
      changeListeners.forEach((cb) => cb({ [UPDATE_AVAILABLE_STORAGE_KEY]: {} }, 'sync'))
    })
    expect(vi.mocked(chrome.storage.local.get).mock.calls.length).toBe(calls)
  })
})
