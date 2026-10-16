import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SITE_ACCESS_CLOSE_DELAY_MS, SiteAccessPage } from '@/components/SiteAccess/SiteAccessPage'

// The Firefox-only site-access tab the popup banner opens: Firefox shows no permission prompt over
// an open popup, so this tab asks for the trusted web-bridge sites Firefox hasn't granted.

type Listener = () => void
const originalChrome = (globalThis as { chrome?: unknown }).chrome
const OLD = 'https://tabmerger.vercel.app/*'
const NEW = 'https://tabmerger.com/*'
const SUCCESS = 'Done — the website can now find TabMerger. You can close this tab.'
let granted: Set<string>
let contains: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>
let added: Listener[]
let removed: Listener[]
let closeSpy: ReturnType<typeof vi.spyOn>

function event(list: () => Listener[]) {
  return {
    addListener: (cb: Listener) => list().push(cb),
    removeListener: (cb: Listener) => {
      const l = list()
      const i = l.indexOf(cb)
      if (i >= 0) l.splice(i, 1)
    },
  }
}

beforeEach(() => {
  granted = new Set()
  added = []
  removed = []
  contains = vi.fn(async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o)))
  request = vi.fn(async ({ origins }: { origins: string[] }) => {
    origins.forEach((o) => granted.add(o))
    return true
  })
  ;(globalThis as { chrome?: unknown }).chrome = {
    permissions: { contains, request, onAdded: event(() => added), onRemoved: event(() => removed) },
  }
  closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})
  vi.stubEnv('FIREFOX', 'true')
  vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.vercel.app')
  vi.stubEnv('VITE_EXTRA_WEB_APP_URLS', 'https://tabmerger.com')
})

afterEach(() => {
  vi.unstubAllEnvs()
  closeSpy.mockRestore()
  ;(globalThis as { chrome?: unknown }).chrome = originalChrome
})

const status = () => screen.getByRole('status')

async function fire(list: Listener[]) {
  await act(async () => {
    list.forEach((cb) => cb())
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('SiteAccessPage', () => {
  it('names the missing site in a labelled button under a heading', async () => {
    granted.add(OLD)
    render(<SiteAccessPage />)
    const button = await screen.findByRole('button', { name: 'Allow TabMerger on tabmerger.com' })
    expect(button).toHaveTextContent('Allow TabMerger on tabmerger.com')
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(status()).toHaveAttribute('aria-live', 'polite')
    expect(status()).toHaveTextContent('')
  })

  it('requests only the build trusted patterns that are missing, inside the click', async () => {
    render(<SiteAccessPage />)
    const button = await screen.findByRole('button', {
      name: 'Allow TabMerger on tabmerger.vercel.app and tabmerger.com',
    })
    fireEvent.click(button)
    // Synchronously, within the click: Firefox only allows permissions.request() in a user action.
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({ origins: [OLD, NEW] })
  })

  it('shows the success state once granted and closes the tab after a moment', async () => {
    granted.add(OLD)
    render(<SiteAccessPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Allow TabMerger on/ }))
    await waitFor(() => expect(status()).toHaveTextContent(SUCCESS))
    expect(screen.queryByRole('button', { name: /Allow TabMerger on/ })).not.toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1), { timeout: SITE_ACCESS_CLOSE_DELAY_MS + 1000 })
    // If the browser refuses to close it, the message stays.
    expect(status()).toHaveTextContent(SUCCESS)
  })

  it('keeps the message when closing throws', async () => {
    closeSpy.mockImplementation(() => {
      throw new Error('not closable')
    })
    granted.add(OLD)
    render(<SiteAccessPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Allow TabMerger on/ }))
    await waitFor(() => expect(status()).toHaveTextContent(SUCCESS))
    await waitFor(() => expect(closeSpy).toHaveBeenCalled(), { timeout: SITE_ACCESS_CLOSE_DELAY_MS + 1000 })
    expect(status()).toHaveTextContent(SUCCESS)
  })

  it('says so when refused and keeps the button', async () => {
    request.mockResolvedValue(false)
    granted.add(OLD)
    render(<SiteAccessPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Allow TabMerger on/ }))
    await waitFor(() => expect(status()).toHaveTextContent("Firefox didn't allow it."))
    const button = screen.getByRole('button', { name: 'Allow TabMerger on tabmerger.com' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('shows success straight away when nothing is missing, without closing itself', async () => {
    granted.add(OLD).add(NEW)
    render(<SiteAccessPage />)
    await waitFor(() => expect(status()).toHaveTextContent(SUCCESS))
    expect(screen.queryByRole('button', { name: /Allow TabMerger on/ })).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, SITE_ACCESS_CLOSE_DELAY_MS + 100))
    expect(closeSpy).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('updates to success on a grant made outside the tab, such as about:addons', async () => {
    granted.add(OLD)
    render(<SiteAccessPage />)
    await screen.findByRole('button', { name: /Allow TabMerger on/ })
    granted.add(NEW)
    await fire(added)
    expect(status()).toHaveTextContent(SUCCESS)
    expect(request).not.toHaveBeenCalled()
  })

  it('asks again if access is revoked while open', async () => {
    granted.add(OLD).add(NEW)
    render(<SiteAccessPage />)
    await waitFor(() => expect(status()).toHaveTextContent(SUCCESS))
    granted.delete(NEW)
    await fire(removed)
    expect(screen.getByRole('button', { name: 'Allow TabMerger on tabmerger.com' })).toBeInTheDocument()
    expect(status()).toHaveTextContent('')
  })

  it('keeps a shown refusal when an unrelated permission change arrives', async () => {
    request.mockResolvedValue(false)
    granted.add(OLD)
    render(<SiteAccessPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Allow TabMerger on/ }))
    await waitFor(() => expect(status()).toHaveTextContent("Firefox didn't allow it."))
    await fire(added)
    expect(status()).toHaveTextContent("Firefox didn't allow it.")
  })

  it('removes its listeners on unmount and ignores a check that finishes later', async () => {
    let resolve!: (v: boolean) => void
    contains.mockImplementation(() => new Promise<boolean>((r) => (resolve = r)))
    const { unmount } = render(<SiteAccessPage />)
    expect(added).toHaveLength(1)
    expect(removed).toHaveLength(1)
    unmount()
    expect(added).toHaveLength(0)
    expect(removed).toHaveLength(0)
    await act(async () => {
      resolve(false)
      await new Promise((r) => setTimeout(r, 0))
    })
  })
})
