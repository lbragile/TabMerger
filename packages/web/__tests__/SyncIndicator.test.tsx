import { StrictMode } from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncIndicator, LAST_SYNC_SEEN_STORAGE_KEY } from '@/components/dashboard/SyncIndicator'
import { _resetExtensionIdCache } from '@/lib/extensionMessaging'

let changeHandler: ((payload: unknown) => void) | undefined
let subscribeCallback: ((status: string, err?: Error) => void) | undefined
/** Order of the realtime-related calls, to prove the token is set before the channel subscribes. */
let realtimeCalls: string[] = []
const removeChannel = vi.fn()
const select = vi.fn()
const getSession = vi.fn()

const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: () => {
        realtimeCalls.push('getSession')
        return getSession()
      },
    },
    realtime: {
      setAuth: (token?: string | null) => {
        realtimeCalls.push(`setAuth:${token}`)
        return Promise.resolve()
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => select(),
          }),
        }),
      }),
    }),
    channel: (topic: string) => {
      realtimeCalls.push(`channel:${topic}`)
      return {
        on: (_event: string, _filter: unknown, cb: (payload: unknown) => void) => {
          changeHandler = cb
          return {
            subscribe: (onStatus?: (status: string, err?: Error) => void) => {
              realtimeCalls.push('subscribe')
              subscribeCallback = onStatus
              return {}
            },
          }
        },
      }
    },
    removeChannel,
  }),
}))

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const refreshButton = () => screen.getByRole('button', { name: 'Refresh sync status' })
/** The pill is the button's nearest div: its text is the whole visible label. */
const pill = () => refreshButton().closest('div') as HTMLElement

type Reply = (response?: unknown) => void

/**
 * Installs a fake extension. PING is answered at once (it is how the web app finds the
 * extension); every SYNC_NOW is handed to `onSyncNow`, which answers now or keeps the reply
 * callback to answer later.
 */
function installExtension(onSyncNow: (reply: Reply) => void) {
  const sendMessage = vi.fn((_id: string, msg: unknown, cb: Reply) => {
    if ((msg as { type?: string }).type === 'PING') cb({ type: 'PONG', version: 'test' })
    else onSyncNow(cb)
  })
  window.chrome = { runtime: { sendMessage } }
  return sendMessage
}

/** Fake-timer helper: runs timers for `ms` and lets pending promises settle inside act(). */
const advance = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

describe('SyncIndicator', () => {
  beforeEach(() => {
    changeHandler = undefined
    subscribeCallback = undefined
    realtimeCalls = []
    removeChannel.mockClear()
    select.mockReset()
    getSession.mockReset()
    getSession.mockResolvedValue({ data: { session: { access_token: 'user-token' } } })
    toastError.mockClear()
    delete window.chrome
    _resetExtensionIdCache()
  })

  afterEach(() => {
    // Order matters: a spy placed on a timer function while fake timers were on must be restored
    // BEFORE the real timers come back, or it puts the fake function back in place for good and
    // every later `waitFor` that depends on its polling interval hangs.
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete window.chrome
    _resetExtensionIdCache()
  })

  it('shows "No sync yet" when there is no prior group data', async () => {
    select.mockResolvedValue({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(pill()).toHaveTextContent('No sync yet'))
  })

  it('shows last synced time from the initial fetch', async () => {
    select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))
  })

  it('uses a styled Tooltip trigger instead of a native title attribute', () => {
    select.mockResolvedValue({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    expect(refreshButton()).not.toHaveAttribute('title')
  })

  describe('label keeps itself current', () => {
    it('re-renders the relative time on a timer, with no other event', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: new Date().toISOString() }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()
      expect(pill()).toHaveTextContent('Synced just now')

      await advance(5 * MINUTE)
      expect(pill()).toHaveTextContent('Synced 5m ago')

      await advance(2 * 60 * MINUTE)
      expect(pill()).toHaveTextContent('Synced 2h ago')
    })

    it('catches up at once when the tab becomes visible again', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: new Date().toISOString() }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()
      expect(pill()).toHaveTextContent('Synced just now')

      // A sleeping laptop: the clock moves on but no timer fires.
      vi.setSystemTime(Date.now() + 7 * MINUTE)
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(pill()).toHaveTextContent('Synced 7m ago')
    })

    it('stops its timers on unmount', async () => {
      vi.useFakeTimers()
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      select.mockResolvedValue({ data: [] })
      const { unmount } = render(<SyncIndicator userId="user-1" />)
      await advance()
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000)

      unmount()
      expect(vi.getTimerCount()).toBe(0)
      expect(removeChannel).toHaveBeenCalledTimes(1)
    })
  })

  describe('realtime subscription', () => {
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })

    it("puts the user's token on the realtime client before the channel subscribes", async () => {
      select.mockResolvedValue({ data: [] })
      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(realtimeCalls).toContain('subscribe'))

      // A join sent without the token is an anonymous join: RLS then hides every row event.
      expect(realtimeCalls).toEqual(['getSession', 'setAuth:user-token', 'channel:groups-sync-user-1', 'subscribe'])
    })

    it('subscribes nothing when cleanup runs before the async setup finished', async () => {
      select.mockResolvedValue({ data: [] })
      let resolveSession: (value: unknown) => void = () => {}
      getSession.mockReturnValue(new Promise((resolve) => (resolveSession = resolve)))

      const { unmount } = render(<SyncIndicator userId="user-1" />)
      unmount()
      await act(async () => {
        resolveSession({ data: { session: { access_token: 'user-token' } } })
      })
      await settle()

      expect(realtimeCalls).toEqual(['getSession'])
      expect(removeChannel).not.toHaveBeenCalled()
    })

    it('keeps a single live channel through the development double mount', async () => {
      select.mockResolvedValue({ data: [] })
      const { unmount } = render(
        <StrictMode>
          <SyncIndicator userId="user-1" />
        </StrictMode>
      )
      await waitFor(() => expect(realtimeCalls).toContain('subscribe'))
      await settle()

      expect(realtimeCalls.filter((call) => call.startsWith('channel:'))).toHaveLength(1)
      expect(realtimeCalls.filter((call) => call === 'subscribe')).toHaveLength(1)

      unmount()
      expect(removeChannel).toHaveBeenCalledTimes(1)
    })

    it('does not join anonymously when the browser has no session', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      select.mockResolvedValue({ data: [] })
      getSession.mockResolvedValue({ data: { session: null } })

      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
      await settle()

      expect(realtimeCalls).toEqual(['getSession'])
    })

    it('logs once when the channel reports that live updates are not working', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      select.mockResolvedValue({ data: [] })
      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(subscribeCallback).toBeDefined())

      act(() => {
        subscribeCallback!('SUBSCRIBED')
      })
      expect(warn).not.toHaveBeenCalled()

      act(() => {
        subscribeCallback!('CHANNEL_ERROR', new Error('boom'))
        subscribeCallback!('TIMED_OUT')
        subscribeCallback!('CLOSED')
      })
      expect(warn).toHaveBeenCalledTimes(1)
      // No new UI: the pill keeps showing what it knows.
      expect(pill()).toHaveTextContent('No sync yet')
    })
  })

  describe('realtime events', () => {
    it('shows "Syncing..." when a row event arrives, then the new time', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [] })
      render(<SyncIndicator userId="user-1" />)
      await advance()

      act(() => {
        changeHandler!({ eventType: 'INSERT', new: { updated_at: new Date().toISOString() } })
      })
      expect(pill()).toHaveTextContent('Syncing...')

      await advance(2000)
      expect(pill()).toHaveTextContent('Synced just now')
    })

    it('does not move the label backwards on a position-only UPDATE carrying an old updated_at', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: ago(60 * MINUTE) }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()
      expect(pill()).toHaveTextContent('Synced 1h ago')

      act(() => {
        changeHandler!({ eventType: 'UPDATE', new: { updated_at: ago(2 * 60 * MINUTE), position: 3 } })
      })
      expect(pill()).toHaveTextContent('Syncing...')

      // After the pulse: recent activity, never "2h ago" or the older "1h ago".
      await advance(2000)
      expect(pill()).toHaveTextContent('Synced just now')
    })
  })

  describe('manual sync', () => {
    it('shows "Syncing..." from the click until the extension answers', async () => {
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))

      let reply: Reply = () => {}
      const sendMessage = installExtension((cb) => (reply = cb))

      const user = userEvent.setup()
      await user.click(refreshButton())

      await waitFor(() => expect(pill()).toHaveTextContent('Syncing...'))
      expect(refreshButton()).toBeDisabled()
      expect(refreshButton().querySelector('svg')).toHaveClass('animate-spin')
      await waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith(expect.any(String), { type: 'SYNC_NOW' }, expect.any(Function))
      )
      expect(pill()).toHaveTextContent('Syncing...')

      await act(async () => reply({ ok: true, skipped: false }))
      await waitFor(() => expect(pill()).not.toHaveTextContent('Syncing...'))
      expect(refreshButton()).not.toBeDisabled()
    })

    it('keeps waiting for a sync that takes longer than the install probe allows', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()

      let reply: Reply = () => {}
      const sendMessage = installExtension((cb) => (reply = cb))
      fireEvent.click(refreshButton())

      // A real push and pull can take several seconds.
      await advance(8000)
      expect(pill()).toHaveTextContent('Syncing...')
      const syncNowCalls = sendMessage.mock.calls.filter(([, msg]) => (msg as { type: string }).type === 'SYNC_NOW')
      expect(syncNowCalls).toHaveLength(1)

      await act(async () => reply({ ok: true, skipped: false }))
      await advance()
      expect(pill()).toHaveTextContent('Synced just now')
    })

    it('sets the time to now when the extension reports a completed sync, even if no row changed', async () => {
      // Nothing to push or pull: `groups.updated_at` stays three days old.
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))

      installExtension((reply) => reply({ ok: true, skipped: false }))
      const user = userEvent.setup()
      await user.click(refreshButton())

      await waitFor(() => expect(pill()).toHaveTextContent('Synced just now'))
      expect(toastError).not.toHaveBeenCalled()
    })

    it('treats an answer without "skipped" (older extension) as a completed sync', async () => {
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))

      installExtension((reply) => reply({ ok: true }))
      const user = userEvent.setup()
      await user.click(refreshButton())

      await waitFor(() => expect(pill()).toHaveTextContent('Synced just now'))
    })

    it('does not claim a sync when the extension skipped it, and re-reads shortly after', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()
      expect(select).toHaveBeenCalledTimes(1)

      installExtension((reply) => reply({ ok: true, skipped: true }))
      fireEvent.click(refreshButton())
      await advance()

      expect(pill()).toHaveTextContent('Sync already in progress')
      expect(pill()).not.toHaveTextContent('just now')
      expect(toastError).not.toHaveBeenCalled()

      await advance(3000)
      expect(select).toHaveBeenCalledTimes(2)
      expect(pill()).toHaveTextContent('Synced 3d ago')
    })

    it('falls back to a plain re-read when the extension is not reachable, without claiming a sync', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()
      expect(select).toHaveBeenCalledTimes(1)

      // no window.chrome at all: a browser without the extension installed
      fireEvent.click(refreshButton())
      await advance(5000)

      expect(select).toHaveBeenCalledTimes(2)
      expect(pill()).toHaveTextContent('Synced 3d ago')
      expect(pill()).not.toHaveTextContent('just now')
      expect(toastError).not.toHaveBeenCalled()
    })

    it('picks up a newer time from the re-read when the extension is not reachable', async () => {
      vi.useFakeTimers()
      select.mockResolvedValueOnce({ data: [] })
      render(<SyncIndicator userId="user-1" />)
      await advance()
      expect(pill()).toHaveTextContent('No sync yet')

      select.mockResolvedValueOnce({ data: [{ updated_at: ago(4 * MINUTE) }] })
      fireEvent.click(refreshButton())
      await advance(5000)

      expect(pill()).toHaveTextContent('Synced 4m ago')
    })

    it('treats a malformed answer as "not reachable"', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()

      installExtension((reply) => reply(undefined))
      fireEvent.click(refreshButton())
      await advance(5000)

      expect(pill()).toHaveTextContent('Synced 3d ago')
      expect(toastError).not.toHaveBeenCalled()
    })
  })

  describe('failed sync', () => {
    async function failWith(response: unknown) {
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))

      installExtension((reply) => reply(response))
      const user = userEvent.setup()
      await user.click(refreshButton())
      await waitFor(() => expect(pill()).toHaveTextContent('Sync failed'))
      return user
    }

    it("shows the extension's own message for an error", async () => {
      const message = 'Could not reach the sync server. Try again.'
      await failWith({ ok: false, reason: 'error', message })

      expect(toastError).toHaveBeenCalledWith(message)
      // In the pill itself, not only in a toast that disappears.
      expect(screen.getByRole('status')).toHaveTextContent(`Sync failed. ${message}`)
      // Not colour alone: the words "Sync failed" plus a warning icon.
      expect(pill().querySelector('svg[data-sync-failed-icon]')).toBeInTheDocument()
    })

    it('makes the reason reachable from the keyboard', async () => {
      const message = "This device still holds another account's data. Open the extension to switch accounts."
      await failWith({ ok: false, reason: 'error', message })

      expect(refreshButton()).not.toBeDisabled()
      expect(refreshButton()).toHaveAccessibleDescription(message)
    })

    it('falls back to the generic text when an error has no message', async () => {
      await failWith({ ok: false, reason: 'error' })

      const generic = 'Sync failed. Try again from the extension.'
      expect(toastError).toHaveBeenCalledWith(generic)
      expect(refreshButton()).toHaveAccessibleDescription(generic)
    })

    it('shows the mapped message for "locked"', async () => {
      await failWith({ ok: false, reason: 'locked', message: 'Open the extension and unlock encryption to sync.' })

      expect(toastError).toHaveBeenCalledWith('Open the extension and unlock encryption to sync.')
      expect(refreshButton()).toHaveAccessibleDescription('Open the extension and unlock encryption to sync.')
    })

    it('shows the mapped message for "no-session"', async () => {
      await failWith({ ok: false, reason: 'no-session' })

      expect(toastError).toHaveBeenCalledWith('Sign in to the extension to sync.')
      expect(refreshButton()).toHaveAccessibleDescription('Sign in to the extension to sync.')
    })

    it('stays failed until the next successful sync, then clears', async () => {
      const user = await failWith({ ok: false, reason: 'error', message: 'Could not reach the sync server. Try again.' })

      // Still failed well after the old two second flash would have ended.
      await new Promise((resolve) => setTimeout(resolve, 2100))
      expect(pill()).toHaveTextContent('Sync failed')

      installExtension((reply) => reply({ ok: true, skipped: false }))
      await user.click(refreshButton())

      await waitFor(() => expect(pill()).toHaveTextContent('Synced just now'))
      expect(pill()).not.toHaveTextContent('Sync failed')
      expect(refreshButton()).not.toHaveAccessibleDescription()
      expect(pill().querySelector('svg[data-sync-failed-icon]')).not.toBeInTheDocument()
    })

    it('clears on the next realtime event', async () => {
      await failWith({ ok: false, reason: 'error', message: 'Could not reach the sync server. Try again.' })

      act(() => {
        changeHandler!({ eventType: 'UPDATE', new: { updated_at: new Date().toISOString() } })
      })
      expect(pill()).toHaveTextContent('Syncing...')
      await waitFor(() => expect(pill()).toHaveTextContent('Synced just now'))
      expect(pill()).not.toHaveTextContent('Sync failed')
    })

    it('is not cleared by the pulse of an event that arrived before the failure', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()

      let reply: Reply = () => {}
      installExtension((cb) => (reply = cb))
      fireEvent.click(refreshButton())
      await advance()

      // The push landed (row event), then the pull failed.
      act(() => {
        changeHandler!({ eventType: 'UPDATE', new: { updated_at: new Date().toISOString() } })
      })
      expect(refreshButton()).toBeDisabled()
      await act(async () => reply({ ok: false, reason: 'error', message: 'Could not reach the sync server. Try again.' }))
      await advance(2500)

      expect(pill()).toHaveTextContent('Sync failed')
    })
  })

  describe('accessibility', () => {
    it('announces status changes politely, without the ticking relative time', async () => {
      vi.useFakeTimers()
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      render(<SyncIndicator userId="user-1" />)
      await advance()

      // role="status" is a polite live region. The time sits outside it, so "5m ago" becoming
      // "6m ago" is not read out every minute.
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent(/^Synced$/)
      expect(pill()).toHaveTextContent('Synced 3d ago')

      act(() => {
        changeHandler!({ eventType: 'UPDATE', new: { updated_at: new Date().toISOString() } })
      })
      expect(status).toHaveTextContent(/^Syncing\.\.\.$/)
    })
  })

  describe('remembered sync time (localStorage)', () => {
    async function completeSync(userId: string) {
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })
      const view = render(<SyncIndicator userId={userId} />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))
      installExtension((reply) => reply({ ok: true, skipped: false }))
      const user = userEvent.setup()
      await user.click(refreshButton())
      await waitFor(() => expect(pill()).toHaveTextContent('Synced just now'))
      return view
    }

    it('does not jump back after a reload when this browser already saw a newer sync', async () => {
      const { unmount } = await completeSync('user-1')
      unmount()

      // "Reload": the server still only knows the three day old content change.
      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced just now'))
      expect(pill()).not.toHaveTextContent('3d ago')
    })

    it('remembers the time per user, under one key constant', async () => {
      const { unmount } = await completeSync('user-1')
      unmount()

      expect(LAST_SYNC_SEEN_STORAGE_KEY).toEqual(expect.any(String))
      expect(localStorage.getItem(`${LAST_SYNC_SEEN_STORAGE_KEY}:user-1`)).not.toBeNull()
      expect(localStorage.getItem(`${LAST_SYNC_SEEN_STORAGE_KEY}:user-2`)).toBeNull()

      render(<SyncIndicator userId="user-2" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))
    })

    it('shows the remembered time even when no group is left on the server', async () => {
      const { unmount } = await completeSync('user-1')
      unmount()

      select.mockResolvedValue({ data: [] })
      render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced just now'))
    })

    it('ignores a remembered value that is not a usable time', async () => {
      localStorage.setItem(`${LAST_SYNC_SEEN_STORAGE_KEY}:user-1`, 'not-a-date')
      localStorage.setItem(`${LAST_SYNC_SEEN_STORAGE_KEY}:user-2`, String(Date.now() + 30 * DAY))
      select.mockResolvedValue({ data: [{ updated_at: ago(3 * DAY) }] })

      const { unmount } = render(<SyncIndicator userId="user-1" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))
      unmount()

      // A time far in the future (a clock that was wrong once) would pin the label to "just now".
      render(<SyncIndicator userId="user-2" />)
      await waitFor(() => expect(pill()).toHaveTextContent('Synced 3d ago'))
    })

    it('still works when localStorage throws on every read and write', async () => {
      const denied = () => {
        throw new Error('storage denied')
      }
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)

      await completeSync('user-1')
      expect(pill()).toHaveTextContent('Synced just now')
      expect(toastError).not.toHaveBeenCalled()
    })
  })
})
