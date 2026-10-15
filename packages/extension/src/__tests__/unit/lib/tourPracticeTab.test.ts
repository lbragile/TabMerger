import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  TOUR_PRACTICE_PAGE,
  closeTourPracticeTab,
  isTourPracticeTabOpen,
  isTourPracticeUrl,
  openTourPracticeTab,
  tourPracticeTabUrl,
  withoutTourPracticeTabs,
} from '@/lib/tourPracticeTab'

const PAGE = `chrome-extension://abc/${TOUR_PRACTICE_PAGE}`
const mockGetURL = vi.fn((path: string) => `chrome-extension://abc/${path}`)
const mockCreate = vi.fn()
const mockGet = vi.fn()
const mockRemove = vi.fn()
let savedChrome: unknown

beforeEach(() => {
  vi.clearAllMocks()
  savedChrome = (globalThis as { chrome?: unknown }).chrome
  ;(globalThis as { chrome: unknown }).chrome = { runtime: { getURL: mockGetURL }, tabs: { create: mockCreate, get: mockGet, remove: mockRemove } }
})
afterEach(() => {
  ;(globalThis as { chrome?: unknown }).chrome = savedChrome
})

describe('tourPracticeTabUrl / isTourPracticeUrl', () => {
  it('builds the address from the extension runtime', () => {
    expect(tourPracticeTabUrl()).toBe(PAGE)
  })

  it('is an empty string when the runtime is missing, and then nothing counts as the practice page', () => {
    ;(globalThis as { chrome: unknown }).chrome = {}
    expect(tourPracticeTabUrl()).toBe('')
    expect(isTourPracticeUrl(PAGE)).toBe(false)
  })

  it('accepts the page with a query or fragment, and nothing that merely starts like it', () => {
    expect(isTourPracticeUrl(PAGE)).toBe(true)
    expect(isTourPracticeUrl(`${PAGE}?x=1`)).toBe(true)
    expect(isTourPracticeUrl(`${PAGE}#top`)).toBe(true)
    expect(isTourPracticeUrl(`${PAGE}.evil`)).toBe(false)
    expect(isTourPracticeUrl('https://example.com')).toBe(false)
    expect(isTourPracticeUrl(undefined)).toBe(false)
    expect(isTourPracticeUrl(42)).toBe(false)
  })
})

describe('withoutTourPracticeTabs', () => {
  const tab = (url: string) => ({ url })

  it('returns the very same array when no tab shows the practice page', () => {
    const wins = [{ tabs: [tab('https://a.com')] }]
    expect(withoutTourPracticeTabs(wins)).toBe(wins)
  })

  it('drops the practice tab, and a window that held nothing else', () => {
    const wins = [{ id: 1, tabs: [tab('https://a.com'), tab(PAGE)] }, { id: 2, tabs: [tab(PAGE)] }]
    const out = withoutTourPracticeTabs(wins)
    expect(out).toEqual([{ id: 1, tabs: [tab('https://a.com')] }])
    expect(wins[0].tabs).toHaveLength(2) // input untouched
  })
})

describe('isTourPracticeTabOpen', () => {
  it('is false for a non-number id without asking the browser', async () => {
    expect(await isTourPracticeTabOpen(null)).toBe(false)
    expect(await isTourPracticeTabOpen(undefined)).toBe(false)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('is true while the tab shows the practice page (also while it is still loading it)', async () => {
    mockGet.mockResolvedValueOnce({ url: PAGE })
    expect(await isTourPracticeTabOpen(3)).toBe(true)
    mockGet.mockResolvedValueOnce({ url: '', pendingUrl: PAGE })
    expect(await isTourPracticeTabOpen(3)).toBe(true)
  })

  it('is false when the id now belongs to another page, or the tab is gone', async () => {
    mockGet.mockResolvedValueOnce({ url: 'https://example.com' })
    expect(await isTourPracticeTabOpen(3)).toBe(false)
    mockGet.mockRejectedValueOnce(new Error('No tab'))
    expect(await isTourPracticeTabOpen(3)).toBe(false)
  })
})

describe('openTourPracticeTab', () => {
  it('opens the page in the background and returns the new id', async () => {
    mockCreate.mockResolvedValueOnce({ id: 11 })
    expect(await openTourPracticeTab()).toBe(11)
    expect(mockCreate).toHaveBeenCalledWith({ url: PAGE, active: false })
  })

  it('returns null when the browser refuses, gives no id, or the runtime is missing', async () => {
    mockCreate.mockRejectedValueOnce(new Error('no'))
    expect(await openTourPracticeTab()).toBeNull()
    mockCreate.mockResolvedValueOnce({})
    expect(await openTourPracticeTab()).toBeNull()
    ;(globalThis as { chrome: unknown }).chrome = {}
    expect(await openTourPracticeTab()).toBeNull()
  })
})

describe('closeTourPracticeTab', () => {
  it('closes the tab only while it still shows the practice page', async () => {
    mockGet.mockResolvedValueOnce({ url: PAGE })
    await closeTourPracticeTab(7)
    expect(mockRemove).toHaveBeenCalledWith(7)
  })

  it('closes nothing when the id belongs to another page, is not a number, or removal fails', async () => {
    mockGet.mockResolvedValueOnce({ url: 'https://example.com' })
    await closeTourPracticeTab(7)
    await closeTourPracticeTab(null)
    expect(mockRemove).not.toHaveBeenCalled()
    mockGet.mockResolvedValueOnce({ url: PAGE })
    mockRemove.mockRejectedValueOnce(new Error('gone'))
    await expect(closeTourPracticeTab(7)).resolves.toBeUndefined()
  })
})
