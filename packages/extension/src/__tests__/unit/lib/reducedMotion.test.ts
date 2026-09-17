/**
 * reducedMotion.test.ts — `prefers-reduced-motion` makes DnD scrolling instant.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { motionScrollBehavior, prefersReducedMotion } from '@/lib/reducedMotion'

afterEach(() => vi.unstubAllGlobals())

describe('reducedMotion', () => {
  it('reduce → true / "auto"', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    expect(prefersReducedMotion()).toBe(true)
    expect(motionScrollBehavior()).toBe('auto')
  })

  it('no preference → false / "smooth"', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(prefersReducedMotion()).toBe(false)
    expect(motionScrollBehavior()).toBe('smooth')
  })

  it('no matchMedia, or one that throws → false', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
    vi.stubGlobal('matchMedia', () => {
      throw new Error('boom')
    })
    expect(prefersReducedMotion()).toBe(false)
  })
})
