import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AUTO_BACKUP_ALARM_NAME, AUTO_BACKUP_MESSAGE } from '@tabmerger/shared'
import {
  AUTO_BACKUP_LAST_ATTEMPT_KEY,
  STARTUP_CHECK_MIN_GAP_MS,
  armAutoBackupAlarm,
  registerAutoBackup,
  runScheduledBackup,
  startupCheckAllowed,
} from '@/lib/autoBackupAlarm'

const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  run: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn(async (k: string, d: unknown) => (h.settings.has(k) ? h.settings.get(k) : d)),
  setSetting: vi.fn(async (k: string, v: unknown) => void h.settings.set(k, v)),
}))
vi.mock('@/lib/autoBackup', async () => {
  const actual = await vi.importActual<typeof import('@/lib/autoBackup')>('@/lib/autoBackup')
  return { ...actual, runAutoBackup: h.run }
})

const NOW = Date.UTC(2030, 5, 15, 12, 0, 0)
const flush = () => new Promise((r) => setTimeout(r, 0))

type Listener = (...a: never[]) => unknown
let chromeStub: {
  alarms: { get: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; onAlarm: { addListener: ReturnType<typeof vi.fn> } }
  runtime: { id: string; getURL: (p: string) => string; lastError: unknown; sendMessage: ReturnType<typeof vi.fn>; onStartup: { addListener: ReturnType<typeof vi.fn> }; onMessage: { addListener: ReturnType<typeof vi.fn> } }
}
const created = { status: 'created', sessionId: 's', createdAt: 1, uploaded: true, pruned: 0 }

beforeEach(() => {
  h.settings.clear()
  h.run.mockReset().mockResolvedValue({ status: 'skipped', reason: 'not-due' })
  chromeStub = {
    alarms: {
      get: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(true),
      onAlarm: { addListener: vi.fn() },
    },
    runtime: {
      id: 'my-ext-id',
      getURL: (path: string) => `chrome-extension://my-ext-id/${path}`,
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

describe('startupCheckAllowed', () => {
  it('allows when never attempted or the value is not a number', () => {
    for (const v of [undefined, null, 'x', NaN, Infinity]) expect(startupCheckAllowed(v, NOW)).toBe(true)
  })
  it('throttles within 15 minutes, allows at the edge and after', () => {
    expect(startupCheckAllowed(NOW - 1000, NOW)).toBe(false)
    expect(startupCheckAllowed(NOW - STARTUP_CHECK_MIN_GAP_MS + 1, NOW)).toBe(false)
    expect(startupCheckAllowed(NOW - STARTUP_CHECK_MIN_GAP_MS, NOW)).toBe(true)
  })
  it('allows when the stored stamp is in the future (clock moved back)', () => {
    expect(startupCheckAllowed(NOW + 1000, NOW)).toBe(true)
  })
})

describe('armAutoBackupAlarm', () => {
  it('does nothing when chrome.alarms is unavailable', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {}
    await expect(armAutoBackupAlarm()).resolves.toBeUndefined()
  })

  it('clears the alarm when backups are off', async () => {
    h.settings.set('appSettings', { autoBackupEnabled: false })
    await armAutoBackupAlarm()
    expect(chromeStub.alarms.clear).toHaveBeenCalledWith(AUTO_BACKUP_ALARM_NAME)
    expect(chromeStub.alarms.create).not.toHaveBeenCalled()
  })

  it('creates a periodic alarm with the chosen interval when none exists', async () => {
    h.settings.set('appSettings', { autoBackupIntervalMinutes: 360 })
    await armAutoBackupAlarm()
    expect(chromeStub.alarms.create).toHaveBeenCalledWith(AUTO_BACKUP_ALARM_NAME, { delayInMinutes: 360, periodInMinutes: 360 })
  })

  it.each([60, 360, 720, 1440, 10080])('arms a periodic alarm for the %i minute interval', async (minutes) => {
    h.settings.set('appSettings', { autoBackupIntervalMinutes: minutes })
    await armAutoBackupAlarm()
    expect(chromeStub.alarms.create).toHaveBeenCalledWith(AUTO_BACKUP_ALARM_NAME, { delayInMinutes: minutes, periodInMinutes: minutes })
  })

  it('an interval outside the allowed list falls back to daily', async () => {
    h.settings.set('appSettings', { autoBackupIntervalMinutes: 5 })
    await armAutoBackupAlarm()
    expect(chromeStub.alarms.create).toHaveBeenCalledWith(AUTO_BACKUP_ALARM_NAME, { delayInMinutes: 1440, periodInMinutes: 1440 })
  })

  it('uses the defaults (on, daily) for old settings without the keys', async () => {
    await armAutoBackupAlarm()
    expect(chromeStub.alarms.create).toHaveBeenCalledWith(AUTO_BACKUP_ALARM_NAME, { delayInMinutes: 1440, periodInMinutes: 1440 })
  })

  it('leaves an alarm with the matching period alone (re-creating it would restart the countdown)', async () => {
    chromeStub.alarms.get.mockResolvedValue({ name: AUTO_BACKUP_ALARM_NAME, periodInMinutes: 1440 })
    await armAutoBackupAlarm()
    expect(chromeStub.alarms.create).not.toHaveBeenCalled()
  })

  it('re-creates the alarm when its period differs', async () => {
    chromeStub.alarms.get.mockResolvedValue({ name: AUTO_BACKUP_ALARM_NAME, periodInMinutes: 60 })
    h.settings.set('appSettings', { autoBackupIntervalMinutes: 10080 })
    await armAutoBackupAlarm()
    expect(chromeStub.alarms.create).toHaveBeenCalledWith(AUTO_BACKUP_ALARM_NAME, { delayInMinutes: 10080, periodInMinutes: 10080 })
  })
})

describe('runScheduledBackup', () => {
  it('records the attempt and runs (non-manual) for an alarm', async () => {
    h.run.mockResolvedValue(created)
    const out = await runScheduledBackup('alarm', NOW)
    expect(h.settings.get(AUTO_BACKUP_LAST_ATTEMPT_KEY)).toBe(NOW)
    expect(h.run).toHaveBeenCalledWith({ now: NOW, recheckTier: false })
    expect(out).toEqual(created)
  })

  it.each([
    ['alarm', false],
    ['startup', false],
    ['settings', true],
  ] as const)('the %s trigger asks the server for the plan again: %s (only a settings change does)', async (trigger, recheck) => {
    await runScheduledBackup(trigger, NOW)
    expect(h.run).toHaveBeenCalledWith({ now: NOW, recheckTier: recheck })
  })

  it('startup within the throttle window does not run and does not move the stamp', async () => {
    h.settings.set(AUTO_BACKUP_LAST_ATTEMPT_KEY, NOW - 1000)
    expect(await runScheduledBackup('startup', NOW)).toEqual({ status: 'skipped', reason: 'not-due' })
    expect(h.run).not.toHaveBeenCalled()
    expect(h.settings.get(AUTO_BACKUP_LAST_ATTEMPT_KEY)).toBe(NOW - 1000)
  })

  it('startup after the window runs', async () => {
    h.settings.set(AUTO_BACKUP_LAST_ATTEMPT_KEY, NOW - STARTUP_CHECK_MIN_GAP_MS - 1)
    await runScheduledBackup('startup', NOW)
    expect(h.run).toHaveBeenCalledTimes(1)
  })

  it('alarm and settings triggers are not throttled', async () => {
    h.settings.set(AUTO_BACKUP_LAST_ATTEMPT_KEY, NOW - 1000)
    await runScheduledBackup('alarm', NOW)
    await runScheduledBackup('settings', NOW)
    expect(h.run).toHaveBeenCalledTimes(2)
  })

  it('broadcasts COMPLETED only when a backup was created', async () => {
    await runScheduledBackup('alarm', NOW)
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled()
    h.run.mockResolvedValue(created)
    await runScheduledBackup('alarm', NOW)
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({ type: AUTO_BACKUP_MESSAGE.COMPLETED }, expect.any(Function))
  })

  it('a broadcast that throws (no receiver) is swallowed', async () => {
    h.run.mockResolvedValue(created)
    chromeStub.runtime.sendMessage.mockImplementation(() => {
      throw new Error('context invalidated')
    })
    await expect(runScheduledBackup('alarm', NOW)).resolves.toEqual(created)
  })

  it('the broadcast callback reads lastError so Chrome does not log it', async () => {
    h.run.mockResolvedValue(created)
    await runScheduledBackup('alarm', NOW)
    const cb = chromeStub.runtime.sendMessage.mock.calls[0][1] as () => void
    expect(() => cb()).not.toThrow()
  })
})

describe('a free or signed-out account', () => {
  it('the alarm trigger asks for a backup, and the answer "not entitled" / "signed out" is passed through without a broadcast or a throw', async () => {
    for (const reason of ['not-entitled', 'signed-out'] as const) {
      h.run.mockResolvedValue({ status: 'skipped', reason })
      expect(await runScheduledBackup('alarm', NOW)).toEqual({ status: 'skipped', reason })
    }
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled()
  })
})

describe('registerAutoBackup', () => {
  it('does nothing when chrome.alarms is missing', () => {
    ;(globalThis as { chrome?: unknown }).chrome = { runtime: chromeStub.runtime }
    expect(() => registerAutoBackup()).not.toThrow()
    expect(chromeStub.runtime.onStartup.addListener).not.toHaveBeenCalled()
  })

  it('arms and checks on worker start and registers the three listeners', async () => {
    registerAutoBackup()
    await flush()
    expect(chromeStub.runtime.onStartup.addListener).toHaveBeenCalledTimes(1)
    expect(chromeStub.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1)
    expect(chromeStub.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
    expect(chromeStub.alarms.create).toHaveBeenCalledTimes(1)
    expect(h.run).toHaveBeenCalledTimes(1)
  })

  it('the browser-start listener checks again (subject to the throttle)', async () => {
    registerAutoBackup()
    await flush()
    h.run.mockClear()
    const onStartup = chromeStub.runtime.onStartup.addListener.mock.calls[0][0] as Listener
    onStartup()
    await flush()
    expect(h.run).not.toHaveBeenCalled() // the worker-start attempt was just stamped
  })

  it('a failing alarm arm is logged and the check still runs', async () => {
    chromeStub.alarms.get.mockRejectedValue(new Error('alarms broken'))
    registerAutoBackup()
    await flush()
    expect(h.run).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalled()
  })

  it('a failing check is logged, never thrown', async () => {
    h.run.mockRejectedValue(new Error('boom'))
    registerAutoBackup()
    await flush()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('the scheduled check failed'), expect.any(Error))
  })

  it('runs on its own alarm only', async () => {
    registerAutoBackup()
    await flush()
    h.run.mockClear()
    const onAlarm = chromeStub.alarms.onAlarm.addListener.mock.calls[0][0] as (a: { name: string }) => void
    onAlarm({ name: 'reminder-abc' })
    onAlarm({ name: `${AUTO_BACKUP_ALARM_NAME}-x` })
    await flush()
    expect(h.run).not.toHaveBeenCalled()
    onAlarm({ name: AUTO_BACKUP_ALARM_NAME })
    await flush()
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ now: expect.any(Number) }))
    expect(h.run.mock.calls[0][0].manual).toBeUndefined()
  })

  it('a failing alarm run is logged', async () => {
    registerAutoBackup()
    await flush()
    h.run.mockRejectedValue(new Error('boom'))
    const onAlarm = chromeStub.alarms.onAlarm.addListener.mock.calls[0][0] as (a: { name: string }) => void
    onAlarm({ name: AUTO_BACKUP_ALARM_NAME })
    await flush()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('the scheduled run failed'), expect.any(Error))
  })

  describe('messages', () => {
    const OWN = { id: 'my-ext-id', url: 'chrome-extension://my-ext-id/popup.html' }
    let onMessage: (msg: unknown, sender: { id?: string; tab?: unknown; url?: string }, send: (r: unknown) => void) => unknown
    beforeEach(async () => {
      registerAutoBackup()
      await flush()
      h.run.mockClear()
      chromeStub.alarms.create.mockClear()
      chromeStub.alarms.get.mockClear()
      chromeStub.alarms.clear.mockClear()
      onMessage = chromeStub.runtime.onMessage.addListener.mock.calls[0][0] as typeof onMessage
    })

    it('RUN_NOW from this extension runs a manual backup and answers with the outcome', async () => {
      h.run.mockResolvedValue(created)
      const send = vi.fn()
      expect(onMessage({ type: AUTO_BACKUP_MESSAGE.RUN_NOW }, OWN, send)).toBe(true)
      await flush()
      expect(h.run).toHaveBeenCalledWith({ manual: true })
      expect(send).toHaveBeenCalledWith(created)
      expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({ type: AUTO_BACKUP_MESSAGE.COMPLETED }, expect.any(Function))
    })

    it('a manual run that skipped is answered but not announced', async () => {
      h.run.mockResolvedValue({ status: 'skipped', reason: 'unchanged' })
      const send = vi.fn()
      onMessage({ type: AUTO_BACKUP_MESSAGE.RUN_NOW }, OWN, send)
      await flush()
      expect(send).toHaveBeenCalledWith({ status: 'skipped', reason: 'unchanged' })
      expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled()
    })

    it('SETTINGS_CHANGED re-arms the alarm, then runs a scheduled check', async () => {
      h.settings.set('appSettings', { autoBackupIntervalMinutes: 60 })
      expect(onMessage({ type: AUTO_BACKUP_MESSAGE.SETTINGS_CHANGED }, OWN, vi.fn())).toBeUndefined()
      await flush()
      expect(chromeStub.alarms.create).toHaveBeenCalledWith(AUTO_BACKUP_ALARM_NAME, { delayInMinutes: 60, periodInMinutes: 60 })
      expect(h.run).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['another extension', { id: 'other-ext' }],
      ['a web page / no id', {}],
      ['a content script of this extension (has a tab and a web page url)', { id: 'my-ext-id', tab: { id: 3 }, url: 'https://evil.example/' }],
      ['a content script with no url', { id: 'my-ext-id', tab: { id: 3 } }],
      ['an extension sender with no url and no tab', { id: 'my-ext-id' }],
      ['a page whose url only starts like the extension origin', { id: 'my-ext-id', tab: { id: 3 }, url: 'chrome-extension://my-ext-id.evil/x.html' }],
    ])('rejects a message from %s', async (_n, sender) => {
      const send = vi.fn()
      expect(onMessage({ type: AUTO_BACKUP_MESSAGE.RUN_NOW }, sender, send)).toBeUndefined()
      expect(onMessage({ type: AUTO_BACKUP_MESSAGE.SETTINGS_CHANGED }, sender, send)).toBeUndefined()
      await flush()
      expect(h.run).not.toHaveBeenCalled()
      expect(chromeStub.alarms.create).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    })

    it('accepts an own extension page open in a tab', async () => {
      h.run.mockResolvedValue(created)
      const send = vi.fn()
      expect(onMessage({ type: AUTO_BACKUP_MESSAGE.RUN_NOW }, { id: 'my-ext-id', tab: { id: 3 }, url: 'chrome-extension://my-ext-id/popup.html' }, send)).toBe(true)
      await flush()
      expect(send).toHaveBeenCalledWith(created)
    })

    it('SETTINGS_CHANGED runs the scheduled check with a plan re-check', async () => {
      onMessage({ type: AUTO_BACKUP_MESSAGE.SETTINGS_CHANGED }, OWN, vi.fn())
      await flush()
      expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ recheckTier: true }))
    })

    it.each([[null], [undefined], ['str'], [{}], [{ type: 'OTHER' }], [{ type: AUTO_BACKUP_MESSAGE.COMPLETED }], [{ type: 5 }]])(
      'ignores a malformed or unrelated payload %j',
      async (msg) => {
        expect(onMessage(msg, OWN, vi.fn())).toBeUndefined()
        await flush()
        expect(h.run).not.toHaveBeenCalled()
      }
    )

    it('the settings come from storage, never from the message: a payload interval is ignored', async () => {
      h.settings.set('appSettings', { autoBackupIntervalMinutes: 720 })
      onMessage({ type: AUTO_BACKUP_MESSAGE.SETTINGS_CHANGED, intervalMinutes: 1, enabled: false }, OWN, vi.fn())
      await flush()
      expect(chromeStub.alarms.create).toHaveBeenCalledWith(AUTO_BACKUP_ALARM_NAME, { delayInMinutes: 720, periodInMinutes: 720 })
      expect(chromeStub.alarms.clear).not.toHaveBeenCalled()
    })
  })
})
