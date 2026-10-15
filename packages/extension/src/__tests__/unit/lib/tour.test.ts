import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  TOUR_STORAGE_KEY,
  availableTourSteps,
  computeCardPosition,
  isTourAutoStartEnabled,
  markTourDone,
  markTourPendingOnInstall,
  nextTrapIndex,
  parseTourRecord,
  readTourRecord,
  remToPx,
  resolveTourStartIndex,
  saveTourProgress,
  scrollTopToReveal,
  shouldAutoStartTour,
  spotlightRect,
  tourAnchorSelector,
  type TourStep,
} from '@/lib/tour'

const stored = async () => (await chrome.storage.local.get(TOUR_STORAGE_KEY))[TOUR_STORAGE_KEY]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseTourRecord', () => {
  it.each([undefined, null, 'pending', 42, true, [], {}, { status: 'finished' }, { status: 1 }, { stepId: 'x' }])(
    'reads %j as no record',
    (raw) => {
      expect(parseTourRecord(raw)).toBeNull()
    }
  )

  it('reads done, dropping any extra fields', () => {
    expect(parseTourRecord({ status: 'done' })).toEqual({ status: 'done' })
    expect(parseTourRecord({ status: 'done', stepId: 'welcome', extra: 1 })).toEqual({ status: 'done' })
  })

  it('reads plain pending', () => {
    expect(parseTourRecord({ status: 'pending' })).toEqual({ status: 'pending' })
  })

  it('keeps a valid stepId on pending', () => {
    expect(parseTourRecord({ status: 'pending', stepId: 'now-open' })).toEqual({ status: 'pending', stepId: 'now-open' })
    expect(parseTourRecord({ status: 'pending', stepId: 'a'.repeat(64) })).toEqual({ status: 'pending', stepId: 'a'.repeat(64) })
  })

  it('drops a stepId that is empty, over-long or not a string', () => {
    expect(parseTourRecord({ status: 'pending', stepId: '' })).toEqual({ status: 'pending' })
    expect(parseTourRecord({ status: 'pending', stepId: 'a'.repeat(65) })).toEqual({ status: 'pending' })
    expect(parseTourRecord({ status: 'pending', stepId: 7 })).toEqual({ status: 'pending' })
    expect(parseTourRecord({ status: 'pending', stepId: { a: 1 } })).toEqual({ status: 'pending' })
  })
})

describe('storage helpers', () => {
  it('readTourRecord returns null when nothing is stored', async () => {
    expect(await readTourRecord()).toBeNull()
  })

  it('readTourRecord ignores garbage in storage', async () => {
    await chrome.storage.local.set({ [TOUR_STORAGE_KEY]: 'nope' })
    expect(await readTourRecord()).toBeNull()
  })

  it('readTourRecord returns null when the read rejects', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('boom'))
    expect(await readTourRecord()).toBeNull()
  })

  it('readTourRecord returns null when chrome is missing', async () => {
    vi.stubGlobal('chrome', undefined)
    expect(await readTourRecord()).toBeNull()
  })

  it('readTourRecord returns null when chrome.storage.local is missing', async () => {
    vi.stubGlobal('chrome', {})
    expect(await readTourRecord()).toBeNull()
  })

  it('saveTourProgress stores pending with the step id', async () => {
    await saveTourProgress('groups')
    expect(await stored()).toEqual({ status: 'pending', stepId: 'groups' })
    expect(await readTourRecord()).toEqual({ status: 'pending', stepId: 'groups' })
  })

  it('markTourDone stores done and replaces progress', async () => {
    await saveTourProgress('groups')
    await markTourDone()
    expect(await stored()).toEqual({ status: 'done' })
  })

  it('writes never throw when storage rejects', async () => {
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('quota')).mockRejectedValueOnce(new Error('quota'))
    await expect(markTourDone()).resolves.toBeUndefined()
    await expect(saveTourProgress('x')).resolves.toBeUndefined()
  })

  it('writes never throw when chrome is missing', async () => {
    vi.stubGlobal('chrome', undefined)
    await expect(markTourDone()).resolves.toBeUndefined()
  })
})

describe('markTourPendingOnInstall', () => {
  it('marks pending on a first install', async () => {
    expect(await markTourPendingOnInstall('install')).toBe(true)
    expect(await stored()).toEqual({ status: 'pending' })
  })

  it.each(['update', 'chrome_update', 'shared_module_update'])('does nothing on %s', async (reason) => {
    expect(await markTourPendingOnInstall(reason)).toBe(false)
    expect(await stored()).toBeUndefined()
  })

  it.each([{ status: 'done' }, { status: 'pending', stepId: 'search' }])('never overwrites an existing record %j', async (record) => {
    await chrome.storage.local.set({ [TOUR_STORAGE_KEY]: record })
    expect(await markTourPendingOnInstall('install')).toBe(false)
    expect(await stored()).toEqual(record)
  })

  it('does nothing in a demo build', async () => {
    vi.stubEnv('VITE_DEMO_BUILD', 'true')
    expect(isTourAutoStartEnabled()).toBe(false)
    expect(await markTourPendingOnInstall('install')).toBe(false)
    expect(await stored()).toBeUndefined()
  })
})

describe('shouldAutoStartTour', () => {
  it('starts only for a pending record', () => {
    expect(shouldAutoStartTour({ status: 'pending' })).toBe(true)
    expect(shouldAutoStartTour({ status: 'pending', stepId: 'groups' })).toBe(true)
    expect(shouldAutoStartTour({ status: 'done' })).toBe(false)
    expect(shouldAutoStartTour(null)).toBe(false)
  })

  it('never starts in a demo build', () => {
    vi.stubEnv('VITE_DEMO_BUILD', 'true')
    expect(shouldAutoStartTour({ status: 'pending' })).toBe(false)
  })
})

describe('steps helpers', () => {
  const steps: TourStep[] = [
    { id: 'a', chapter: 'one', anchor: null, title: 'A', body: 'a', placement: 'center' },
    { id: 'b', chapter: 'one', anchor: 'present', title: 'B', body: 'b', placement: 'right' },
    { id: 'c', chapter: 'two', anchor: 'missing', title: 'C', body: 'c', placement: 'left' },
  ]

  it('builds the attribute selector', () => {
    expect(tourAnchorSelector('search')).toBe('[data-tour="search"]')
  })

  it('availableTourSteps keeps centered steps and steps whose anchor exists, drops the rest', () => {
    const root = document.createElement('div')
    root.innerHTML = '<button data-tour="present"></button>'
    expect(availableTourSteps(steps, root).map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('resolveTourStartIndex finds the remembered step, else starts at the first', () => {
    expect(resolveTourStartIndex(steps, 'c')).toBe(2)
    expect(resolveTourStartIndex(steps, 'removed-step')).toBe(0)
    expect(resolveTourStartIndex(steps, null)).toBe(0)
    expect(resolveTourStartIndex(steps, undefined)).toBe(0)
    expect(resolveTourStartIndex(steps, '')).toBe(0)
    expect(resolveTourStartIndex([], 'a')).toBe(0)
  })

  it('remToPx scales by the root font size', () => {
    expect(remToPx(0.5)).toBe(8)
    expect(remToPx(2, 10)).toBe(20)
  })
})

describe('spotlightRect', () => {
  const frame = { width: 800, height: 600 }

  it('grows the anchor by the padding on every side', () => {
    expect(spotlightRect({ left: 100, top: 100, width: 50, height: 20 }, 4, frame)).toEqual({ left: 96, top: 96, width: 58, height: 28 })
  })

  it('is cut to the frame at the top-left', () => {
    expect(spotlightRect({ left: 1, top: 2, width: 50, height: 20 }, 4, frame)).toEqual({ left: 0, top: 0, width: 55, height: 26 })
  })

  it('is cut to the frame at the bottom-right', () => {
    expect(spotlightRect({ left: 760, top: 580, width: 40, height: 20 }, 4, frame)).toEqual({ left: 756, top: 576, width: 44, height: 24 })
  })

  it('never has a negative size for an anchor entirely outside the frame', () => {
    const r = spotlightRect({ left: 900, top: 700, width: 10, height: 10 }, 4, frame)
    expect(r.width).toBeGreaterThanOrEqual(0)
    expect(r.height).toBeGreaterThanOrEqual(0)
    expect(r.left + r.width).toBeLessThanOrEqual(800)
    expect(r.top + r.height).toBeLessThanOrEqual(600)
  })
})

describe('computeCardPosition', () => {
  const frame = { width: 800, height: 600 }
  const card = { width: 320, height: 160 }
  const gap = 12
  const margin = 8
  const base = { card, frame, gap, margin }
  const inside = (p: { left: number; top: number }) => {
    expect(p.left).toBeGreaterThanOrEqual(margin)
    expect(p.top).toBeGreaterThanOrEqual(margin)
    expect(p.left + card.width).toBeLessThanOrEqual(frame.width - margin)
    expect(p.top + card.height).toBeLessThanOrEqual(frame.height - margin)
  }

  it('centers a step without an anchor', () => {
    const p = computeCardPosition({ ...base, anchor: null, placement: 'right' })
    expect(p).toEqual({ left: 240, top: 220, placement: 'center' })
  })

  it('centers a center-placement step even when it has an anchor', () => {
    const p = computeCardPosition({ ...base, anchor: { left: 10, top: 10, width: 50, height: 20 }, placement: 'center' })
    expect(p.placement).toBe('center')
  })

  it('puts the card to the right of the anchor, vertically centered on it', () => {
    const p = computeCardPosition({ ...base, anchor: { left: 20, top: 200, width: 200, height: 40 }, placement: 'right' })
    expect(p).toEqual({ left: 232, top: 140, placement: 'right' })
  })

  it('puts the card to the left', () => {
    const p = computeCardPosition({ ...base, anchor: { left: 600, top: 200, width: 100, height: 40 }, placement: 'left' })
    expect(p.placement).toBe('left')
    expect(p.left).toBe(600 - gap - card.width)
  })

  it('puts the card below', () => {
    const p = computeCardPosition({ ...base, anchor: { left: 300, top: 10, width: 100, height: 30 }, placement: 'bottom' })
    expect(p).toEqual({ left: 190, top: 52, placement: 'bottom' })
  })

  it('puts the card above', () => {
    const p = computeCardPosition({ ...base, anchor: { left: 300, top: 500, width: 100, height: 30 }, placement: 'top' })
    expect(p.placement).toBe('top')
    expect(p.top).toBe(500 - gap - card.height)
  })

  it.each([
    ['right', { left: 600, top: 200, width: 190, height: 40 }, 'left'],
    ['left', { left: 5, top: 200, width: 100, height: 40 }, 'right'],
    ['bottom', { left: 300, top: 520, width: 100, height: 40 }, 'top'],
    ['top', { left: 300, top: 5, width: 100, height: 40 }, 'bottom'],
  ] as const)('falls back to the opposite side when %s has no room', (placement, anchor, expected) => {
    const p = computeCardPosition({ ...base, anchor, placement })
    expect(p.placement).toBe(expected)
    inside(p)
  })

  it('goes inside the anchor when no side has room', () => {
    const p = computeCardPosition({ ...base, anchor: { left: 0, top: 0, width: 800, height: 600 }, placement: 'right' })
    expect(p.placement).toBe('inside')
    inside(p)
  })

  it('stays inside the frame for anchors at every edge and corner, on every placement', () => {
    const size = { width: 60, height: 30 }
    const xs = [0, 370, 740]
    const ys = [0, 285, 570]
    for (const placement of ['top', 'bottom', 'left', 'right'] as const) {
      for (const left of xs) {
        for (const top of ys) {
          inside(computeCardPosition({ ...base, anchor: { left, top, ...size }, placement }))
        }
      }
    }
  })

  it('cuts a measured card to the frame minus its margins before placing it', () => {
    const p = computeCardPosition({ anchor: { left: 100, top: 100, width: 50, height: 20 }, card: { width: 2000, height: 2000 }, frame, placement: 'right', gap, margin })
    expect(p.left).toBeGreaterThanOrEqual(margin)
    expect(p.top).toBeGreaterThanOrEqual(margin)
    expect(p.left).toBeLessThanOrEqual(frame.width - margin)
    expect(p.top).toBeLessThanOrEqual(frame.height - margin)
  })

  it('stays inside the frame even for a card larger than the frame', () => {
    const p = computeCardPosition({ anchor: null, card: { width: 900, height: 700 }, frame, placement: 'center', gap, margin })
    expect(p.left).toBe(margin)
    expect(p.top).toBe(margin)
  })
})

describe('scrollTopToReveal', () => {
  const container = { top: 100, height: 300 }

  it('returns null when the anchor is already fully visible', () => {
    expect(scrollTopToReveal({ top: 150, height: 40 }, container, 50)).toBeNull()
    expect(scrollTopToReveal({ top: 100, height: 300 }, container, 0)).toBeNull()
  })

  it('scrolls up when the anchor is above', () => {
    expect(scrollTopToReveal({ top: 60, height: 40 }, container, 200)).toBe(160)
  })

  it('scrolls down when the anchor is below', () => {
    expect(scrollTopToReveal({ top: 380, height: 60 }, container, 10)).toBe(50)
  })

  it('aligns an anchor taller than the container to its top', () => {
    expect(scrollTopToReveal({ top: 120, height: 500 }, container, 0)).toBe(20)
  })

  it('never returns a negative scrollTop', () => {
    expect(scrollTopToReveal({ top: 0, height: 20 }, container, 10)).toBe(0)
  })

  it('counts the padding', () => {
    expect(scrollTopToReveal({ top: 104, height: 40 }, container, 30, 8)).toBe(26)
    expect(scrollTopToReveal({ top: 104, height: 40 }, container, 30, 0)).toBeNull()
  })
})

describe('nextTrapIndex', () => {
  it('wraps forwards', () => {
    expect(nextTrapIndex(0, 3, false)).toBe(1)
    expect(nextTrapIndex(2, 3, false)).toBe(0)
  })
  it('wraps backwards', () => {
    expect(nextTrapIndex(1, 3, true)).toBe(0)
    expect(nextTrapIndex(0, 3, true)).toBe(2)
  })
  it('enters at the first or last item when focus is outside the trap', () => {
    expect(nextTrapIndex(-1, 3, false)).toBe(0)
    expect(nextTrapIndex(-1, 3, true)).toBe(2)
  })
  it('stays on a single button', () => {
    expect(nextTrapIndex(0, 1, false)).toBe(0)
    expect(nextTrapIndex(0, 1, true)).toBe(0)
  })
  it('returns -1 with nothing to focus', () => {
    expect(nextTrapIndex(0, 0, false)).toBe(-1)
  })
})
