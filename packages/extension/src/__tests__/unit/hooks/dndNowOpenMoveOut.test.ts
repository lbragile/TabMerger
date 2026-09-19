/**
 * dndNowOpenMoveOut.test.ts — dragging OUT of "Now Open" MOVES (it used to copy).
 *
 * The destination still gets a detached copy, but the real tabs are now closed. The whole
 * risk of this change is spec C7: closing the ACTIVE tab of the window the toolbar popup
 * is anchored to dismisses the popup instantly, which killed the drop commit. So the
 * executor never closes an active tab itself — it hands those ids to the background worker
 * over a port that disconnects when the popup goes away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { partitionClosableTabs, runSideEffects } from '@/hooks/useDndHandlers'
import {
  closeTabsWhenPopupCloses,
  resetDeferredClosePort,
  DEFERRED_CLOSE_PORT
} from '@/lib/deferredTabClose'

interface PortStub {
  name: string
  postMessage: ReturnType<typeof vi.fn>
  onDisconnect: { addListener: ReturnType<typeof vi.fn> }
}

function stubChrome(opts: { activeIds?: number[]; queryThrows?: boolean } = {}) {
  const ports: PortStub[] = []
  const chromeStub = {
    windows: { create: vi.fn().mockResolvedValue({}) },
    tabs: {
      create: vi.fn().mockResolvedValue({}),
      move: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue(undefined),
      query: opts.queryThrows
        ? vi.fn().mockRejectedValue(new Error('no'))
        : vi.fn().mockResolvedValue((opts.activeIds ?? []).map((id) => ({ id })))
    },
    runtime: {
      connect: vi.fn((info: { name: string }) => {
        const port: PortStub = {
          name: info.name,
          postMessage: vi.fn(),
          onDisconnect: { addListener: vi.fn() }
        }
        ports.push(port)
        return port
      })
    }
  }
  vi.stubGlobal('chrome', chromeStub)
  return { chromeStub, ports }
}

beforeEach(() => resetDeferredClosePort())
afterEach(() => {
  vi.unstubAllGlobals()
  resetDeferredClosePort()
})

describe('partitionClosableTabs — what may be closed while the popup is open', () => {
  it('closes non-active tabs now and defers every ACTIVE tab (the popup anchor is one of them)', async () => {
    stubChrome({ activeIds: [10, 30] })
    expect(await partitionClosableTabs([10, 20, 30, 40])).toEqual({ now: [20, 40], deferred: [10, 30] })
  })

  it('de-duplicates and drops the saved-tab sentinel id 0 (chrome.tabs.remove(0) is never valid)', async () => {
    stubChrome({ activeIds: [] })
    expect(await partitionClosableTabs([7, 7, 0, -1])).toEqual({ now: [7], deferred: [] })
  })

  it('an empty list short-circuits without querying chrome', async () => {
    const { chromeStub } = stubChrome()
    expect(await partitionClosableTabs([])).toEqual({ now: [], deferred: [] })
    expect(chromeStub.tabs.query).not.toHaveBeenCalled()
  })

  it('degrades to DEFER EVERYTHING when the active-tab query fails — the safe direction', async () => {
    stubChrome({ queryThrows: true })
    expect(await partitionClosableTabs([1, 2])).toEqual({ now: [], deferred: [1, 2] })
  })
})

describe('runSideEffects — tabs.remove', () => {
  it('removes the non-active tabs itself and hands the active one to the background port', async () => {
    const { chromeStub, ports } = stubChrome({ activeIds: [10] })
    await runSideEffects([{ type: 'tabs.remove', tabIds: [10, 20, 30] }])
    expect(chromeStub.tabs.remove).toHaveBeenCalledTimes(1)
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith([20, 30])
    expect(ports).toHaveLength(1)
    expect(ports[0].name).toBe(DEFERRED_CLOSE_PORT)
    expect(ports[0].postMessage).toHaveBeenCalledWith({ tabIds: [10] })
  })

  it('never calls chrome.tabs.remove when every dragged tab is active — that would dismiss the popup', async () => {
    const { chromeStub, ports } = stubChrome({ activeIds: [10, 11] })
    await runSideEffects([{ type: 'tabs.remove', tabIds: [10, 11] }])
    expect(chromeStub.tabs.remove).not.toHaveBeenCalled()
    expect(ports[0].postMessage).toHaveBeenCalledWith({ tabIds: [10, 11] })
  })

  it('opens no port at all when nothing needs deferring', async () => {
    const { chromeStub, ports } = stubChrome({ activeIds: [] })
    await runSideEffects([{ type: 'tabs.remove', tabIds: [5, 6] }])
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith([5, 6])
    expect(ports).toHaveLength(0)
  })

  it('a failing remove does not stop the rest of the batch (best effort, Now Open re-syncs)', async () => {
    const { chromeStub } = stubChrome({ activeIds: [] })
    chromeStub.tabs.remove.mockRejectedValueOnce(new Error('already gone'))
    await runSideEffects([
      { type: 'tabs.remove', tabIds: [5] },
      { type: 'windows.create', url: 'https://x.example', focused: false }
    ])
    expect(chromeStub.windows.create).toHaveBeenCalledWith({ url: 'https://x.example', focused: false })
  })
})

describe('closeTabsWhenPopupCloses', () => {
  it('reuses ONE port across calls, so the worker accumulates ids for a single disconnect', () => {
    const { ports } = stubChrome()
    closeTabsWhenPopupCloses([1])
    closeTabsWhenPopupCloses([2, 3])
    expect(ports).toHaveLength(1)
    expect(ports[0].postMessage).toHaveBeenNthCalledWith(1, { tabIds: [1] })
    expect(ports[0].postMessage).toHaveBeenNthCalledWith(2, { tabIds: [2, 3] })
  })

  it('is a no-op for an empty list and never throws when the worker is unreachable', () => {
    const { chromeStub, ports } = stubChrome()
    closeTabsWhenPopupCloses([])
    expect(ports).toHaveLength(0)
    chromeStub.runtime.connect.mockImplementationOnce(() => {
      throw new Error('worker gone')
    })
    expect(() => closeTabsWhenPopupCloses([9])).not.toThrow()
  })

  it('drops a dead port so the NEXT call reconnects instead of posting into the void', () => {
    const { ports } = stubChrome()
    closeTabsWhenPopupCloses([1])
    // Simulate the worker's side going away.
    const onDisconnect = ports[0].onDisconnect.addListener.mock.calls[0][0] as () => void
    onDisconnect()
    closeTabsWhenPopupCloses([2])
    expect(ports).toHaveLength(2)
  })
})
