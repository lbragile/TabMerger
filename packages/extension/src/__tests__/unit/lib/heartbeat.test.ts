import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ANALYTICS_EVENTS,
  HEARTBEAT_ALARM_NAME,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_LAST_SENT_STORAGE_KEY,
  HEARTBEAT_TIER_STORAGE_KEY,
  INSTALLED_AT_STORAGE_KEY,
} from '@tabmerger/shared'

/**
 * lib/heartbeat: the daily extension_heartbeat. At most once per 24h, sent on a stale worker
 * start, gated on analytics consent, alarm re-armed without restarting its countdown, and only
 * coarse, non-personal params.
 */

const { mockTrackEvent, mockHasDataConsent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn(),
  mockHasDataConsent: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/lib/dataConsent', () => ({ hasDataConsent: mockHasDataConsent }))

import {
  _resetHeartbeatForTests,
  armHeartbeatAlarm,
  buildHeartbeatParams,
  heartbeatBrowser,
  isHeartbeatDue,
  maybeSendHeartbeat,
  recordInstallDate,
  registerHeartbeat,
} from '@/lib/heartbeat'

const DAY = HEARTBEAT_INTERVAL_MS
const NOW = 1_800_000_000_000

let store: Map<string, unknown>
let alarms: Map<string, { name: string; scheduledTime: number }>
let alarmListeners: ((a: { name: string }) => void)[]

function stubChrome(withAlarms = true) {
  alarmListeners = []
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '3.4.0' }) },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v)
        }),
      },
    },
    alarms: withAlarms
      ? {
          get: vi.fn(async (name: string) => alarms.get(name)),
          create: vi.fn(async (name: string, info: { when: number }) => {
            alarms.set(name, { name, scheduledTime: info.when })
          }),
          onAlarm: { addListener: (cb: (a: { name: string }) => void) => alarmListeners.push(cb) },
        }
      : undefined,
  })
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  store = new Map()
  alarms = new Map()
  stubChrome()
  vi.stubEnv('VITE_DEMO_BUILD', '')
  vi.stubEnv('BROWSER', 'chrome')
  mockTrackEvent.mockClear()
  mockHasDataConsent.mockReset().mockResolvedValue(true)
  _resetHeartbeatForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('isHeartbeatDue', () => {
  it('is due when never sent, after 24h, or when the clock moved back', () => {
    expect(isHeartbeatDue(undefined, NOW)).toBe(true)
    expect(isHeartbeatDue('yesterday', NOW)).toBe(true)
    expect(isHeartbeatDue(NOW - DAY, NOW)).toBe(true)
    expect(isHeartbeatDue(NOW + 1000, NOW)).toBe(true)
  })

  it('is not due within 24h', () => {
    expect(isHeartbeatDue(NOW - DAY + 1, NOW)).toBe(false)
    expect(isHeartbeatDue(NOW, NOW)).toBe(false)
  })
})

describe('maybeSendHeartbeat', () => {
  it('sends once with the shared event name and stamps lastHeartbeatAt', async () => {
    expect(await maybeSendHeartbeat(NOW)).toBe('sent')
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent.mock.calls[0][0]).toBe(ANALYTICS_EVENTS.extensionHeartbeat)
    expect(store.get(HEARTBEAT_LAST_SENT_STORAGE_KEY)).toBe(NOW)
  })

  it('fires at most once per 24h', async () => {
    await maybeSendHeartbeat(NOW)
    expect(await maybeSendHeartbeat(NOW + DAY - 1)).toBe('not-due')
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    expect(await maybeSendHeartbeat(NOW + DAY)).toBe('sent')
    expect(mockTrackEvent).toHaveBeenCalledTimes(2)
  })

  it('concurrent triggers (start + alarm) share one send', async () => {
    const [a, b] = await Promise.all([maybeSendHeartbeat(NOW), maybeSendHeartbeat(NOW)])
    expect(a).toBe('sent')
    expect(b).toBe('sent')
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })

  it('without analytics consent sends nothing and does not stamp, so a later opt-in sends', async () => {
    mockHasDataConsent.mockResolvedValue(false)
    expect(await maybeSendHeartbeat(NOW)).toBe('no-consent')
    expect(mockTrackEvent).not.toHaveBeenCalled()
    expect(store.has(HEARTBEAT_LAST_SENT_STORAGE_KEY)).toBe(false)
    mockHasDataConsent.mockResolvedValue(true)
    expect(await maybeSendHeartbeat(NOW + 1000)).toBe('sent')
  })

  it('the demo build sends nothing', async () => {
    vi.stubEnv('VITE_DEMO_BUILD', 'true')
    expect(await maybeSendHeartbeat(NOW)).toBe('disabled')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})

describe('buildHeartbeatParams', () => {
  it('version + browser only when nothing else is stored', async () => {
    expect(await buildHeartbeatParams(NOW)).toEqual({ version: '3.4.0', browser: 'chrome' })
  })

  it('adds the cached tier and whole days since install', async () => {
    store.set(HEARTBEAT_TIER_STORAGE_KEY, 'pro_ai')
    store.set(INSTALLED_AT_STORAGE_KEY, NOW - 3 * DAY - 5000)
    expect(await buildHeartbeatParams(NOW)).toEqual({ version: '3.4.0', browser: 'chrome', tier: 'pro_ai', days_since_install: 3 })
  })

  it('ignores an unknown tier and a future or malformed install date', async () => {
    store.set(HEARTBEAT_TIER_STORAGE_KEY, 'enterprise')
    store.set(INSTALLED_AT_STORAGE_KEY, NOW + DAY)
    expect(await buildHeartbeatParams(NOW)).toEqual({ version: '3.4.0', browser: 'chrome' })
    store.set(INSTALLED_AT_STORAGE_KEY, 'x')
    expect(await buildHeartbeatParams(NOW)).toEqual({ version: '3.4.0', browser: 'chrome' })
  })

  it('signed_out is a valid tier', async () => {
    store.set(HEARTBEAT_TIER_STORAGE_KEY, 'signed_out')
    expect((await buildHeartbeatParams(NOW)).tier).toBe('signed_out')
  })

  it('reports the browser target, anything unexpected as other', () => {
    vi.stubEnv('BROWSER', 'firefox')
    expect(heartbeatBrowser()).toBe('firefox')
    vi.stubEnv('BROWSER', 'edge')
    expect(heartbeatBrowser()).toBe('edge')
    vi.stubEnv('BROWSER', 'safari')
    expect(heartbeatBrowser()).toBe('other')
  })
})

describe('recordInstallDate', () => {
  it('stores the first install time only', async () => {
    await recordInstallDate('update', NOW)
    expect(store.has(INSTALLED_AT_STORAGE_KEY)).toBe(false)
    await recordInstallDate('install', NOW)
    await recordInstallDate('install', NOW + 5)
    expect(store.get(INSTALLED_AT_STORAGE_KEY)).toBe(NOW)
  })
})

describe('armHeartbeatAlarm', () => {
  it('schedules the alarm for last send + 24h', async () => {
    store.set(HEARTBEAT_LAST_SENT_STORAGE_KEY, NOW - 1000)
    await armHeartbeatAlarm(NOW)
    expect(alarms.get(HEARTBEAT_ALARM_NAME)?.scheduledTime).toBe(NOW - 1000 + DAY)
  })

  it('schedules 24h from now when the last send is missing or past due (never every minute)', async () => {
    await armHeartbeatAlarm(NOW)
    expect(alarms.get(HEARTBEAT_ALARM_NAME)?.scheduledTime).toBe(NOW + DAY)
    alarms.clear()
    store.set(HEARTBEAT_LAST_SENT_STORAGE_KEY, NOW - 2 * DAY)
    await armHeartbeatAlarm(NOW)
    expect(alarms.get(HEARTBEAT_ALARM_NAME)?.scheduledTime).toBe(NOW + DAY)
  })

  it('leaves an existing alarm alone on later worker starts (its countdown is not restarted)', async () => {
    await armHeartbeatAlarm(NOW)
    vi.mocked(chrome.alarms.create).mockClear()
    await armHeartbeatAlarm(NOW + 60 * 60 * 1000)
    expect(chrome.alarms.create).not.toHaveBeenCalled()
  })

  it('replaces an alarm scheduled later than needed', async () => {
    alarms.set(HEARTBEAT_ALARM_NAME, { name: HEARTBEAT_ALARM_NAME, scheduledTime: NOW + 5 * DAY })
    store.set(HEARTBEAT_LAST_SENT_STORAGE_KEY, NOW)
    await armHeartbeatAlarm(NOW)
    expect(alarms.get(HEARTBEAT_ALARM_NAME)?.scheduledTime).toBe(NOW + DAY)
  })

  it('does nothing without the alarms API', async () => {
    stubChrome(false)
    await expect(armHeartbeatAlarm(NOW)).resolves.toBeUndefined()
  })
})

describe('registerHeartbeat', () => {
  it('sends on a stale worker start and arms the alarm', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    store.set(HEARTBEAT_LAST_SENT_STORAGE_KEY, NOW - DAY - 1)
    registerHeartbeat()
    await flush()
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    expect(alarms.get(HEARTBEAT_ALARM_NAME)?.scheduledTime).toBe(NOW + DAY)
  })

  it('a fresh worker start sends nothing; the heartbeat alarm sends, other alarms are ignored', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    store.set(HEARTBEAT_LAST_SENT_STORAGE_KEY, NOW - 1000)
    registerHeartbeat()
    await flush()
    expect(mockTrackEvent).not.toHaveBeenCalled()
    expect(alarmListeners).toHaveLength(1)

    vi.setSystemTime(NOW - 1000 + DAY)
    alarmListeners[0]({ name: 'reminder-1' })
    alarmListeners[0]({ name: 'tm-auto-backup' })
    await flush()
    expect(mockTrackEvent).not.toHaveBeenCalled()

    alarmListeners[0]({ name: HEARTBEAT_ALARM_NAME })
    await flush()
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })

  it('does nothing without the alarms API', () => {
    stubChrome(false)
    expect(() => registerHeartbeat()).not.toThrow()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('logs instead of throwing when storage fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(chrome.storage.local.get).mockRejectedValue(new Error('x'))
    registerHeartbeat()
    await flush()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
