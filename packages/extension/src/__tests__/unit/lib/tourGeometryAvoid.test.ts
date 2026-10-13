import { describe, it, expect } from 'vitest'
import { cardPositionAvoiding, rectsCoincide, rectsOverlap, type TourRect } from '@/lib/tour'

const r = (left: number, top: number, width: number, height: number): TourRect => ({ left, top, width, height })

describe('rectsOverlap', () => {
  it('is true for rectangles that share area', () => {
    expect(rectsOverlap(r(0, 0, 10, 10), r(5, 5, 10, 10))).toBe(true)
    expect(rectsOverlap(r(0, 0, 100, 100), r(40, 40, 5, 5))).toBe(true)
  })
  it('is false for a shared edge or a corner touch', () => {
    expect(rectsOverlap(r(0, 0, 10, 10), r(10, 0, 10, 10))).toBe(false)
    expect(rectsOverlap(r(0, 0, 10, 10), r(0, 10, 10, 10))).toBe(false)
    expect(rectsOverlap(r(0, 0, 10, 10), r(10, 10, 10, 10))).toBe(false)
  })
  it('is false when apart', () => {
    expect(rectsOverlap(r(0, 0, 10, 10), r(50, 50, 10, 10))).toBe(false)
  })
})

describe('rectsCoincide', () => {
  const base = r(100, 100, 200, 40)
  it('is true for the same rectangle and for one within the tolerance on every side', () => {
    expect(rectsCoincide(base, base, 0)).toBe(true)
    expect(rectsCoincide(base, r(104, 96, 192, 48), 4)).toBe(true)
  })
  it('is true exactly at the tolerance and false just past it', () => {
    expect(rectsCoincide(base, r(104, 100, 196, 40), 4)).toBe(true)
    expect(rectsCoincide(base, r(104.01, 100, 195.99, 40), 4)).toBe(false)
  })
  it('checks each of the four sides', () => {
    expect(rectsCoincide(base, r(100, 105, 200, 35), 4)).toBe(false) // top
    expect(rectsCoincide(base, r(100, 100, 200, 46), 4)).toBe(false) // bottom
    expect(rectsCoincide(base, r(100, 100, 194, 40), 4)).toBe(false) // right
    expect(rectsCoincide(base, r(95, 100, 205, 40), 4)).toBe(false) // left
  })
})

describe('cardPositionAvoiding', () => {
  const frame = { width: 800, height: 600 }
  const card = { width: 300, height: 200 }
  const margin = 8

  it('keeps a position that is already clear, and any position when there is nothing to avoid', () => {
    const pos = { left: 400, top: 300 }
    expect(cardPositionAvoiding(pos, card, frame, margin, r(0, 0, 50, 50))).toBe(pos)
    expect(cardPositionAvoiding(pos, card, frame, margin, null)).toBe(pos)
  })

  it('moves to the corner nearest to where it was when it would cover the control', () => {
    // card at the bottom-left would cover a control there; the nearest clear corner is the top-left
    const avoid = r(20, 420, 100, 40)
    expect(cardPositionAvoiding({ left: 8, top: 392 }, card, frame, margin, avoid)).toEqual({ left: 8, top: 8 })
  })

  it('goes to the next nearest clear corner when the nearest one is covered too', () => {
    // covers the left side top and bottom, so the card goes to the right
    const avoid = r(0, 0, 330, 600)
    const moved = cardPositionAvoiding({ left: 8, top: 8 }, card, frame, margin, avoid)
    expect(moved.left).toBe(800 - 300 - 8)
    expect(rectsOverlap({ ...moved, ...card }, avoid)).toBe(false)
  })

  it('keeps the position when every corner covers the control', () => {
    const avoid = r(0, 0, 800, 600)
    const pos = { left: 100, top: 100 }
    expect(cardPositionAvoiding(pos, card, frame, margin, avoid)).toBe(pos)
  })

  it('never returns a corner outside the frame, even for a card wider than the frame', () => {
    const moved = cardPositionAvoiding({ left: 8, top: 8 }, { width: 900, height: 200 }, frame, margin, r(0, 0, 100, 100))
    expect(moved.left).toBeGreaterThanOrEqual(margin)
    expect(moved.top).toBeGreaterThanOrEqual(margin)
  })
})
