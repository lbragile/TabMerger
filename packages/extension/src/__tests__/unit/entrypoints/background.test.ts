import { describe, it, expect, vi, beforeEach } from 'vitest'

type BgConfig = { main: () => void } | (() => void)
let capturedMain: (() => void) | undefined
;(globalThis as unknown as { defineBackground: (fn: () => void) => void }).defineBackground = (fn) => {
  capturedMain = fn
}

const { mockGetGroupsState, mockSaveGroupsState, mockGetAllUrlRules, mockMatchUrlToRule, mockApplyUrlRule, mockRunGoogleOAuthFlow } = vi.hoisted(() => ({
  mockGetGroupsState: vi.fn(),
  mockSaveGroupsState: vi.fn().mockResolvedValue(undefined),
  mockGetAllUrlRules: vi.fn().mockResolvedValue([]),
  mockMatchUrlToRule: vi.fn().mockReturnValue(null),
  mockApplyUrlRule: vi.fn().mockResolvedValue(undefined),
  mockRunGoogleOAuthFlow: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/googleOAuthFlow', () => ({ runGoogleOAuthFlow: mockRunGoogleOAuthFlow }))

vi.mock('@/lib/localDb', () => ({
  getGroupsState: mockGetGroupsState,
  saveGroupsState: mockSaveGroupsState,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { setSession: vi.fn() } },
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
        getURL: vi.fn().mockReturnValue('icon.png'),
      },
      contextMenus: {
        removeAll: vi.fn().mockResolvedValue(undefined),
        create: vi.fn(),
        onClicked: on('onClicked'),
      },
      storage: { local: { get: vi.fn().mockResolvedValue({}), remove: vi.fn() } },
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
      },
      windows: {
        getAll: vi.fn().mockResolvedValue([]),
      },
      action: {
        setBadgeText: vi.fn().mockResolvedValue(undefined),
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
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
  capturedMain = undefined
  stub = makeChromeStub()
  globalThis.chrome = stub.chrome as unknown as typeof chrome
  mockGetGroupsState.mockResolvedValue({ available: [{ id: 'now', permanent: true, windows: [] }], active: { id: 'now', index: 0 } })
  await import('@/entrypoints/background')
  capturedMain!()
  await new Promise((r) => setTimeout(r, 0)) // flush initial buildMenus/reRegisterReminders
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
})

describe('background — SYNC_AUTH message', () => {
  it('forwards the access/refresh token to supabase.auth.setSession', async () => {
    const { supabase } = await import('@/lib/supabase')
    stub.listeners.onMessage[0]({ type: 'SYNC_AUTH', accessToken: 'a', refreshToken: 'b' })
    expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'b' })
  })

  it('ignores SYNC_AUTH messages missing a token', async () => {
    const { supabase } = await import('@/lib/supabase')
    ;(supabase.auth.setSession as ReturnType<typeof vi.fn>).mockClear()
    stub.listeners.onMessage[0]({ type: 'SYNC_AUTH', accessToken: 'a' })
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
