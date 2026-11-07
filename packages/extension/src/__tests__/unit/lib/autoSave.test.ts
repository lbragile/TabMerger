import { describe, it, expect } from 'vitest'
import { AUTO_SAVE_THRESHOLD_MIN_GAP_MS, FREE_TIER_LIMITS } from '@tabmerger/shared'
import type { Group, GroupsState, Window } from '@/lib/types'
import {
  INITIAL_THRESHOLD_STATE,
  autoSaveGroupName,
  countThresholdTabs,
  describeAutoSaveOutcome,
  openWindowsToSave,
  parseAutoSaveOutcome,
  parseAutoSaveState,
  parseThresholdState,
  parseTierSeen,
  planAutoSave,
  readAutoSaveSettings,
  scheduledRunDue,
  thresholdStep,
  treatAsPaid,
  type RunTier,
} from '@/lib/autoSave'

const NOW = Date.UTC(2030, 10, 5, 14, 30)
const OWN = 'chrome-extension://ext/'
const FREE: RunTier = { kind: 'confirmed', tier: 'free' }
const PRO: RunTier = { kind: 'confirmed', tier: 'pro' }
const UNKNOWN: RunTier = { kind: 'unknown', remembered: null }

const tab = (url: string) => ({ id: 0, title: url, url, savedAt: 1 })
const win = (...urls: string[]): Window => ({ id: 1, tabs: urls.map(tab), incognito: false, focused: false })
const group = (id: string, urls: string[], extra: Partial<Group> = {}): Group => ({ id, name: id, color: 'c', updatedAt: 1, windows: [win(...urls)], ...extra })
const nowOpen = group('now', ['https://open.test/'], { permanent: true })
const state = (...groups: Group[]): GroupsState => ({ active: { id: 'now', index: 0 }, available: [nowOpen, ...groups] })
const opts = (tier: RunTier) => ({ tier, now: NOW, id: 'new-id', name: 'Auto-saved test' })
const urlsOf = (g: Group) => g.windows.flatMap((w) => w.tabs.map((t) => t.url))

describe('readAutoSaveSettings', () => {
  it('missing switch: the plan default (paid on, Free off), explicit=false', () => {
    expect(readAutoSaveSettings(undefined, true)).toMatchObject({ enabled: true, explicit: false, intervalMinutes: 60, threshold: 0, notify: false })
    expect(readAutoSaveSettings({}, false)).toMatchObject({ enabled: false, explicit: false })
  })
  it('a stored boolean wins over the plan', () => {
    expect(readAutoSaveSettings({ autoSaveTabsEnabled: false }, true)).toMatchObject({ enabled: false, explicit: true })
    expect(readAutoSaveSettings({ autoSaveTabsEnabled: true }, false)).toMatchObject({ enabled: true, explicit: true })
  })
  it('unknown values become defaults', () => {
    expect(readAutoSaveSettings({ autoSaveTabsEnabled: 'yes', autoSaveIntervalMinutes: 7, autoSaveTabThreshold: 21, autoSaveNotify: 1 }, false)).toEqual({
      enabled: false, explicit: false, intervalMinutes: 60, threshold: 0, notify: false,
    })
    expect(readAutoSaveSettings({ autoSaveIntervalMinutes: 0, autoSaveTabThreshold: 100, autoSaveNotify: true }, true)).toMatchObject({ intervalMinutes: 0, threshold: 100, notify: true })
    expect(readAutoSaveSettings('junk', true).enabled).toBe(true)
  })
})

describe('plan helpers', () => {
  it('parseTierSeen keeps a known tier only', () => {
    expect(parseTierSeen({ tier: 'pro', at: 1 })).toBe('pro')
    expect(parseTierSeen({ tier: 'pro_ai' })).toBe('pro_ai')
    expect(parseTierSeen({ tier: 'free' })).toBe('free')
    for (const bad of [null, 'pro', { tier: 'toString' }, {}]) expect(parseTierSeen(bad)).toBeNull()
  })
  it('treatAsPaid: confirmed paid, or an unknown check with a remembered paid answer', () => {
    expect(treatAsPaid(PRO)).toBe(true)
    expect(treatAsPaid({ kind: 'confirmed', tier: 'pro_ai' })).toBe(true)
    expect(treatAsPaid(FREE)).toBe(false)
    expect(treatAsPaid(UNKNOWN)).toBe(false)
    expect(treatAsPaid({ kind: 'unknown', remembered: 'pro' })).toBe(true)
  })
})

describe('stored state and outcomes', () => {
  it('parseAutoSaveOutcome accepts our shapes only', () => {
    expect(parseAutoSaveOutcome({ status: 'saved', at: 1, groupId: 'g', groupName: 'n', saved: 3, total: 4, replaced: 1 })).toEqual({
      status: 'saved', at: 1, groupId: 'g', groupName: 'n', saved: 3, total: 4, replaced: 1,
    })
    expect(parseAutoSaveOutcome({ status: 'saved', at: 1, groupId: 'g', groupName: 'n', saved: -1, total: 'x' })).toMatchObject({ saved: 0, total: 0, replaced: 0 })
    expect(parseAutoSaveOutcome({ status: 'skipped', at: 1, reason: 'nothing-new' })).toEqual({ status: 'skipped', at: 1, reason: 'nothing-new' })
    expect(parseAutoSaveOutcome({ status: 'error', at: 1 })).toEqual({ status: 'error', at: 1 })
    for (const bad of [null, 'x', { status: 'saved' }, { status: 'skipped', at: 1, reason: 'toString' }, { status: 'weird', at: 1 }, { status: 'saved', at: 1, groupId: 2, groupName: 'n' }]) {
      expect(parseAutoSaveOutcome(bad)).toBeNull()
    }
  })
  it('parseAutoSaveState drops anything malformed', () => {
    expect(parseAutoSaveState(null)).toEqual({})
    expect(parseAutoSaveState({ lastScheduledAt: -5, last: { status: 'nope' } })).toEqual({})
    expect(parseAutoSaveState({ lastScheduledAt: 10, last: { status: 'error', at: 2 } })).toEqual({ lastScheduledAt: 10, last: { status: 'error', at: 2 } })
  })
  it('scheduledRunDue follows the interval with tolerance; 0 = never', () => {
    expect(scheduledRunDue({}, 60, NOW)).toBe(true)
    expect(scheduledRunDue({}, 0, NOW)).toBe(false)
    expect(scheduledRunDue({ lastScheduledAt: NOW - 30 * 60_000 }, 60, NOW)).toBe(false)
    expect(scheduledRunDue({ lastScheduledAt: NOW - 59 * 60_000 }, 60, NOW)).toBe(true)
    expect(scheduledRunDue({ lastScheduledAt: NOW + 60_000 }, 60, NOW)).toBe(true)
  })
})

describe('openWindowsToSave', () => {
  const windows = [
    { id: 2, type: 'normal', incognito: false },
    { id: 3, type: 'normal', incognito: true },
    { id: 4, type: 'popup', incognito: false },
    { id: 1, type: 'normal', incognito: false },
    { type: 'normal' },
  ]
  const tabs = [
    { windowId: 2, index: 1, url: 'https://b.test/', title: 'B', groupId: 7 },
    { windowId: 2, index: 0, url: 'https://a.test/', title: '', pinned: true },
    { windowId: 2, index: 2, url: `${OWN}popup.html` },
    { windowId: 2, index: 3, url: '', pendingUrl: 'https://pending.test/' },
    { windowId: 2, index: 4, url: '' },
    { windowId: 3, index: 0, url: 'https://private.test/', incognito: true },
    { windowId: 4, index: 0, url: 'https://popup.test/' },
    { windowId: 1, index: 0, url: 'chrome://settings/' },
    { index: 0, url: 'https://nowindow.test/' },
    { windowId: 9, index: 0, url: 'https://incog-tab.test/', incognito: true },
  ]

  it('normal non-private windows in browser order, tabs in strip order, own pages out, saved copies', () => {
    const out = openWindowsToSave(tabs, windows, [{ id: 7, title: 'Work', color: 'blue' }], OWN, NOW)
    expect(out.map((w) => w.id)).toEqual([2, 1])
    expect(out[0].tabs.map((t) => t.url)).toEqual(['https://a.test/', 'https://b.test/', 'https://pending.test/'])
    expect(out[1].tabs.map((t) => t.url)).toEqual(['chrome://settings/'])
    const [a, b] = out[0].tabs
    expect(a).toMatchObject({ id: 0, title: 'https://a.test/', savedAt: NOW })
    expect(a).not.toHaveProperty('pinned')
    expect(b.chromeGroup).toEqual({ id: 7, name: 'Work', color: 'blue' })
    expect(out.every((w) => w.incognito === false)).toBe(true)
  })

  it('a tab group that is not known leaves no chromeGroup; empty windows are dropped', () => {
    const out = openWindowsToSave([{ windowId: 1, url: 'https://x.test/', groupId: 99 }], [{ id: 1, type: 'normal' }, { id: 5, type: 'normal' }], [], OWN, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].tabs[0].chromeGroup).toBeUndefined()
  })

  it('countThresholdTabs counts tabs in normal, non-private windows', () => {
    expect(countThresholdTabs(tabs, windows)).toBe(6)
  })
})

describe('thresholdStep (hysteresis + minimum gap)', () => {
  it('fires once above the threshold, then waits for the count to drop back', () => {
    const first = thresholdStep(21, 20, INITIAL_THRESHOLD_STATE, NOW)
    expect(first).toEqual({ run: true, next: { armed: false, lastRunAt: NOW } })
    const burst = thresholdStep(25, 20, first.next, NOW + 1000)
    expect(burst.run).toBe(false)
    const dropped = thresholdStep(20, 20, burst.next, NOW + 2000)
    expect(dropped).toEqual({ run: false, next: { armed: true, lastRunAt: NOW } })
    // re-armed, but within the 10-minute gap
    expect(thresholdStep(21, 20, dropped.next, NOW + 5 * 60_000).run).toBe(false)
    expect(thresholdStep(21, 20, dropped.next, NOW + AUTO_SAVE_THRESHOLD_MIN_GAP_MS).run).toBe(true)
  })
  it('off (0) never fires and keeps it armed; a future stamp does not block', () => {
    expect(thresholdStep(500, 0, { armed: false, lastRunAt: 1 }, NOW)).toEqual({ run: false, next: { armed: true, lastRunAt: 1 } })
    expect(thresholdStep(30, 20, { armed: true, lastRunAt: NOW + 60_000 }, NOW).run).toBe(true)
  })
  it('parseThresholdState falls back to armed', () => {
    expect(parseThresholdState(undefined)).toEqual(INITIAL_THRESHOLD_STATE)
    expect(parseThresholdState({ armed: 'x', lastRunAt: -1 })).toEqual(INITIAL_THRESHOLD_STATE)
    expect(parseThresholdState({ armed: false, lastRunAt: 5 })).toEqual({ armed: false, lastRunAt: 5 })
  })
})

describe('planAutoSave', () => {
  it('no open tabs: skip', () => {
    expect(planAutoSave(state(), [], opts(PRO))).toEqual({ kind: 'skip', reason: 'no-tabs' })
    expect(planAutoSave(state(), [win()], opts(PRO))).toEqual({ kind: 'skip', reason: 'no-tabs' })
  })

  it('skips URLs already saved anywhere (normalized), and saves a URL open twice once', () => {
    const archived = group('arch', ['https://ARCH.test/'], { archived: true })
    const kept = group('kept', ['https://kept.test/'])
    const plan = planAutoSave(state(archived, kept), [win('https://arch.test/', 'https://new.test/', 'https://new.test/'), win('https://kept.test/', 'https://other.test/')], opts(PRO))
    expect(plan.kind).toBe('write')
    if (plan.kind !== 'write') return
    expect(urlsOf(plan.group)).toEqual(['https://new.test/', 'https://other.test/'])
    expect(plan.saved).toBe(2)
    expect(plan.total).toBe(2)
  })

  it('Now Open and the tour practice groups do not count as saved', () => {
    const demo = group('demo', ['https://demo.test/'], { tourDemo: true })
    const plan = planAutoSave(state(demo), [win('https://open.test/', 'https://demo.test/')], opts(PRO))
    expect(plan.kind === 'write' && urlsOf(plan.group)).toEqual(['https://open.test/', 'https://demo.test/'])
  })

  it('nothing new: skip, nothing removed', () => {
    const s = state(group('a', ['https://a.test/']), group('r1', ['https://x.test/'], { autoSave: { at: 1, rolling: true } }))
    expect(planAutoSave(s, [win('https://a.test/')], opts(FREE))).toEqual({ kind: 'skip', reason: 'nothing-new' })
  })

  it('Pro: the new group is last, pending, not rolling, never index 0, with counts', () => {
    const plan = planAutoSave(state(group('a', ['https://a.test/'])), [win('https://n.test/')], opts(PRO))
    if (plan.kind !== 'write') throw new Error('expected a write')
    const { available } = plan.state
    expect(available.at(-1)).toBe(plan.group)
    expect(available[0].id).toBe('now')
    expect(plan.group).toMatchObject({ id: 'new-id', name: 'Auto-saved test', pendingSync: true, updatedAt: NOW, autoSave: { at: NOW, rolling: false }, permanent: false })
    expect(plan.group.info).toBeTruthy()
    expect(plan.replaced).toBe(0)
  })

  it('Pro never replaces, even rolling auto-saves made on Free', () => {
    const r1 = group('r1', ['https://r1.test/'], { autoSave: { at: 1, rolling: true } })
    const r2 = group('r2', ['https://r2.test/'], { autoSave: { at: 2, rolling: true } })
    const plan = planAutoSave(state(r1, r2), [win('https://n.test/')], opts(PRO))
    expect(plan.kind === 'write' && plan.state.available.map((g) => g.id)).toEqual(['now', 'r1', 'r2', 'new-id'])
  })

  it('Free: replaces the oldest rolling one in the same state, carrying its open tabs forward', () => {
    const r1 = group('r1', ['https://carry.test/', 'https://old.test/'], { autoSave: { at: 1, rolling: true } })
    const r2 = group('r2', ['https://r2.test/'], { autoSave: { at: 2, rolling: true } })
    const proMade = group('p', ['https://p.test/'], { autoSave: { at: 0.5, rolling: false } })
    const plan = planAutoSave(state(r1, proMade, r2), [win('https://carry.test/', 'https://r2.test/', 'https://n.test/')], opts(FREE))
    if (plan.kind !== 'write') throw new Error('expected a write')
    expect(plan.state.available.map((g) => g.id)).toEqual(['now', 'p', 'r2', 'new-id'])
    expect(urlsOf(plan.group)).toEqual(['https://carry.test/', 'https://n.test/'])
    expect(plan.group.autoSave).toEqual({ at: NOW, rolling: true })
    expect(plan.replaced).toBe(1)
  })

  it('Free below the cap: nothing replaced', () => {
    const r1 = group('r1', ['https://r1.test/'], { autoSave: { at: 1, rolling: true } })
    const plan = planAutoSave(state(r1), [win('https://n.test/')], opts(FREE))
    expect(plan.kind === 'write' && plan.replaced).toBe(0)
  })

  it('unknown plan: saves but never removes; rolls unless a paid answer is remembered', () => {
    const r1 = group('r1', ['https://r1.test/'], { autoSave: { at: 1, rolling: true } })
    const r2 = group('r2', ['https://r2.test/'], { autoSave: { at: 2, rolling: true } })
    const plan = planAutoSave(state(r1, r2), [win('https://n.test/')], opts(UNKNOWN))
    if (plan.kind !== 'write') throw new Error('expected a write')
    expect(plan.state.available.map((g) => g.id)).toEqual(['now', 'r1', 'r2', 'new-id'])
    // a Free user offline still gets auto-saves that a later confirmed-Free run can replace
    expect(plan.group.autoSave?.rolling).toBe(true)
    const rememberedPro = planAutoSave(state(r1, r2), [win('https://n.test/')], opts({ kind: 'unknown', remembered: 'pro' }))
    expect(rememberedPro.kind === 'write' && rememberedPro.group.autoSave?.rolling).toBe(false)
    expect(rememberedPro.kind === 'write' && rememberedPro.replaced).toBe(0)
  })

  it('Free with no group slot and nothing to replace: skip, normal groups are never removed', () => {
    const five = Array.from({ length: FREE_TIER_LIMITS.groups }, (_, i) => group(`g${i}`, [`https://g${i}.test/`]))
    expect(planAutoSave(state(...five), [win('https://n.test/')], opts(FREE))).toEqual({ kind: 'skip', reason: 'no-group-slot' })
    // an unknown plan with no remembered paid answer follows the Free limits too
    expect(planAutoSave(state(...five), [win('https://n.test/')], opts(UNKNOWN))).toEqual({ kind: 'skip', reason: 'no-group-slot' })
    // a remembered paid answer does not
    expect(planAutoSave(state(...five), [win('https://n.test/')], opts({ kind: 'unknown', remembered: 'pro' })).kind).toBe('write')
  })

  it('Free at the group limit WITH a rolling one to replace: the slot is freed by the replacement', () => {
    const three = Array.from({ length: 3 }, (_, i) => group(`g${i}`, [`https://g${i}.test/`]))
    const r1 = group('r1', ['https://r1.test/'], { autoSave: { at: 1, rolling: true } })
    const r2 = group('r2', ['https://r2.test/'], { autoSave: { at: 2, rolling: true } })
    const plan = planAutoSave(state(...three, r1, r2), [win('https://n.test/')], opts(FREE))
    expect(plan.kind === 'write' && plan.state.available.length).toBe(1 + FREE_TIER_LIMITS.groups)
  })

  it('Free near the tab limit: saves what fits, in window order', () => {
    const big = group('big', Array.from({ length: FREE_TIER_LIMITS.tabs - 2 }, (_, i) => `https://saved${i}.test/`))
    const plan = planAutoSave(state(big), [win('https://1.test/'), win('https://2.test/', 'https://3.test/', 'https://4.test/')], opts(FREE))
    if (plan.kind !== 'write') throw new Error('expected a write')
    expect(urlsOf(plan.group)).toEqual(['https://1.test/', 'https://2.test/'])
    expect(plan.saved).toBe(2)
    expect(plan.total).toBe(4)
    expect(plan.group.windows).toHaveLength(2)
  })

  it('Free at the tab limit: skip', () => {
    const full = group('full', Array.from({ length: FREE_TIER_LIMITS.tabs }, (_, i) => `https://s${i}.test/`))
    expect(planAutoSave(state(full), [win('https://n.test/')], opts(FREE))).toEqual({ kind: 'skip', reason: 'no-tab-room' })
  })

  it('the tab limit excludes the group being replaced', () => {
    const r1 = group('r1', Array.from({ length: 30 }, (_, i) => `https://r1-${i}.test/`), { autoSave: { at: 1, rolling: true } })
    const r2 = group('r2', Array.from({ length: 20 }, (_, i) => `https://r2-${i}.test/`), { autoSave: { at: 2, rolling: true } })
    const plan = planAutoSave(state(r1, r2), [win('https://n.test/')], opts(FREE))
    expect(plan.kind === 'write' && plan.saved).toBe(1)
  })

  it('keeps the active group by id, and hands a replaced active group to Now Open', () => {
    const r1 = group('r1', ['https://r1.test/'], { autoSave: { at: 1, rolling: true } })
    const r2 = group('r2', ['https://r2.test/'], { autoSave: { at: 2, rolling: true } })
    const a = group('a', ['https://a.test/'])
    const s1 = { ...state(r1, a, r2), active: { id: 'a', index: 2 } }
    const p1 = planAutoSave(s1, [win('https://n.test/')], opts(FREE))
    expect(p1.kind === 'write' && p1.state.active).toEqual({ id: 'a', index: 1 })
    const s2 = { ...state(r1, a, r2), active: { id: 'r1', index: 1 } }
    const p2 = planAutoSave(s2, [win('https://n.test/')], opts(FREE))
    expect(p2.kind === 'write' && p2.state.active).toEqual({ id: 'now', index: 0 })
  })
})

describe('copy', () => {
  it('names the group with a localized date', () => {
    expect(autoSaveGroupName(NOW)).toMatch(/^Auto-saved /)
  })
  it('describes every outcome', () => {
    expect(describeAutoSaveOutcome(null)).toEqual({ ok: false, message: expect.any(String) })
    expect(describeAutoSaveOutcome({ status: 'error', at: 1 }).ok).toBe(false)
    expect(describeAutoSaveOutcome({ status: 'saved', at: 1, groupId: 'g', groupName: 'N', saved: 2, total: 2, replaced: 0 })).toEqual({ ok: true, message: 'Saved 2 tabs to N.' })
    expect(describeAutoSaveOutcome({ status: 'saved', at: 1, groupId: 'g', groupName: 'N', saved: 2, total: 5, replaced: 0 }).message).toBe('Saved 2 of 5 tabs to N (Free limit).')
    expect(describeAutoSaveOutcome({ status: 'skipped', at: 1, reason: 'nothing-new' }).message).toMatch(/Nothing new/)
    expect(describeAutoSaveOutcome({ status: 'skipped', at: 1, reason: 'no-group-slot' }).message).toContain(String(FREE_TIER_LIMITS.groups))
    expect(describeAutoSaveOutcome({ status: 'skipped', at: 1, reason: 'no-tab-room' }).message).toContain(String(FREE_TIER_LIMITS.tabs))
    for (const reason of ['disabled', 'not-due', 'no-tabs', 'account-mismatch', 'busy'] as const) {
      expect(describeAutoSaveOutcome({ status: 'skipped', at: 1, reason }).message.length).toBeGreaterThan(0)
    }
  })
})
