import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReviewsCarousel, wrapOffset, stepTarget, swipeTarget } from '@/components/marketing/ReviewsCarousel'
import { CARD_STRIDE_PX } from '@/components/marketing/ReviewCard'

const S = CARD_STRIDE_PX

describe('wrapOffset', () => {
  it('wraps into [0, half) in both directions, so the loop is seamless either way', () => {
    expect(wrapOffset(0, 1000)).toBe(0)
    expect(wrapOffset(1250, 1000)).toBe(250)
    expect(wrapOffset(-250, 1000)).toBe(750)
  })

  it('stays at 0 before the track has been measured', () => {
    expect(wrapOffset(500, 0)).toBe(0)
  })
})

describe('stepTarget', () => {
  it('lands on the next or previous card boundary', () => {
    expect(stepTarget(0, 1)).toBe(S)
    expect(stepTarget(0, -1)).toBe(-S)
  })

  it('snaps to a boundary when pressed mid-scroll', () => {
    // Auto-scroll leaves the strip between cards; a step lands cleanly on one.
    expect(stepTarget(S * 2 + 100, 1)).toBe(S * 3)
    expect(stepTarget(S * 2 + 100, -1)).toBe(S)
  })
})

describe('swipeTarget', () => {
  it('snaps back to the starting card after a short swipe', () => {
    expect(swipeTarget(S * 2, -20)).toBe(S * 2)
    expect(swipeTarget(S * 2, 20)).toBe(S * 2)
  })

  it('moves one card on in the direction of a real swipe', () => {
    expect(swipeTarget(S * 2, -120)).toBe(S * 3) // finger left → next
    expect(swipeTarget(S * 2, 120)).toBe(S) // finger right → previous
  })

  it('follows a long fling past several cards', () => {
    expect(swipeTarget(0, -(S * 2 + 50))).toBe(S * 3)
  })
})

describe('ReviewsCarousel', () => {
  const renderCarousel = () =>
    render(
      <ReviewsCarousel>
        <a href="https://example.test/review/1">Read full review</a>
      </ReviewsCarousel>,
    )

  it('labels the arrow buttons for screen readers', () => {
    renderCarousel()
    expect(screen.getByRole('region', { name: 'Reviews' })).toHaveAttribute('aria-roledescription', 'carousel')
    expect(screen.getByRole('button', { name: 'Previous review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next review' })).toBeInTheDocument()
  })

  it('does not open a link when a swipe ends on it', () => {
    renderCarousel()
    const link = screen.getByRole('link')
    const onClick = vi.fn((e: MouseEvent) => e.preventDefault())
    link.addEventListener('click', onClick)

    fireEvent.pointerDown(link, { pointerId: 1, clientX: 200, pointerType: 'touch' })
    fireEvent.pointerMove(link, { pointerId: 1, clientX: 80, pointerType: 'touch' })
    fireEvent.pointerUp(link, { pointerId: 1, clientX: 80, pointerType: 'touch' })
    fireEvent.click(link)

    expect(onClick).not.toHaveBeenCalled()
  })

  it('still opens a link on a plain tap', () => {
    renderCarousel()
    const link = screen.getByRole('link')
    const onClick = vi.fn((e: MouseEvent) => e.preventDefault())
    link.addEventListener('click', onClick)

    fireEvent.pointerDown(link, { pointerId: 1, clientX: 200, pointerType: 'touch' })
    fireEvent.pointerMove(link, { pointerId: 1, clientX: 197, pointerType: 'touch' }) // under the drag threshold
    fireEvent.pointerUp(link, { pointerId: 1, clientX: 197, pointerType: 'touch' })
    fireEvent.click(link)

    expect(onClick).toHaveBeenCalledOnce()
  })

  describe('stepping, with reduced motion (steps jump instead of animating)', () => {
    const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())))

    beforeEach(() => {
      // jsdom has no layout or matchMedia: give the track a width, and ask for reduced motion.
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(S * 20)
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as typeof window.matchMedia
    })
    afterEach(() => {
      vi.restoreAllMocks()
      // @ts-expect-error — jsdom doesn't define it; remove the stub again.
      delete window.matchMedia
    })

    it('moves one card per press, and back', async () => {
      renderCarousel()
      const track = screen.getByTestId('reviews-track')
      await nextFrame()
      expect(track.style.transform).toBe('translate3d(0px,0,0)') // no auto-scroll under reduced motion

      fireEvent.click(screen.getByRole('button', { name: 'Next review' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next review' }))
      await nextFrame()
      expect(track.style.transform).toBe(`translate3d(${-2 * S}px,0,0)`)

      fireEvent.click(screen.getByRole('button', { name: 'Previous review' }))
      await nextFrame()
      expect(track.style.transform).toBe(`translate3d(${-S}px,0,0)`)
    })

    it('wraps backwards past the first card instead of stopping', async () => {
      renderCarousel()
      const track = screen.getByTestId('reviews-track')
      fireEvent.click(screen.getByRole('button', { name: 'Previous review' }))
      await nextFrame()
      // Half the track is S*10; one card back from 0 is the last card of the first half.
      expect(track.style.transform).toBe(`translate3d(${-(S * 10 - S)}px,0,0)`)
    })
  })
})
