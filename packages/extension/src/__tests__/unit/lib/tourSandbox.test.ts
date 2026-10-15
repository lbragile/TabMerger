import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  TOUR_SIGNALS,
  getTourSearchShowsDemo,
  getTourTabSandbox,
  isHiddenFromSearch,
  isTourOpenBlocked,
  isTourSpringOpenBlocked,
  setTourOpenBlocked,
  setTourSearchShowsDemo,
  setTourSpringOpenBlocked,
  setTourTabSandbox,
  subscribeTourSearchShowsDemo,
  subscribeTourTabSandbox,
} from '@/lib/tourSandbox'

afterEach(() => {
  setTourTabSandbox(null)
  setTourSearchShowsDemo(false)
  setTourOpenBlocked(false)
  setTourSpringOpenBlocked(false)
})

describe('tab sandbox', () => {
  it('is off by default and notifies subscribers only on a real change', () => {
    expect(getTourTabSandbox()).toBeNull()
    const listener = vi.fn()
    const off = subscribeTourTabSandbox(listener)
    setTourTabSandbox({ tabId: 5 })
    expect(getTourTabSandbox()).toEqual({ tabId: 5 })
    expect(listener).toHaveBeenCalledTimes(1)
    setTourTabSandbox({ tabId: 5 }) // same tab id: nothing to tell
    expect(listener).toHaveBeenCalledTimes(1)
    setTourTabSandbox({ tabId: 6 })
    expect(listener).toHaveBeenCalledTimes(2)
    setTourTabSandbox(null)
    expect(listener).toHaveBeenCalledTimes(3)
    setTourTabSandbox(null)
    expect(listener).toHaveBeenCalledTimes(3)
    off()
    setTourTabSandbox({ tabId: null })
    expect(listener).toHaveBeenCalledTimes(3)
  })
})

describe('search visibility of practice groups', () => {
  it('hides a tourDemo group from search unless a tour search step is up', () => {
    const demo = { tourDemo: true }
    expect(isHiddenFromSearch(demo)).toBe(true)
    setTourSearchShowsDemo(true)
    expect(isHiddenFromSearch(demo)).toBe(false)
    setTourSearchShowsDemo(false)
    expect(isHiddenFromSearch(demo)).toBe(true)
  })

  it('never hides an ordinary group, nor a missing one', () => {
    expect(isHiddenFromSearch({})).toBe(false)
    expect(isHiddenFromSearch({ tourDemo: false })).toBe(false)
    expect(isHiddenFromSearch({ tourDemo: 'true' })).toBe(false)
    expect(isHiddenFromSearch(null)).toBe(false)
    expect(isHiddenFromSearch(undefined)).toBe(false)
  })

  it('notifies subscribers only when the flag changes, and stops after unsubscribing', () => {
    const listener = vi.fn()
    const off = subscribeTourSearchShowsDemo(listener)
    setTourSearchShowsDemo(false)
    expect(listener).not.toHaveBeenCalled()
    setTourSearchShowsDemo(true)
    expect(getTourSearchShowsDemo()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    setTourSearchShowsDemo(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('simple flags and signal names', () => {
  it('open and spring-open blocks toggle', () => {
    expect(isTourOpenBlocked()).toBe(false)
    setTourOpenBlocked(true)
    expect(isTourOpenBlocked()).toBe(true)
    expect(isTourSpringOpenBlocked()).toBe(false)
    setTourSpringOpenBlocked(true)
    expect(isTourSpringOpenBlocked()).toBe(true)
  })

  it('signal names are distinct', () => {
    const values = Object.values(TOUR_SIGNALS)
    expect(new Set(values).size).toBe(values.length)
  })
})
