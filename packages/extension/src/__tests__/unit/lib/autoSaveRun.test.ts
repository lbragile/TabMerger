import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AUTO_SAVE_ALARM_NAME, AUTO_SAVE_MESSAGE } from '@tabmerger/shared'
import type { Group, GroupsState } from '@/lib/types'
import { APP_SETTINGS_KEY, AUTO_SAVE_STATE_KEY, AUTO_SAVE_TIER_SEEN_KEY, LAST_USER_ID_KEY } from '@/lib/syncSettingKeys'

const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  groups: null as unknown as { active: { id: string; index: number }; available: unknown[] },
  session: null as null | { user: { id: string } },
  tier: 'pro' as string | null,
  writes: 0,
}))

vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn(async (k: string, d: unknown) => (h.settings.has(k) ? h.settings.get(k) : d)),
  setSetting: vi.fn(async (k: string, v: unknown) => void h.settings.set(k, v)),
  updateGroupsState: vi.fn(async (fn: (s: unknown) => unknown) => {
    const next = fn(h.groups)
    if (next) {
      h.writes++
      h.groups = next as typeof h.groups
    }
    return h.groups
  }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: h.session } })) } },
}))
vi.mock('@/lib/entitlementTier', () => ({ fetchTier: vi.fn(async () => h.tier) }))

import { armAutoSaveAlarm, checkTabThreshold, registerAutoSave, resolveRunTier, runAutoSave } from '@/lib/autoSaveRun'
import { fetchTier } from '@/lib/entitlementTier'

const NOW = Date.UTC(2030, 10, 5, 14, 30)
const flush = () => new Promise((r) => setTimeout(r, 0))
const nowOpen: Group = { id: 'now', name: 'Now Open', color: 'c', updatedAt: 1, windows: [], permanent: true }
const auto = (id: string, at: number, url: string): Group => ({
  id, name: id, color: 'c', updatedAt: 1, autoSave: { at, rolling: true },
  windows: [{ id: 1, tabs: [{ id: 0, title: url, url }], incognito: false, focused: false }],
})

type Fn = ReturnType<typeof vi.fn>
let chromeStub: {
  tabs: { query: Fn; onCreated: { addListener: Fn }; onRemoved: { addListener: Fn } }
  windows: { getAll: Fn }
  tabGroups: { query: Fn }
  alarms: { get: Fn; create: Fn; clear: Fn; onAlarm: { addListener: Fn } }
  notifications: { create: Fn }
  storage: { session: { get: Fn; set: Fn } }
  runtime: { id: string; getURL: (p: string) => string; lastError: unknown; sendMessage: Fn; onStartup: { addListener: Fn }; onMessage: { addListener: Fn } }
}
let sessionStore: Record<string, unknown>

beforeEach(() => {
  h.settings.clear()
  h.groups = { active: { id: 'now', index: 0 }, available: [nowOpen] }
  h.session = null
  h.tier = 'pro'
  h.writes = 0
  sessionStore = {}
  vi.mocked(fetchTier).mockClear()
  chromeStub = {
    tabs: {
      query: vi.fn(async () => [
        { windowId: 1, index: 0, url: 'https://a.test/', title: 'A' },
        { windowId: 1, index: 1, url: 'https://b.test/', title: 'B' },
      ]),
      onCreated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    },
    windows: { getAll: vi.fn(async () => [{ id: 1, type: 'normal', incognito: false }]) },
    tabGroups: { query: vi.fn(async () => []) },
    alarms: { get: vi.fn().mockResolvedValue(undefined), create: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(true), onAlarm: { addListener: vi.fn() } },
    notifications: { create: vi.fn() },
    storage: {
      session: {
        get: vi.fn(async (k: string) => (k in sessionStore ? { [k]: sessionStore[k] } : {})),
        set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(sessionStore, o)),
      },
    },
    runtime: {
      id: 'ext',
      getURL: (p: string) => `chrome-extension://ext/${p}`,
      lastError: undefined,
      sendMessage: vi.fn(),
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
  }
  ;(globalThis as { chrome?: unknown }).chrome = chromeStub
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const savedGroups = () => (h.groups.available as Group[]).filter((g) => !g.permanent)

describe('resolveRunTier', () => {
  it('signed out is a confirmed Free plan, with no request', async () => {
    expect(await resolveRunTier(NOW)).toEqual({ kind: 'confirmed', tier: 'free' })
    expect(fetchTier).not.toHaveBeenCalled()
  })
  it('signed out on a store an account still owns: unknown (never removes), with the remembered plan', async () => {
    h.settings.set(LAST_USER_ID_KEY, 'u1')
    h.settings.set(AUTO_SAVE_TIER_SEEN_KEY, { tier: 'pro', at: 1 })
    expect(await resolveRunTier(NOW)).toEqual({ kind: 'unknown', remembered: 'pro' })
    expect(fetchTier).not.toHaveBeenCalled()
  })
  it('signed in: asks the server and remembers the answer', async () => {
    h.session = { user: { id: 'u1' } }
    expect(await resolveRunTier(NOW)).toEqual({ kind: 'confirmed', tier: 'pro' })
    expect(h.settings.get(AUTO_SAVE_TIER_SEEN_KEY)).toEqual({ tier: 'pro', at: NOW })
  })
  it('a failed check is unknown, with the remembered answer', async () => {
    h.session = { user: { id: 'u1' } }
    h.tier = null
    h.settings.set(AUTO_SAVE_TIER_SEEN_KEY, { tier: 'pro', at: 1 })
    expect(await resolveRunTier(NOW)).toEqual({ kind: 'unknown', remembered: 'pro' })
  })
  it('a store owned by another account blocks', async () => {
    h.session = { user: { id: 'u1' } }
    h.settings.set(LAST_USER_ID_KEY, 'someone-else')
    expect(await resolveRunTier(NOW)).toBe('account-mismatch')
  })
})

describe('runAutoSave', () => {
  it('Pro with the switch never touched: on by default, writes one pending group and remembers the outcome', async () => {
    h.session = { user: { id: 'u1' } }
    const outcome = await runAutoSave({ trigger: 'alarm', now: NOW })
    expect(outcome).toMatchObject({ status: 'saved', saved: 2, total: 2, replaced: 0 })
    expect(h.writes).toBe(1)
    expect(savedGroups()[0]).toMatchObject({ pendingSync: true, autoSave: { at: NOW, rolling: false } })
    expect(h.settings.get(AUTO_SAVE_STATE_KEY)).toMatchObject({ lastScheduledAt: NOW, last: { status: 'saved' } })
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({ type: AUTO_SAVE_MESSAGE.STATUS_CHANGED }, expect.any(Function))
    expect(chromeStub.notifications.create).not.toHaveBeenCalled()
  })

  it('a switch turned off stops scheduled runs before any request', async () => {
    h.session = { user: { id: 'u1' } }
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: false })
    expect(await runAutoSave({ trigger: 'alarm', now: NOW })).toEqual({ status: 'skipped', at: NOW, reason: 'disabled' })
    expect(fetchTier).not.toHaveBeenCalled()
    expect(h.writes).toBe(0)
  })

  it('Free with the switch never touched: off by default; a manual run still works and rolls', async () => {
    expect(await runAutoSave({ trigger: 'alarm', now: NOW })).toMatchObject({ status: 'skipped', reason: 'disabled' })
    const manual = await runAutoSave({ trigger: 'manual', now: NOW })
    expect(manual).toMatchObject({ status: 'saved' })
    expect(savedGroups()[0].autoSave).toEqual({ at: NOW, rolling: true })
    // a manual run does not move the schedule
    expect(h.settings.get(AUTO_SAVE_STATE_KEY)).not.toHaveProperty('lastScheduledAt')
  })

  it('a scheduled run is skipped until the interval has passed; no schedule is never due', async () => {
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true })
    h.settings.set(AUTO_SAVE_STATE_KEY, { lastScheduledAt: NOW - 10 * 60_000 })
    expect(await runAutoSave({ trigger: 'startup', now: NOW })).toMatchObject({ reason: 'not-due' })
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true, autoSaveIntervalMinutes: 0 })
    h.settings.delete(AUTO_SAVE_STATE_KEY)
    expect(await runAutoSave({ trigger: 'settings', now: NOW })).toMatchObject({ reason: 'not-due' })
  })

  it('a threshold run without a threshold does nothing', async () => {
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true, autoSaveTabThreshold: 0 })
    expect(await runAutoSave({ trigger: 'threshold', now: NOW })).toMatchObject({ reason: 'disabled' })
  })

  it('Free rolling: the oldest of two is replaced in the same write', async () => {
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true })
    h.groups = { active: { id: 'now', index: 0 }, available: [nowOpen, auto('r1', 1, 'https://a.test/'), auto('r2', 2, 'https://x.test/')] }
    const outcome = await runAutoSave({ trigger: 'manual', now: NOW })
    expect(outcome).toMatchObject({ status: 'saved', replaced: 1, saved: 2 })
    expect(h.writes).toBe(1)
    expect(savedGroups().map((g) => g.id)).toEqual(['r2', expect.any(String)])
  })

  it('unknown plan never removes anything', async () => {
    h.session = { user: { id: 'u1' } }
    h.tier = null
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true })
    h.groups = { active: { id: 'now', index: 0 }, available: [nowOpen, auto('r1', 1, 'https://q.test/'), auto('r2', 2, 'https://x.test/')] }
    expect(await runAutoSave({ trigger: 'manual', now: NOW })).toMatchObject({ status: 'saved', replaced: 0 })
    expect(savedGroups().map((g) => g.id).slice(0, 2)).toEqual(['r1', 'r2'])
  })

  it('nothing new: no write, remembered as nothing-new; notification only on a save or a Free limit skip', async () => {
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true, autoSaveNotify: true })
    h.groups = { active: { id: 'now', index: 0 }, available: [nowOpen, { ...auto('k', 1, 'https://a.test/'), windows: [{ id: 1, tabs: [{ id: 0, title: '', url: 'https://a.test/' }, { id: 0, title: '', url: 'https://b.test/' }], incognito: false, focused: false }] }] }
    expect(await runAutoSave({ trigger: 'manual', now: NOW })).toMatchObject({ reason: 'nothing-new' })
    expect(h.writes).toBe(0)
    expect(chromeStub.notifications.create).not.toHaveBeenCalled()

    const five = Array.from({ length: 5 }, (_, i): Group => ({ id: `g${i}`, name: 'g', color: 'c', updatedAt: 1, windows: [] }))
    h.groups = { active: { id: 'now', index: 0 }, available: [nowOpen, ...five] }
    expect(await runAutoSave({ trigger: 'manual', now: NOW })).toMatchObject({ reason: 'no-group-slot' })
    expect(chromeStub.notifications.create).toHaveBeenCalledTimes(1)
    expect(h.groups.available).toHaveLength(6)

    h.groups = { active: { id: 'now', index: 0 }, available: [nowOpen] }
    expect(await runAutoSave({ trigger: 'manual', now: NOW + 1 })).toMatchObject({ status: 'saved' })
    expect(chromeStub.notifications.create).toHaveBeenCalledTimes(2)
  })

  it('account mismatch is remembered and nothing is written', async () => {
    h.session = { user: { id: 'u1' } }
    h.settings.set(LAST_USER_ID_KEY, 'other')
    expect(await runAutoSave({ trigger: 'manual', now: NOW })).toMatchObject({ reason: 'account-mismatch' })
    expect(h.writes).toBe(0)
    expect(h.settings.get(AUTO_SAVE_STATE_KEY)).toMatchObject({ last: { reason: 'account-mismatch' } })
  })

  it('one run at a time: a second concurrent run is busy', async () => {
    let release!: () => void
    chromeStub.tabs.query.mockImplementationOnce(() => new Promise((r) => (release = () => r([]))))
    const first = runAutoSave({ trigger: 'manual', now: NOW })
    await flush()
    await flush()
    expect(await runAutoSave({ trigger: 'manual', now: NOW })).toMatchObject({ reason: 'busy' })
    release()
    expect(await first).toMatchObject({ status: 'skipped', reason: 'no-tabs' })
  })

  it('a throw becomes an error outcome', async () => {
    chromeStub.windows.getAll.mockRejectedValueOnce(new Error('x'))
    expect(await runAutoSave({ trigger: 'manual', now: NOW })).toEqual({ status: 'error', at: NOW })
  })
})

describe('armAutoSaveAlarm', () => {
  it('clears when off (Free default) or without a schedule', async () => {
    await armAutoSaveAlarm()
    expect(chromeStub.alarms.clear).toHaveBeenCalledWith(AUTO_SAVE_ALARM_NAME)
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true, autoSaveIntervalMinutes: 0 })
    await armAutoSaveAlarm()
    expect(chromeStub.alarms.create).not.toHaveBeenCalled()
  })
  it('a remembered paid plan arms the default schedule; a matching alarm is left alone', async () => {
    h.settings.set(AUTO_SAVE_TIER_SEEN_KEY, { tier: 'pro_ai', at: 1 })
    await armAutoSaveAlarm()
    expect(chromeStub.alarms.create).toHaveBeenCalledWith(AUTO_SAVE_ALARM_NAME, { delayInMinutes: 60, periodInMinutes: 60 })
    chromeStub.alarms.create.mockClear()
    chromeStub.alarms.get.mockResolvedValue({ name: AUTO_SAVE_ALARM_NAME, periodInMinutes: 60 })
    await armAutoSaveAlarm()
    expect(chromeStub.alarms.create).not.toHaveBeenCalled()
  })
  it('does nothing without chrome.alarms', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {}
    await expect(armAutoSaveAlarm()).resolves.toBeUndefined()
  })
})

describe('checkTabThreshold', () => {
  const tabs = (n: number) => Array.from({ length: n }, (_, i) => ({ windowId: 1, index: i, url: `https://t${i}.test/` }))

  it('off: no tab query', async () => {
    expect(await checkTabThreshold(NOW)).toBeNull()
    expect(chromeStub.tabs.query).not.toHaveBeenCalled()
  })

  it('runs once above the threshold, stays quiet for the burst, re-arms below it', async () => {
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true, autoSaveTabThreshold: 20, autoSaveIntervalMinutes: 0 })
    chromeStub.tabs.query.mockResolvedValue(tabs(21))
    expect(await checkTabThreshold(NOW)).toMatchObject({ status: 'saved' })
    expect(sessionStore.tmAutoSaveThreshold).toEqual({ armed: false, lastRunAt: NOW })
    chromeStub.tabs.query.mockResolvedValue(tabs(22))
    expect(await checkTabThreshold(NOW + 1000)).toBeNull()
    chromeStub.tabs.query.mockResolvedValue(tabs(20))
    expect(await checkTabThreshold(NOW + 2000)).toBeNull()
    expect(sessionStore.tmAutoSaveThreshold).toEqual({ armed: true, lastRunAt: NOW })
  })

  it('falls back to memory without storage.session', async () => {
    ;(chromeStub as { storage: unknown }).storage = {}
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true, autoSaveTabThreshold: 20 })
    chromeStub.tabs.query.mockResolvedValue(tabs(25))
    // (a day later: the memory copy of an earlier test's run is within the minimum gap)
    expect(await checkTabThreshold(NOW + 86_400_000)).not.toBeNull()
  })
})

describe('registerAutoSave', () => {
  const ownPage = { id: 'ext', url: 'chrome-extension://ext/popup.html' }

  it('registers its listeners and handles RUN_NOW only from the extension pages', async () => {
    registerAutoSave()
    await flush()
    expect(chromeStub.runtime.onStartup.addListener).toHaveBeenCalledTimes(1)
    expect(chromeStub.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1)
    expect(chromeStub.tabs.onCreated.addListener).toHaveBeenCalledTimes(1)
    expect(chromeStub.tabs.onRemoved.addListener).toHaveBeenCalledTimes(1)
    const onMessage = chromeStub.runtime.onMessage.addListener.mock.calls[0][0] as (m: unknown, s: unknown, r: (x: unknown) => void) => unknown

    const reply = vi.fn()
    expect(onMessage({ type: 'other' }, ownPage, reply)).toBeUndefined()
    expect(onMessage({ type: AUTO_SAVE_MESSAGE.RUN_NOW }, { id: 'ext', url: 'https://evil.test/' }, reply)).toBeUndefined()
    expect(onMessage({ type: AUTO_SAVE_MESSAGE.RUN_NOW }, ownPage, reply)).toBe(true)
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ status: 'saved' })))

    expect(onMessage({ type: AUTO_SAVE_MESSAGE.SETTINGS_CHANGED }, ownPage, reply)).toBeUndefined()
    await vi.waitFor(() => expect(chromeStub.alarms.clear).toHaveBeenCalled())
  })

  it('the alarm runs a scheduled save; other alarms are ignored', async () => {
    h.settings.set(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true })
    registerAutoSave()
    const onAlarm = chromeStub.alarms.onAlarm.addListener.mock.calls[0][0] as (a: { name: string }) => void
    await vi.waitFor(() => expect(h.writes).toBe(1)) // the start-up check: never ran, so due
    chromeStub.alarms.get.mockClear()
    onAlarm({ name: 'reminder-x' })
    await flush()
    expect(chromeStub.alarms.get).not.toHaveBeenCalled()
    onAlarm({ name: AUTO_SAVE_ALARM_NAME })
    // not due again right after the start-up save: nothing written, the alarm is re-checked
    await vi.waitFor(() => expect(chromeStub.alarms.get).toHaveBeenCalled())
    expect(h.writes).toBe(1)
  })

  it('does nothing without chrome.alarms', () => {
    ;(globalThis as { chrome?: unknown }).chrome = { runtime: chromeStub.runtime }
    registerAutoSave()
    expect(chromeStub.runtime.onMessage.addListener).not.toHaveBeenCalled()
  })
})
