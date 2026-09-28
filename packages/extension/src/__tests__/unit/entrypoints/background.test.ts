import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EXTENSION_MESSAGE } from '@tabmerger/shared'

type BgConfig = { main: () => void } | (() => void)
let capturedMain: (() => void) | undefined
;(globalThis as unknown as { defineBackground: (fn: () => void) => void }).defineBackground = (fn) => {
  capturedMain = fn
}

const {
  mockGetGroupsState,
  mockSaveGroupsState,
  mockGetAllUrlRules,
  mockMatchUrlToRule,
  mockApplyUrlRule,
  mockRunGoogleOAuthFlow,
  mockGetSession,
  mockHasEncryptionKey,
  mockGetDataKey,
  mockPerformSync,
  mockRegisterGroupsChangeListener,
  mockHasDataConsent,
} = vi.hoisted(() => ({
  mockGetGroupsState: vi.fn(),
  mockSaveGroupsState: vi.fn().mockResolvedValue(undefined),
  mockRegisterGroupsChangeListener: vi.fn(),
  mockGetAllUrlRules: vi.fn().mockResolvedValue([]),
  mockMatchUrlToRule: vi.fn().mockReturnValue(null),
  mockApplyUrlRule: vi.fn().mockResolvedValue(undefined),
  mockRunGoogleOAuthFlow: vi.fn().mockResolvedValue(undefined),
  mockGetSession: vi.fn(),
  mockHasEncryptionKey: vi.fn(),
  mockGetDataKey: vi.fn(),
  mockPerformSync: vi.fn(),
  mockHasDataConsent: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/googleOAuthFlow', () => ({ runGoogleOAuthFlow: mockRunGoogleOAuthFlow }))

vi.mock('@/lib/localDb', () => ({
  getGroupsState: mockGetGroupsState,
  saveGroupsState: mockSaveGroupsState,
  registerGroupsChangeListener: mockRegisterGroupsChangeListener,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { setSession: vi.fn(), getSession: mockGetSession } },
}))

vi.mock('@/lib/encryptionKey', () => ({
  hasEncryptionKey: mockHasEncryptionKey,
  getDataKey: mockGetDataKey,
}))

vi.mock('@/lib/syncEngine', () => ({
  performSync: mockPerformSync,
}))

vi.mock('@/lib/dataConsent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dataConsent')>()),
  hasDataConsent: mockHasDataConsent,
}))

vi.mock('@/lib/urlRuleEngine', () => ({
  getAllUrlRules: mockGetAllUrlRules,
  matchUrlToRule: mockMatchUrlToRule,
  applyUrlRule: mockApplyUrlRule,
}))

function makeChromeStub() {
  const listeners: Record<string, ((...args: unknown[]) => unknown)[]> = {}
  const on = (name: string) => ({
    addListener: (cb: (...args: unknown[]) => unknown) => {
      listeners[name] = listeners[name] ?? []
      listeners[name].push(cb)
    },
  })
  return {
    listeners,
    chrome: {
      runtime: {
        onInstalled: on('onInstalled'),
        onStartup: on('onStartup'),
        onMessage: on('onMessage'),
        onMessageExternal: on('onMessageExternal'),
        // Popup → worker port used to close Now Open tabs the popup must not close itself
        // (an ACTIVE tab; closing the popup's anchor dismisses it — spec C7).
        onConnect: on('onConnect'),
        getURL: vi.fn().mockReturnValue('icon.png'),
        getManifest: vi.fn().mockReturnValue({ version: '2.9.0' }),
        id: 'this-extension-id',
      },
      contextMenus: {
        removeAll: vi.fn().mockResolvedValue(undefined),
        create: vi.fn(),
        onClicked: on('onClicked'),
      },
      commands: {
        onCommand: on('onCommand'),
      },
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), remove: vi.fn() },
        session: { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue({}), remove: vi.fn() },
      },
      alarms: {
        getAll: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: on('onAlarm'),
      },
      notifications: {
        create: vi.fn(),
        clear: vi.fn(),
        onClicked: on('notifOnClicked'),
      },
      tabs: {
        onCreated: on('tabsOnCreated'),
        onRemoved: on('tabsOnRemoved'),
        onUpdated: on('tabsOnUpdated'),
        query: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      windows: {
        getAll: vi.fn().mockResolvedValue([]),
      },
      action: {
        setBadgeText: vi.fn().mockResolvedValue(undefined),
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
        // openPopup intentionally omitted by default — feature-detected; tests that need
        // the picker path add it explicitly (mirrors Firefox MV2 / older Chrome lacking it)
        openPopup: undefined as (() => Promise<void>) | undefined,
      },
    },
  }
}

let stub: ReturnType<typeof makeChromeStub>

beforeEach(async () => {
  vi.resetModules()
  mockGetGroupsState.mockReset()
  mockSaveGroupsState.mockReset().mockResolvedValue(undefined)
  mockGetAllUrlRules.mockReset().mockResolvedValue([])
  mockMatchUrlToRule.mockReset().mockReturnValue(null)
  mockApplyUrlRule.mockReset().mockResolvedValue(undefined)
  mockRunGoogleOAuthFlow.mockReset().mockResolvedValue(undefined)
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
  mockHasEncryptionKey.mockReset().mockResolvedValue(true)
  mockGetDataKey.mockReset().mockResolvedValue('key')
  mockPerformSync.mockReset().mockResolvedValue([])
  mockRegisterGroupsChangeListener.mockReset()
  mockHasDataConsent.mockReset().mockResolvedValue(true)
  capturedMain = undefined
  stub = makeChromeStub()
  globalThis.chrome = stub.chrome as unknown as typeof chrome
  mockGetGroupsState.mockResolvedValue({ available: [{ id: 'now', permanent: true, windows: [] }], active: { id: 'now', index: 0 } })
  await import('@/entrypoints/background')
  capturedMain!()
  await new Promise((r) => setTimeout(r, 0)) // flush initial buildMenus/reRegisterReminders
})

describe('background — deferred tab close (drag out of Now Open)', () => {
  /** Connect a fake popup port and return its message/disconnect hooks. */
  function connect(name = 'tm-close-tabs-on-popup-close') {
    const messageCbs: ((msg: unknown) => void)[] = []
    const disconnectCbs: (() => void)[] = []
    stub.listeners.onConnect[0]({
      name,
      onMessage: { addListener: (cb: (msg: unknown) => void) => messageCbs.push(cb) },
      onDisconnect: { addListener: (cb: () => void) => disconnectCbs.push(cb) },
    })
    return {
      post: (msg: unknown) => messageCbs.forEach((cb) => cb(msg)),
      disconnect: () => disconnectCbs.forEach((cb) => cb()),
      connected: messageCbs.length > 0,
    }
  }

  it('closes the queued tabs only once the popup port DISCONNECTS, not when they arrive', () => {
    const port = connect()
    port.post({ tabIds: [7, 8] })
    // Still open: the popup is alive, and closing its anchor tab would dismiss it (C7).
    expect(stub.chrome.tabs.remove).not.toHaveBeenCalled()
    port.disconnect()
    expect(stub.chrome.tabs.remove).toHaveBeenCalledWith([7, 8])
  })

  it('accumulates ids across messages and de-duplicates them', () => {
    const port = connect()
    port.post({ tabIds: [7] })
    port.post({ tabIds: [7, 9] })
    port.disconnect()
    expect(stub.chrome.tabs.remove).toHaveBeenCalledWith([7, 9])
  })

  it('ignores junk payloads and the saved-tab sentinel id 0', () => {
    const port = connect()
    port.post({ tabIds: [0, -1, 'x'] })
    port.post(undefined)
    port.post({})
    port.disconnect()
    expect(stub.chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('ignores ports with a different name (other features may open their own)', () => {
    const port = connect('something-else')
    expect(port.connected).toBe(false)
  })

  it('falls back to closing tabs one by one when the batch remove rejects', async () => {
    stub.chrome.tabs.remove.mockRejectedValueOnce(new Error('one already gone'))
    const port = connect()
    port.post({ tabIds: [7, 8] })
    port.disconnect()
    await new Promise((r) => setTimeout(r, 0))
    expect(stub.chrome.tabs.remove).toHaveBeenCalledWith(7)
    expect(stub.chrome.tabs.remove).toHaveBeenCalledWith(8)
  })
})

describe('background — context menu building', () => {
  it('builds the "Save to TabMerger" parent menu and per-scope submenus on init', () => {
    expect(stub.chrome.contextMenus.removeAll).toHaveBeenCalled()
    expect(stub.chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tm-add', title: 'Save to TabMerger' })
    )
  })

  it('shows "No saved groups yet" when there are no saved (non-permanent) groups', () => {
    expect(stub.chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tm-scope-current-none', title: 'No saved groups yet' })
    )
  })

  it('rebuilds menus on runtime.onInstalled', async () => {
    stub.chrome.contextMenus.create.mockClear()
    stub.listeners.onInstalled[0]({ reason: 'update' })
    await new Promise((r) => setTimeout(r, 0))
    expect(stub.chrome.contextMenus.create).toHaveBeenCalled()
  })

  it('excludes archived groups from the save-to-group scope submenus', async () => {
    mockGetGroupsState.mockResolvedValue({
      available: [
        { id: 'now', permanent: true, windows: [] },
        { id: 'g1', permanent: false, windows: [], name: 'Work' },
        { id: 'g2', permanent: false, archived: true, windows: [], name: 'Archived' },
      ],
      active: { id: 'now', index: 0 },
    })
    stub.chrome.contextMenus.create.mockClear()
    stub.listeners.onInstalled[0]({ reason: 'update' })
    await new Promise((r) => setTimeout(r, 0))
    const ids = stub.chrome.contextMenus.create.mock.calls.map((c) => c[0].id)
    expect(ids).toContain('tm-scope-current-g1')
    expect(ids).not.toContain('tm-scope-current-g2')
  })
})

describe('background — context menu rebuild on groups change (TM_GROUPS_CHANGED)', () => {
  it('registers a direct listener for in-SW writes (sendMessage cannot reach its own sender)', () => {
    expect(mockRegisterGroupsChangeListener).toHaveBeenCalledWith(expect.any(Function))
  })

  it('rebuilds the menu when notified via TM_GROUPS_CHANGED (popup-issued write)', async () => {
    stub.chrome.contextMenus.create.mockClear()
    stub.listeners.onMessage[0]({ type: 'TM_GROUPS_CHANGED' })
    await vi.waitFor(() => expect(stub.chrome.contextMenus.create).toHaveBeenCalled())
  })

  it('rebuilds the menu when the directly-registered listener fires (in-SW write)', async () => {
    stub.chrome.contextMenus.create.mockClear()
    const directListener = mockRegisterGroupsChangeListener.mock.calls[0][0] as () => void
    directListener()
    await vi.waitFor(() => expect(stub.chrome.contextMenus.create).toHaveBeenCalled())
  })

  it('coalesces a burst of notifications into a single rebuild', async () => {
    stub.chrome.contextMenus.removeAll.mockClear()
    stub.listeners.onMessage[0]({ type: 'TM_GROUPS_CHANGED' })
    stub.listeners.onMessage[0]({ type: 'TM_GROUPS_CHANGED' })
    stub.listeners.onMessage[0]({ type: 'TM_GROUPS_CHANGED' })
    await new Promise((r) => setTimeout(r, 200))
    expect(stub.chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1)
  })

  it('runs a follow-up rebuild with fresh groups when one is requested mid-build', async () => {
    // Make the in-flight build hang on getGroupsState so we can request another rebuild
    // while it's still running, then resolve with updated groups.
    let resolveFirst!: (v: Awaited<ReturnType<typeof mockGetGroupsState>>) => void
    mockGetGroupsState.mockReset().mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve })
    )
    stub.chrome.contextMenus.create.mockClear()

    stub.listeners.onMessage[0]({ type: 'TM_GROUPS_CHANGED' })
    await new Promise((r) => setTimeout(r, 200)) // let the debounce fire and the build start

    // A second change arrives WHILE the first build is still awaiting getGroupsState
    mockGetGroupsState.mockResolvedValue({
      available: [
        { id: 'now', permanent: true, windows: [] },
        { id: 'g1', permanent: false, windows: [], name: 'New Group' },
      ],
      active: { id: 'now', index: 0 },
    })
    stub.listeners.onMessage[0]({ type: 'TM_GROUPS_CHANGED' })

    resolveFirst({ available: [{ id: 'now', permanent: true, windows: [] }], active: { id: 'now', index: 0 } })

    await vi.waitFor(() => {
      const ids = stub.chrome.contextMenus.create.mock.calls.map((c) => c[0].id)
      expect(ids).toContain('tm-scope-current-g1')
    })
  })
})

describe('background — externally_connectable SYNC_AUTH (web app auth bridge)', () => {
  it('forwards the access/refresh token to supabase.auth.setSession', async () => {
    const { supabase } = await import('@/lib/supabase')
    const sendResponse = vi.fn()
    stub.listeners.onMessageExternal[0]({ type: 'SYNC_AUTH', accessToken: 'a', refreshToken: 'b' }, {}, sendResponse)
    expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'b' })
  })

  it('ignores SYNC_AUTH messages missing a token', async () => {
    const { supabase } = await import('@/lib/supabase')
    ;(supabase.auth.setSession as ReturnType<typeof vi.fn>).mockClear()
    const sendResponse = vi.fn()
    stub.listeners.onMessageExternal[0]({ type: 'SYNC_AUTH', accessToken: 'a' }, {}, sendResponse)
    expect(supabase.auth.setSession).not.toHaveBeenCalled()
  })
})

describe('background — SIGN_IN_WITH_GOOGLE message', () => {
  it('runs the OAuth flow and responds ok on success, keeping the channel open', () => {
    const sendResponse = vi.fn()
    const keepOpen = stub.listeners.onMessage[1]({ type: 'SIGN_IN_WITH_GOOGLE' }, {}, sendResponse)
    expect(keepOpen).toBe(true)
    expect(mockRunGoogleOAuthFlow).toHaveBeenCalled()
    return new Promise((resolve) => setTimeout(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true })
      resolve(undefined)
    }, 0))
  })

  it('responds with ok: false and the error message on failure', () => {
    mockRunGoogleOAuthFlow.mockRejectedValue(new Error('Google sign-in was cancelled'))
    const sendResponse = vi.fn()
    stub.listeners.onMessage[1]({ type: 'SIGN_IN_WITH_GOOGLE' }, {}, sendResponse)
    return new Promise((resolve) => setTimeout(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Google sign-in was cancelled' })
      resolve(undefined)
    }, 0))
  })

  it('ignores unrelated message types', () => {
    const sendResponse = vi.fn()
    const result = stub.listeners.onMessage[1]({ type: 'SYNC_AUTH' }, {}, sendResponse)
    expect(result).toBeUndefined()
    expect(mockRunGoogleOAuthFlow).not.toHaveBeenCalled()
  })
})

describe('background — externally_connectable PING (install probe)', () => {
  it('responds PONG with the manifest version', () => {
    const sendResponse = vi.fn()
    stub.listeners.onMessageExternal[0]({ type: 'PING' }, {}, sendResponse)
    expect(sendResponse).toHaveBeenCalledWith({ type: 'PONG', version: '2.9.0' })
  })

  it('ignores unrelated external message types', () => {
    const sendResponse = vi.fn()
    stub.listeners.onMessageExternal[0]({ type: 'OTHER' }, {}, sendResponse)
    expect(sendResponse).not.toHaveBeenCalled()
  })
})

describe('background — externally_connectable SYNC_NOW (web dashboard trigger)', () => {
  it('runs a real push+pull sync and responds ok: true', async () => {
    const sendResponse = vi.fn()
    const keepOpen = stub.listeners.onMessageExternal[0]({ type: 'SYNC_NOW' }, {}, sendResponse)
    expect(keepOpen).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(mockPerformSync).toHaveBeenCalledWith({ user: { id: 'u1' } })
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  it('responds ok: false, reason: no-session when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const sendResponse = vi.fn()
    stub.listeners.onMessageExternal[0]({ type: 'SYNC_NOW' }, {}, sendResponse)
    await new Promise((r) => setTimeout(r, 0))
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, reason: 'no-session' })
    expect(mockPerformSync).not.toHaveBeenCalled()
  })

  it('responds ok: false, reason: locked when encryption setup was never completed', async () => {
    mockHasEncryptionKey.mockResolvedValue(false)
    const sendResponse = vi.fn()
    stub.listeners.onMessageExternal[0]({ type: 'SYNC_NOW' }, {}, sendResponse)
    await new Promise((r) => setTimeout(r, 0))
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, reason: 'locked' })
    )
    expect(mockPerformSync).not.toHaveBeenCalled()
  })

  it('responds ok: false, reason: locked when the data key was never unlocked this worker lifetime', async () => {
    mockGetDataKey.mockResolvedValue(null)
    const sendResponse = vi.fn()
    stub.listeners.onMessageExternal[0]({ type: 'SYNC_NOW' }, {}, sendResponse)
    await new Promise((r) => setTimeout(r, 0))
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, reason: 'locked' })
    )
    expect(mockPerformSync).not.toHaveBeenCalled()
  })

  it('responds ok: false, reason: error on unexpected failure, without leaking group content', async () => {
    mockPerformSync.mockRejectedValue(new Error('network down'))
    const sendResponse = vi.fn()
    stub.listeners.onMessageExternal[0]({ type: 'SYNC_NOW' }, {}, sendResponse)
    await new Promise((r) => setTimeout(r, 0))
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, reason: 'error', message: 'network down' })
  })
})

describe('background — alarm helper messages', () => {
  it('creates an alarm for CREATE_ALARM', () => {
    stub.listeners.onMessage[0]({ type: 'CREATE_ALARM', name: 'reminder-1', delayInMinutes: 5 })
    expect(stub.chrome.alarms.create).toHaveBeenCalledWith('reminder-1', { delayInMinutes: 5 })
  })

  it('clears an alarm for CLEAR_ALARM', () => {
    stub.listeners.onMessage[0]({ type: 'CLEAR_ALARM', name: 'reminder-1' })
    expect(stub.chrome.alarms.clear).toHaveBeenCalledWith('reminder-1')
  })
})

describe('background — context menu click (save-to-group)', () => {
  it('ignores clicks with an unrecognized menu id', async () => {
    await stub.listeners.onClicked[0]({ menuItemId: 'unrelated' }, { windowId: 1, index: 0 })
    expect(mockSaveGroupsState).not.toHaveBeenCalled()
  })

  it('does nothing when the target group id does not match any saved group', async () => {
    stub.chrome.tabs.query.mockResolvedValue([{ id: 1, index: 0, url: 'https://a.com', title: 'A' }])
    await stub.listeners.onClicked[0](
      { menuItemId: 'tm-scope-current-nope' },
      { windowId: 1, index: 0, id: 1, url: 'https://a.com' }
    )
    expect(mockSaveGroupsState).not.toHaveBeenCalled()
  })

  it('appends a new window with the current tab to the matching saved group', async () => {
    mockGetGroupsState.mockResolvedValue({
      available: [
        { id: 'now', permanent: true, windows: [] },
        { id: 'g1', permanent: false, windows: [], name: 'Work' },
      ],
      active: { id: 'now', index: 0 },
    })
    const tab = { id: 1, index: 0, windowId: 1, url: 'https://a.com', title: 'A' }
    stub.chrome.tabs.query.mockResolvedValue([tab])
    await stub.listeners.onClicked[0]({ menuItemId: 'tm-scope-current-g1' }, tab)
    expect(mockSaveGroupsState).toHaveBeenCalled()
    const saved = mockSaveGroupsState.mock.calls[0][0]
    const g1 = saved.available.find((g: { id: string }) => g.id === 'g1')
    expect(g1.windows).toHaveLength(1)
    expect(g1.windows[0].tabs[0].url).toBe('https://a.com')
  })

  it('"excluding" scope keeps other real tabs but drops chrome:// tabs and the clicked tab itself', async () => {
    mockGetGroupsState.mockResolvedValue({
      available: [{ id: 'g1', permanent: false, windows: [], name: 'Work' }],
      active: { id: 'g1', index: 0 },
    })
    const clicked = { id: 1, index: 1, windowId: 1, url: 'https://clicked.com', title: 'Clicked' }
    const other = { id: 2, index: 2, windowId: 1, url: 'https://other.com', title: 'Other' }
    stub.chrome.tabs.query.mockResolvedValue([
      { id: 0, index: 0, url: 'chrome://extensions', title: 'Ext' },
      clicked,
      other,
    ])
    await stub.listeners.onClicked[0]({ menuItemId: 'tm-scope-excluding-g1' }, clicked)
    expect(mockSaveGroupsState).toHaveBeenCalled()
    const saved = mockSaveGroupsState.mock.calls[0][0]
    const g1 = saved.available.find((g: { id: string }) => g.id === 'g1')
    expect(g1.windows[0].tabs).toHaveLength(1)
    expect(g1.windows[0].tabs[0].url).toBe('https://other.com')
  })

  it('does not save when the resulting tab selection is empty (e.g. only chrome:// tabs)', async () => {
    mockGetGroupsState.mockResolvedValue({
      available: [{ id: 'g1', permanent: false, windows: [], name: 'Work' }],
      active: { id: 'g1', index: 0 },
    })
    const clicked = { id: 1, index: 1, windowId: 1, url: 'https://clicked.com', title: 'Clicked' }
    stub.chrome.tabs.query.mockResolvedValue([
      { id: 0, index: 0, url: 'chrome://extensions', title: 'Ext' },
      clicked,
    ])
    await stub.listeners.onClicked[0]({ menuItemId: 'tm-scope-excluding-g1' }, clicked)
    expect(mockSaveGroupsState).not.toHaveBeenCalled()
  })
})

describe('background — global keyboard shortcut (save-current-tab command)', () => {
  it('ignores unrelated command names', async () => {
    await stub.listeners.onCommand[0]('some-other-command')
    expect(stub.chrome.tabs.query).not.toHaveBeenCalled()
  })

  it('does nothing when there is no active tab or it is a chrome:// tab', async () => {
    stub.chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'chrome://newtab' }])
    await stub.listeners.onCommand[0]('save-current-tab')
    expect(mockSaveGroupsState).not.toHaveBeenCalled()
  })

  it('appends the active tab to the first non-permanent saved group', async () => {
    mockGetGroupsState.mockResolvedValue({
      available: [
        { id: 'now', permanent: true, windows: [] },
        { id: 'g1', permanent: false, windows: [], name: 'Work' },
      ],
      active: { id: 'now', index: 0 },
    })
    stub.chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com', title: 'A' }])
    await stub.listeners.onCommand[0]('save-current-tab')
    expect(mockSaveGroupsState).toHaveBeenCalled()
    const saved = mockSaveGroupsState.mock.calls[0][0]
    const g1 = saved.available.find((g: { id: string }) => g.id === 'g1')
    expect(g1.windows).toHaveLength(1)
    expect(g1.windows[0].tabs[0].url).toBe('https://a.com')
  })

  it('creates a new "Quick Save" group when no saved groups exist yet', async () => {
    mockGetGroupsState.mockResolvedValue({
      available: [{ id: 'now', permanent: true, windows: [] }],
      active: { id: 'now', index: 0 },
    })
    stub.chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com', title: 'A' }])
    await stub.listeners.onCommand[0]('save-current-tab')
    expect(mockSaveGroupsState).toHaveBeenCalled()
    const saved = mockSaveGroupsState.mock.calls[0][0]
    const quickSave = saved.available.find((g: { name: string }) => g.name === 'Quick Save')
    expect(quickSave).toBeDefined()
    expect(quickSave.windows[0].tabs[0].url).toBe('https://a.com')
  })
})

describe('background — global keyboard shortcut group picker', () => {
  it('stashes tabs in session storage and opens the popup instead of saving immediately when openPopup is supported', async () => {
    stub.chrome.action.openPopup = vi.fn().mockResolvedValue(undefined)
    stub.chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com', title: 'A' }])
    await stub.listeners.onCommand[0]('save-current-tab')

    expect(mockSaveGroupsState).not.toHaveBeenCalled()
    expect(stub.chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingShortcutSave: expect.objectContaining({
          scope: 'current',
          tabs: expect.arrayContaining([expect.objectContaining({ url: 'https://a.com' })]),
        }),
      })
    )
    expect(stub.chrome.action.openPopup).toHaveBeenCalled()
  })

  it('falls back to immediate save when openPopup is unsupported (e.g. Firefox MV2)', async () => {
    mockGetGroupsState.mockResolvedValue({
      available: [
        { id: 'now', permanent: true, windows: [] },
        { id: 'g1', permanent: false, windows: [], name: 'Work' },
      ],
      active: { id: 'now', index: 0 },
    })
    stub.chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com', title: 'A' }])
    await stub.listeners.onCommand[0]('save-current-tab')

    expect(stub.chrome.storage.session.set).not.toHaveBeenCalled()
    expect(mockSaveGroupsState).toHaveBeenCalled()
  })

  it('falls back to immediate save when openPopup rejects', async () => {
    stub.chrome.action.openPopup = vi.fn().mockRejectedValue(new Error('no recent user gesture'))
    mockGetGroupsState.mockResolvedValue({
      available: [
        { id: 'now', permanent: true, windows: [] },
        { id: 'g1', permanent: false, windows: [], name: 'Work' },
      ],
      active: { id: 'now', index: 0 },
    })
    stub.chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com', title: 'A' }])
    await stub.listeners.onCommand[0]('save-current-tab')

    expect(stub.chrome.action.openPopup).toHaveBeenCalled()
    expect(mockSaveGroupsState).toHaveBeenCalled()
  })
})

describe('background — global keyboard shortcuts (save-tabs-left / save-tabs-right / save-other-tabs)', () => {
  beforeEach(() => {
    mockGetGroupsState.mockResolvedValue({
      available: [
        { id: 'now', permanent: true, windows: [] },
        { id: 'g1', permanent: false, windows: [], name: 'Work' },
      ],
      active: { id: 'now', index: 0 },
    })
  })

  const allTabs = [
    { id: 1, index: 0, windowId: 1, url: 'https://left.com', title: 'Left' },
    { id: 2, index: 1, windowId: 1, url: 'https://active.com', title: 'Active' },
    { id: 3, index: 2, windowId: 1, url: 'https://right.com', title: 'Right' },
  ]

  it('save-tabs-left appends only tabs with index < active tab index', async () => {
    stub.chrome.tabs.query
      .mockResolvedValueOnce([allTabs[1]]) // active tab lookup
      .mockResolvedValueOnce(allTabs) // window tab list
    await stub.listeners.onCommand[0]('save-tabs-left')
    const saved = mockSaveGroupsState.mock.calls[0][0]
    const g1 = saved.available.find((g: { id: string }) => g.id === 'g1')
    expect(g1.windows[0].tabs.map((t: { url: string }) => t.url)).toEqual(['https://left.com'])
  })

  it('save-tabs-right appends only tabs with index > active tab index', async () => {
    stub.chrome.tabs.query
      .mockResolvedValueOnce([allTabs[1]])
      .mockResolvedValueOnce(allTabs)
    await stub.listeners.onCommand[0]('save-tabs-right')
    const saved = mockSaveGroupsState.mock.calls[0][0]
    const g1 = saved.available.find((g: { id: string }) => g.id === 'g1')
    expect(g1.windows[0].tabs.map((t: { url: string }) => t.url)).toEqual(['https://right.com'])
  })

  it('save-other-tabs appends every tab except the active one', async () => {
    stub.chrome.tabs.query
      .mockResolvedValueOnce([allTabs[1]])
      .mockResolvedValueOnce(allTabs)
    await stub.listeners.onCommand[0]('save-other-tabs')
    const saved = mockSaveGroupsState.mock.calls[0][0]
    const g1 = saved.available.find((g: { id: string }) => g.id === 'g1')
    expect(g1.windows[0].tabs.map((t: { url: string }) => t.url)).toEqual(['https://left.com', 'https://right.com'])
  })

  it('drops chrome:// tabs from the left/right/excluding selection', async () => {
    const withChrome = [
      { id: 0, index: 0, windowId: 1, url: 'chrome://newtab', title: 'NTP' },
      allTabs[1],
      allTabs[2],
    ]
    stub.chrome.tabs.query
      .mockResolvedValueOnce([allTabs[1]])
      .mockResolvedValueOnce(withChrome)
    await stub.listeners.onCommand[0]('save-tabs-left')
    expect(mockSaveGroupsState).not.toHaveBeenCalled() // only the chrome:// tab was to the left, filtered out
  })

  it('does nothing when the active tab is a chrome:// tab', async () => {
    stub.chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'chrome://newtab' }])
    await stub.listeners.onCommand[0]('save-tabs-right')
    expect(mockSaveGroupsState).not.toHaveBeenCalled()
  })
})

describe('background — badge updates', () => {
  it('sets the badge text to the live tab count, excluding chrome:// tabs', async () => {
    stub.chrome.windows.getAll.mockResolvedValue([
      { tabs: [{ url: 'https://a.com' }, { url: 'chrome://newtab' }] },
    ])
    stub.listeners.tabsOnCreated[0]({ url: 'https://a.com' })
    await new Promise((r) => setTimeout(r, 0))
    expect(stub.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '1' })
  })

  it('clears the badge text when there are no non-chrome tabs', async () => {
    stub.chrome.windows.getAll.mockResolvedValue([{ tabs: [] }])
    stub.listeners.tabsOnRemoved[0]()
    await new Promise((r) => setTimeout(r, 0))
    expect(stub.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' })
  })
})

describe('background — URL rule auto-apply on tab created/updated', () => {
  it('applies a matching URL rule when a new tab is created', async () => {
    mockGetAllUrlRules.mockResolvedValue([{ id: 'r1', pattern: 'example.com', groupId: 'g1' }])
    mockMatchUrlToRule.mockReturnValue('g1')
    stub.chrome.windows.getAll.mockResolvedValue([{ tabs: [] }])
    const tab = { id: 1, url: 'https://example.com', title: 'Example' }
    stub.listeners.tabsOnCreated[0](tab)
    await vi.waitFor(() => expect(mockApplyUrlRule).toHaveBeenCalledWith(tab, 'g1'))
  })

  it('does not attempt to apply a rule for a chrome:// tab on create', async () => {
    stub.chrome.windows.getAll.mockResolvedValue([{ tabs: [] }])
    stub.listeners.tabsOnCreated[0]({ id: 1, url: 'chrome://newtab' })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockGetAllUrlRules).not.toHaveBeenCalled()
  })

  it('applies a matching URL rule when a tab finishes loading (status complete)', async () => {
    mockGetAllUrlRules.mockResolvedValue([{ id: 'r1', pattern: 'example.com', groupId: 'g1' }])
    mockMatchUrlToRule.mockReturnValue('g1')
    stub.chrome.windows.getAll.mockResolvedValue([{ tabs: [] }])
    const tab = { id: 1, url: 'https://example.com', title: 'Example' }
    stub.listeners.tabsOnUpdated[0](1, { status: 'complete' }, tab)
    await vi.waitFor(() => expect(mockApplyUrlRule).toHaveBeenCalledWith(tab, 'g1'))
  })

  it('ignores tab updates that are not status=complete', async () => {
    stub.listeners.tabsOnUpdated[0](1, { status: 'loading' }, { id: 1, url: 'https://example.com' })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockGetAllUrlRules).not.toHaveBeenCalled()
  })

  it('logs an error without throwing when the URL rule engine rejects', async () => {
    mockGetAllUrlRules.mockRejectedValue(new Error('boom'))
    stub.chrome.windows.getAll.mockResolvedValue([{ tabs: [] }])
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stub.listeners.tabsOnCreated[0]({ id: 1, url: 'https://example.com' })
    await vi.waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith('[urlRules] onCreated error:', expect.any(Error))
    )
    consoleSpy.mockRestore()
  })
})

describe('background — reminder notifications', () => {
  it('creates a notification when a reminder- alarm fires with stored data', async () => {
    stub.chrome.storage.local.get.mockResolvedValue({ 'reminder-1': { url: 'https://a.com', title: 'Tab', note: 'note' } })
    await stub.listeners.onAlarm[0]({ name: 'reminder-1' })
    expect(stub.chrome.notifications.create).toHaveBeenCalledWith('reminder-1', expect.objectContaining({ title: 'TabMerger Reminder' }))
  })

  it('ignores alarms not prefixed with "reminder-"', async () => {
    await stub.listeners.onAlarm[0]({ name: 'other-alarm' })
    expect(stub.chrome.notifications.create).not.toHaveBeenCalled()
  })

  it('opens the reminder URL and clears the notification on click', async () => {
    stub.chrome.storage.local.get.mockResolvedValue({ 'reminder-1': { url: 'https://a.com', title: 'Tab', note: '' } })
    await stub.listeners.notifOnClicked[0]('reminder-1')
    expect(stub.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://a.com', active: true })
    expect(stub.chrome.notifications.clear).toHaveBeenCalledWith('reminder-1')
  })
})

// Firefox-only web-bridge (web-bridge.content.ts) — its relayed messages land on this
// listener, the 3rd onMessage.addListener call registered by background.ts (after the
// alarms/TM_GROUPS_CHANGED listener and the SIGN_IN_WITH_GOOGLE listener). Ambient
// VITE_WEB_APP_URL for vitest is 'http://localhost:3000' (.env.local, loaded by Vite's
// default env resolution — same fact TabPreview.test.tsx's ponytail comment relies on).
describe('background — Firefox web-bridge internal onMessage listener', () => {
  const WEB_APP_SENDER = { id: 'this-extension-id', url: 'http://localhost:3000/dashboard' }

  it('responds to PING from the content script sender', () => {
    const sendResponse = vi.fn()
    stub.listeners.onMessage[2]({ type: EXTENSION_MESSAGE.PING }, WEB_APP_SENDER, sendResponse)
    expect(sendResponse).toHaveBeenCalledWith({ type: EXTENSION_MESSAGE.PONG, version: '2.9.0' })
  })

  it('runs SYNC_NOW and keeps the channel open, same as the external listener', async () => {
    const sendResponse = vi.fn()
    const keepOpen = stub.listeners.onMessage[2]({ type: EXTENSION_MESSAGE.SYNC_NOW }, WEB_APP_SENDER, sendResponse)
    expect(keepOpen).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  it('forwards SYNC_AUTH tokens to supabase.auth.setSession', async () => {
    const { supabase } = await import('@/lib/supabase')
    const sendResponse = vi.fn()
    stub.listeners.onMessage[2](
      { type: EXTENSION_MESSAGE.SYNC_AUTH, accessToken: 'a', refreshToken: 'b' },
      WEB_APP_SENDER,
      sendResponse
    )
    expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'b' })
  })

  describe('Firefox: SYNC_AUTH is gated on sign-in consent already being granted', () => {
    beforeEach(() => {
      vi.stubEnv('FIREFOX', 'true')
    })
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('accepts the session and responds ok:true when consent is already granted', async () => {
      const { EXTENSION_MESSAGE: EM, SIGN_IN_DATA_CONSENT_CATEGORIES } = await import('@tabmerger/shared')
      mockHasDataConsent.mockResolvedValue(true)
      const { supabase } = await import('@/lib/supabase')
      const sendResponse = vi.fn()
      const keepOpen = stub.listeners.onMessage[2](
        { type: EM.SYNC_AUTH, accessToken: 'a', refreshToken: 'b' },
        WEB_APP_SENDER,
        sendResponse
      )
      expect(keepOpen).toBe(true)
      await new Promise((r) => setTimeout(r, 0))
      expect(mockHasDataConsent).toHaveBeenCalledWith(SIGN_IN_DATA_CONSENT_CATEGORIES)
      expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'b' })
      expect(sendResponse).toHaveBeenCalledWith({ ok: true })
    })

    it('rejects with consent_required and never calls setSession when consent is not granted', async () => {
      const { EXTENSION_MESSAGE: EM, SYNC_AUTH_CONSENT_REQUIRED_REASON } = await import('@tabmerger/shared')
      mockHasDataConsent.mockResolvedValue(false)
      const { supabase } = await import('@/lib/supabase')
      // ponytail: this mock's `setSession` is created once by the `vi.mock('@/lib/supabase', ...)`
      // factory and — unlike the hoisted named mocks above — is NOT cleared by the outer
      // beforeEach's `vi.resetModules()`, so calls from earlier tests in this file (which use the
      // same literal 'a'/'b' tokens) accumulate on it. Clear immediately before acting.
      vi.mocked(supabase.auth.setSession).mockClear()
      const sendResponse = vi.fn()
      stub.listeners.onMessage[2](
        { type: EM.SYNC_AUTH, accessToken: 'a', refreshToken: 'b' },
        WEB_APP_SENDER,
        sendResponse
      )
      await new Promise((r) => setTimeout(r, 0))
      expect(supabase.auth.setSession).not.toHaveBeenCalled()
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, reason: SYNC_AUTH_CONSENT_REQUIRED_REASON })
    })

    it('PING still works without any consent check on Firefox', () => {
      mockHasDataConsent.mockResolvedValue(false)
      const sendResponse = vi.fn()
      stub.listeners.onMessage[2]({ type: EXTENSION_MESSAGE.PING }, WEB_APP_SENDER, sendResponse)
      expect(sendResponse).toHaveBeenCalledWith({ type: EXTENSION_MESSAGE.PONG, version: '2.9.0' })
    })
  })

  it('rejects a sender whose id is not this extension (a foreign sender)', () => {
    const sendResponse = vi.fn()
    const result = stub.listeners.onMessage[2](
      { type: EXTENSION_MESSAGE.PING },
      { id: 'some-other-extension', url: 'http://localhost:3000/dashboard' },
      sendResponse
    )
    expect(result).toBeUndefined()
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it('rejects a sender whose url origin is not the web app origin', () => {
    const sendResponse = vi.fn()
    stub.listeners.onMessage[2](
      { type: EXTENSION_MESSAGE.PING },
      { id: 'this-extension-id', url: 'https://evil.example.com/' },
      sendResponse
    )
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it('rejects a sender with a missing url', () => {
    const sendResponse = vi.fn()
    stub.listeners.onMessage[2]({ type: EXTENSION_MESSAGE.PING }, { id: 'this-extension-id' }, sendResponse)
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it('rejects an unrelated message type even from a valid sender', () => {
    // Deliberately a literal, not a constant — asserting an unrelated internal message type
    // (not one of the three bridge messages) is correctly ignored by this listener.
    const sendResponse = vi.fn()
    const result = stub.listeners.onMessage[2]({ type: 'TM_GROUPS_CHANGED' }, WEB_APP_SENDER, sendResponse)
    expect(result).toBeUndefined()
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it('rejects a malformed sender.url that fails URL parsing', () => {
    const sendResponse = vi.fn()
    stub.listeners.onMessage[2](
      { type: EXTENSION_MESSAGE.PING },
      { id: 'this-extension-id', url: 'not a url' },
      sendResponse
    )
    expect(sendResponse).not.toHaveBeenCalled()
  })
})
