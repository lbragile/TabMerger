import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WebAppConnectBanner } from '@/components/WebAppConnectBanner'
import { WEB_APP_ACCESS_DISMISSED_KEY } from '@/lib/webAppHostAccess'

// Firefox-only "Allow TabMerger on <site>" prompt (useWebAppHostAccess + lib/webAppHostAccess):
// shown while a trusted web-bridge site isn't granted and the prompt wasn't dismissed for it.

type Listener = () => void
const originalChrome = (globalThis as { chrome?: unknown }).chrome
const OLD = 'https://tabmerger.vercel.app/*'
const NEW = 'https://tabmerger.com/*'
let granted: Set<string>
let contains: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>
let createTab: ReturnType<typeof vi.fn>
let added: Listener[]
let removed: Listener[]
let store: Record<string, unknown>

function event(list: () => Listener[]) {
  return {
    addListener: (cb: Listener) => list().push(cb),
    removeListener: vi.fn((cb: Listener) => {
      const l = list()
      const i = l.indexOf(cb)
      if (i >= 0) l.splice(i, 1)
    }),
  }
}

beforeEach(() => {
  granted = new Set()
  added = []
  removed = []
  store = {}
  contains = vi.fn(async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o)))
  request = vi.fn(async ({ origins }: { origins: string[] }) => {
    origins.forEach((o) => granted.add(o))
    return true
  })
  createTab = vi.fn(async () => ({ id: 1 }))
  ;(globalThis as { chrome?: unknown }).chrome = {
    permissions: { contains, request, onAdded: event(() => added), onRemoved: event(() => removed) },
    runtime: { getURL: (path: string) => `moz-extension://test-id${path}` },
    tabs: { create: createTab },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items)
        }),
      },
    },
  }
  vi.stubEnv('FIREFOX', 'true')
  vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.vercel.app')
  vi.stubEnv('VITE_EXTRA_WEB_APP_URLS', 'https://tabmerger.com')
})

afterEach(() => {
  vi.unstubAllEnvs()
  ;(globalThis as { chrome?: unknown }).chrome = originalChrome
})

/** Lets the mount-time permissions check settle. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

const allowButton = (name: string | RegExp = /Allow TabMerger on/) => screen.findByRole('button', { name })

describe('WebAppConnectBanner', () => {
  it('asks to allow the site an update added but Firefox did not grant', async () => {
    granted.add(OLD)
    render(<WebAppConnectBanner />)
    const button = await allowButton('Allow TabMerger on tabmerger.com')
    expect(button).toHaveTextContent('Allow')
    expect(screen.getByRole('region', { name: 'Website access' })).toBeInTheDocument()
    expect(
      screen.getByText('Allow TabMerger on tabmerger.com so the website can find it and pass your sign-in.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss website access prompt' })).toBeInTheDocument()
  })

  it('names both sites when neither is granted', async () => {
    render(<WebAppConnectBanner />)
    expect(await allowButton('Allow TabMerger on tabmerger.vercel.app and tabmerger.com')).toBeInTheDocument()
  })

  it('renders nothing when every site is granted', async () => {
    granted.add(OLD).add(NEW)
    const { container } = render(<WebAppConnectBanner />)
    await settle()
    expect(contains).toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on Chrome/Edge and never touches chrome.permissions', async () => {
    vi.stubEnv('FIREFOX', 'false')
    const { container } = render(<WebAppConnectBanner />)
    await settle()
    expect(container).toBeEmptyDOMElement()
    expect(contains).not.toHaveBeenCalled()
    expect(added).toHaveLength(0)
  })

  it('opens the site-access tab instead of asking Firefox from the popup', async () => {
    granted.add(OLD)
    render(<WebAppConnectBanner />)
    fireEvent.click(await allowButton())
    // Firefox shows no permission prompt over an open popup, so the tab asks instead.
    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledWith({ url: 'moz-extension://test-id/site-access.html' })
    expect(request).not.toHaveBeenCalled()
  })

  it('stays until the grant is seen, then hides', async () => {
    granted.add(OLD)
    render(<WebAppConnectBanner />)
    fireEvent.click(await allowButton())
    await settle()
    expect(await allowButton()).toBeInTheDocument()
    granted.add(NEW)
    await act(async () => {
      added.forEach((cb) => cb())
    })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Website access' })).not.toBeInTheDocument())
  })

  it('stays when the tab cannot be opened', async () => {
    createTab.mockRejectedValue(new Error('no tabs'))
    granted.add(OLD)
    render(<WebAppConnectBanner />)
    fireEvent.click(await allowButton())
    await settle()
    expect(await allowButton()).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('dismisses, remembers the dismissal, and stays hidden on the next open', async () => {
    granted.add(OLD)
    const { unmount } = render(<WebAppConnectBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss website access prompt' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Website access' })).not.toBeInTheDocument())
    await waitFor(() => expect(store[WEB_APP_ACCESS_DISMISSED_KEY]).toEqual([NEW]))
    expect(request).not.toHaveBeenCalled()
    unmount()
    const { container } = render(<WebAppConnectBanner />)
    await settle()
    expect(container).toBeEmptyDOMElement()
  })

  it('comes back for a site the dismissal did not cover', async () => {
    store[WEB_APP_ACCESS_DISMISSED_KEY] = [NEW]
    vi.stubEnv('VITE_EXTRA_WEB_APP_URLS', 'https://tabmerger.com,https://other.example.com')
    granted.add(OLD)
    render(<WebAppConnectBanner />)
    expect(await allowButton('Allow TabMerger on tabmerger.com and other.example.com')).toBeInTheDocument()
  })

  it('moves focus to the next control after dismissing from the keyboard', async () => {
    granted.add(OLD)
    render(
      <>
        <WebAppConnectBanner />
        <button type="button">Next control</button>
      </>
    )
    const dismiss = await screen.findByRole('button', { name: 'Dismiss website access prompt' })
    dismiss.focus()
    fireEvent.click(dismiss)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus())
  })

  it('moves focus to the next control after access is granted', async () => {
    granted.add(OLD)
    render(
      <>
        <WebAppConnectBanner />
        <button type="button">Next control</button>
      </>
    )
    const allow = await allowButton()
    allow.focus()
    fireEvent.click(allow)
    granted.add(NEW)
    await act(async () => {
      added.forEach((cb) => cb())
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus())
  })

  it('does not steal focus that already moved elsewhere', async () => {
    granted.add(OLD)
    render(
      <>
        <input aria-label="Elsewhere" />
        <WebAppConnectBanner />
        <button type="button">Next control</button>
      </>
    )
    const allow = await allowButton()
    fireEvent.click(allow)
    screen.getByLabelText('Elsewhere').focus()
    granted.add(NEW)
    await act(async () => {
      added.forEach((cb) => cb())
    })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Website access' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Elsewhere')).toHaveFocus()
  })

  it('comes back when the user revokes site access while the popup is open', async () => {
    granted.add(OLD).add(NEW)
    render(<WebAppConnectBanner />)
    await settle()
    expect(screen.queryByRole('region', { name: 'Website access' })).not.toBeInTheDocument()
    granted.delete(NEW)
    await act(async () => {
      removed.forEach((cb) => cb())
    })
    expect(await allowButton('Allow TabMerger on tabmerger.com')).toBeInTheDocument()
  })

  it('hides when access is granted outside the popup', async () => {
    granted.add(OLD)
    render(<WebAppConnectBanner />)
    await allowButton()
    granted.add(NEW)
    await act(async () => {
      added.forEach((cb) => cb())
    })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Website access' })).not.toBeInTheDocument())
  })

  it('removes its permission listeners on unmount and ignores a check that finishes later', async () => {
    let resolve!: (v: boolean) => void
    contains.mockImplementation(() => new Promise<boolean>((r) => (resolve = r)))
    const { unmount } = render(<WebAppConnectBanner />)
    expect(added).toHaveLength(1)
    expect(removed).toHaveLength(1)
    unmount()
    expect(added).toHaveLength(0)
    expect(removed).toHaveLength(0)
    await act(async () => {
      resolve(false)
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.queryByRole('region', { name: 'Website access' })).not.toBeInTheDocument()
  })
})
