import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ReviewsCarousel,
  wrapOffset,
  stepTarget,
  swipeTarget,
  revealTarget,
  nearestOnLoop,
} from '@/components/marketing/ReviewsCarousel'
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

  it('steps by the stride it is given: a narrow screen has narrower cards', () => {
    expect(stepTarget(0, 1, 288)).toBe(288)
    expect(stepTarget(288 * 2 + 40, -1, 288)).toBe(288)
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

  it('settles on the boundaries of the stride it is given', () => {
    expect(swipeTarget(288 * 2, -120, 288)).toBe(288 * 3)
  })
})

describe('revealTarget', () => {
  // A 320px card in a 1000px viewport.
  it('leaves the strip alone when the card is already fully in view', () => {
    expect(revealTarget(500, 320, 1000, 400)).toBeNull()
    expect(revealTarget(400, 320, 1000, 400)).toBeNull() // flush with the left edge
    expect(revealTarget(1080, 320, 1000, 400)).toBeNull() // flush with the right edge
  })

  it('brings a card cut off at the left to the left edge', () => {
    expect(revealTarget(300, 320, 1000, 400)).toBe(300)
  })

  it('brings a card cut off at, or beyond, the right to the right edge', () => {
    expect(revealTarget(1200, 320, 1000, 400)).toBe(1200 + 320 - 1000)
    expect(revealTarget(5000, 320, 1000, 400)).toBe(5000 + 320 - 1000)
  })

  it('aligns a card wider than the viewport to the left edge', () => {
    expect(revealTarget(900, 320, 272, 0)).toBe(900)
  })
})

describe('nearestOnLoop', () => {
  it('goes straight there when that is the short way', () => {
    expect(nearestOnLoop(100, 400, 6000)).toBe(400)
    expect(nearestOnLoop(400, 100, 6000)).toBe(100)
  })

  it('goes round the loop when that is shorter than running back through every card', () => {
    // From near the end to the start: 200px forward, not 5800px back.
    expect(nearestOnLoop(5800, 0, 6000)).toBe(6000)
    // And the other way round.
    expect(nearestOnLoop(100, 5900, 6000)).toBe(-100)
  })

  it('is the same place on the loop either way', () => {
    expect(wrapOffset(nearestOnLoop(5800, 0, 6000), 6000)).toBe(0)
    expect(wrapOffset(nearestOnLoop(100, 5900, 6000), 6000)).toBe(5900)
  })
})

describe('ReviewsCarousel', () => {
  const renderCarousel = () =>
    render(
      <>
        <h2 id="heading">What people are saying</h2>
        <ReviewsCarousel labelledBy="heading">
          <div data-testid="card">
            <p>Review text</p>
            <a href="https://example.test/review/1">Read full review</a>
          </div>
        </ReviewsCarousel>
      </>,
    )

  const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
  /** px scrolled, read back from the transform the loop writes. */
  const offset = () => {
    const match = /translate3d\((-?[\d.]+)px/.exec(screen.getByTestId('reviews-track').style.transform)
    // `|| 0`: the track at rest is "0px", and its negation is -0.
    return match ? -Number.parseFloat(match[1]) || 0 : Number.NaN
  }
  const pauseButton = () => screen.getByRole('button', { name: /^(Pause|Play) reviews$/ })

  it('is a carousel region named by the section heading', () => {
    renderCarousel()
    expect(screen.getByRole('region', { name: 'What people are saying' })).toHaveAttribute(
      'aria-roledescription',
      'carousel',
    )
  })

  it('labels the arrow buttons for screen readers', () => {
    renderCarousel()
    expect(screen.getByRole('button', { name: 'Previous review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next review' })).toBeInTheDocument()
  })

  it('keeps the arrows over the edges of the strip, from sm up, with no control row', () => {
    renderCarousel()
    const prev = screen.getByRole('button', { name: 'Previous review' })
    const next = screen.getByRole('button', { name: 'Next review' })
    for (const arrow of [prev, next]) {
      expect(arrow.className).toMatch(/\bhidden sm:flex absolute\b/)
      // Direct children of the region: not wrapped in a row of their own.
      expect(arrow.parentElement).toBe(screen.getByRole('region'))
    }
    expect(prev.className).toMatch(/\bleft-3\b/)
    expect(next.className).toMatch(/\bright-3\b/)
  })

  it('puts every control before the track in the DOM, so Tab reaches them before the review links', () => {
    renderCarousel()
    const link = screen.getByRole('link')
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual([
      'Pause reviews',
      'Previous review',
      'Next review',
    ])
    for (const button of buttons) {
      expect(button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('exposes the track as a list', () => {
    renderCarousel()
    expect(screen.getByTestId('reviews-track')).toHaveAttribute('role', 'list')
  })

  it('uses a focus ring in the text colour, not the brand colour', () => {
    renderCarousel()
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toMatch(/focus-visible:ring-foreground/)
      expect(button.className).not.toMatch(/ring-primary/)
    }
  })

  describe('pause button', () => {
    it('is a real button, hidden until the keyboard focuses it', () => {
      renderCarousel()
      const button = pauseButton()
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveAttribute('type', 'button')
      expect(button.className).toMatch(/(^|\s)sr-only(\s|$)/)
      expect(button.className).toMatch(/focus-visible:not-sr-only/)
      // Positioned when shown, so it appears over the strip without moving anything.
      expect(button.className).toMatch(/focus-visible:absolute/)
    })

    it('starts as "Pause reviews", not pressed', () => {
      renderCarousel()
      expect(pauseButton()).toHaveAccessibleName('Pause reviews')
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('becomes "Play reviews", pressed, and back again', () => {
      renderCarousel()
      fireEvent.click(pauseButton())
      expect(pauseButton()).toHaveAccessibleName('Play reviews')
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(pauseButton())
      expect(pauseButton()).toHaveAccessibleName('Pause reviews')
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('is not rendered under reduced motion: nothing moves on its own there', () => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as typeof window.matchMedia
      try {
        renderCarousel()
        expect(screen.queryByRole('button', { name: /(Pause|Play) reviews/ })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Next review' })).toBeInTheDocument()
      } finally {
        // @ts-expect-error — jsdom doesn't define it; remove the stub again.
        delete window.matchMedia
      }
    })
  })

  describe('auto-scroll', () => {
    // One fake clock for frames and for performance.now(): jsdom's own two don't share an
    // origin, which a browser's do and the loop relies on.
    const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
      // jsdom has no layout: give the track a width so there is a loop to scroll round.
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(S * 20)
    })
    afterEach(() => {
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('runs on its own, stops while paused, and runs again after play', () => {
      renderCarousel()
      run(1000)
      const moving = offset()
      expect(moving).toBeGreaterThan(30) // 40px a second

      fireEvent.click(pauseButton())
      run(50)
      const stopped = offset()
      run(2000)
      expect(offset()).toBe(stopped)

      fireEvent.click(pauseButton())
      run(1000)
      expect(offset()).toBeGreaterThan(stopped + 30)
    })

    it('stays paused when the pointer leaves and focus moves away', () => {
      renderCarousel()
      const region = screen.getByRole('region')
      fireEvent.click(pauseButton())
      run(50)

      fireEvent.pointerEnter(region, { pointerType: 'mouse' })
      fireEvent.pointerLeave(region, { pointerType: 'mouse' })
      fireEvent.focus(screen.getByRole('link'))
      fireEvent.blur(screen.getByRole('link'))
      run(1000) // the strip settles on the card that had focus
      const stopped = offset()
      run(10_000)

      expect(offset()).toBe(stopped)
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'true')
    })

    it('still pauses while the strip is hovered with a mouse, and resumes when the mouse leaves', () => {
      renderCarousel()
      const region = screen.getByRole('region')
      run(500)

      fireEvent.pointerEnter(region, { pointerType: 'mouse' })
      run(50)
      const held = offset()
      run(2000)
      expect(offset()).toBe(held)

      fireEvent.pointerLeave(region, { pointerType: 'mouse' })
      run(1000)
      expect(offset()).toBeGreaterThan(held + 30)
    })

    it('ignores a touch "hover", which has no matching leave', () => {
      renderCarousel()
      fireEvent.pointerEnter(screen.getByRole('region'), { pointerType: 'touch' })
      run(1000)
      expect(offset()).toBeGreaterThan(30)
    })

    it('still pauses while a review link has focus, and resumes when it loses it', () => {
      renderCarousel()
      const link = screen.getByRole('link')
      run(500)

      fireEvent.focus(link)
      run(1000) // the strip settles on the focused card
      const held = offset()
      run(5000)
      expect(offset()).toBe(held)
      // Focus alone is not the visitor pressing pause.
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')

      fireEvent.blur(link)
      run(1000)
      expect(offset()).toBeGreaterThan(held + 30)
    })

    it('keeps running while a control has focus, so pressing play visibly starts it', () => {
      renderCarousel()
      fireEvent.focus(pauseButton())
      run(500)
      const before = offset()
      run(1000)
      expect(offset()).toBeGreaterThan(before + 30)
    })

    it('holds still for a few seconds after an arrow is pressed, then runs again', () => {
      renderCarousel()
      fireEvent.click(screen.getByRole('button', { name: 'Next review' }))
      run(1000) // the step itself
      const landed = offset()
      expect(landed % S).toBe(0)
      run(2000)
      expect(offset()).toBe(landed)

      run(3000)
      expect(offset()).toBeGreaterThan(landed + 30)
    })

    it('runs again as soon as the mouse leaves after an arrow was clicked', () => {
      renderCarousel()
      const region = screen.getByRole('region')
      const next = screen.getByRole('button', { name: 'Next review' })

      // A real click: the pointer is over the strip, and the arrow keeps focus afterwards.
      fireEvent.pointerEnter(region, { pointerType: 'mouse' })
      fireEvent.focus(next)
      fireEvent.click(next)
      run(1000)
      const landed = offset()
      expect(landed % S).toBe(0)

      // While the mouse stays, so does the strip: well past the hold after a step.
      run(10_000)
      expect(offset()).toBe(landed)

      fireEvent.pointerLeave(region, { pointerType: 'mouse' })
      run(1000)
      expect(offset()).toBeGreaterThan(landed + 30)
      // It was never the visitor pressing pause.
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('does not wait out the hold when the mouse leaves right after the click', () => {
      renderCarousel()
      const region = screen.getByRole('region')
      fireEvent.pointerEnter(region, { pointerType: 'mouse' })
      fireEvent.click(screen.getByRole('button', { name: 'Next review' }))
      run(500) // the step has landed; the 4s hold has barely begun
      const landed = offset()

      fireEvent.pointerLeave(region, { pointerType: 'mouse' })
      run(1000)
      expect(offset()).toBeGreaterThan(landed + 30)
    })

    it('runs again a few seconds after a swipe ends', () => {
      renderCarousel()
      const card = screen.getByTestId('card')
      fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, pointerType: 'touch' })
      fireEvent.pointerMove(card, { pointerId: 1, clientX: 80, pointerType: 'touch' })
      fireEvent.pointerUp(card, { pointerId: 1, clientX: 80, pointerType: 'touch' })
      run(1000)
      const landed = offset()
      expect(landed % S).toBe(0)

      run(5000)
      expect(offset()).toBeGreaterThan(landed + 30)
    })

    it('stays stopped after a tap pauses it, until a second tap', () => {
      renderCarousel()
      const text = screen.getByText('Review text')
      const tap = () => {
        fireEvent.pointerDown(text, { pointerId: 1, clientX: 200, pointerType: 'touch' })
        fireEvent.pointerUp(text, { pointerId: 1, clientX: 201, pointerType: 'touch' })
      }
      run(500)
      tap()
      run(50)
      const stopped = offset()
      run(30_000)
      expect(offset()).toBe(stopped)

      tap()
      run(1000)
      expect(offset()).toBeGreaterThan(stopped + 30)
    })
  })

  // Only the pause button and a tap on the strip pause for good. Stepping and swiping move
  // the strip and leave the paused state alone.
  describe('what sets the paused state', () => {
    it.each(['Previous review', 'Next review'])('pressing "%s" does not', (name) => {
      renderCarousel()
      fireEvent.click(screen.getByRole('button', { name }))
      expect(pauseButton()).toHaveAccessibleName('Pause reviews')
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('a swipe does not', () => {
      renderCarousel()
      const card = screen.getByTestId('card')
      fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, pointerType: 'touch' })
      fireEvent.pointerMove(card, { pointerId: 1, clientX: 80, pointerType: 'touch' })
      fireEvent.pointerUp(card, { pointerId: 1, clientX: 80, pointerType: 'touch' })
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('an arrow pressed while paused leaves it paused', () => {
      renderCarousel()
      fireEvent.click(pauseButton())
      fireEvent.click(screen.getByRole('button', { name: 'Next review' }))
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'true')
    })

    it('a tap on the strip pauses it on a touch screen, and a second tap starts it again', () => {
      renderCarousel()
      const text = screen.getByText('Review text')
      const tap = () => {
        fireEvent.pointerDown(text, { pointerId: 1, clientX: 200, pointerType: 'touch' })
        fireEvent.pointerUp(text, { pointerId: 1, clientX: 201, pointerType: 'touch' })
      }
      tap()
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'true')
      tap()
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('a tap on a link opens the link and does not pause', () => {
      renderCarousel()
      const link = screen.getByRole('link')
      fireEvent.pointerDown(link, { pointerId: 1, clientX: 200, pointerType: 'touch' })
      fireEvent.pointerUp(link, { pointerId: 1, clientX: 200, pointerType: 'touch' })
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('a cancelled touch (the page was scrolled instead) does not pause', () => {
      renderCarousel()
      const text = screen.getByText('Review text')
      fireEvent.pointerDown(text, { pointerId: 1, clientX: 200, pointerType: 'touch' })
      fireEvent.pointerCancel(text, { pointerId: 1, clientX: 200, pointerType: 'touch' })
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('a mouse click on the strip does not pause: hovering already holds it still', () => {
      renderCarousel()
      const text = screen.getByText('Review text')
      fireEvent.pointerDown(text, { pointerId: 1, clientX: 200, pointerType: 'mouse', button: 0 })
      fireEvent.pointerUp(text, { pointerId: 1, clientX: 200, pointerType: 'mouse', button: 0 })
      expect(pauseButton()).toHaveAttribute('aria-pressed', 'false')
    })
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

  describe('with real card positions (stride measured from the DOM)', () => {
    // Six 272px cards 288px apart, in a 700px viewport: what a narrow layout reports.
    const STRIDE = 288
    const CARD = 272

    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
        return Number(this.dataset.index ?? 0) * STRIDE
      })
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(CARD)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700)
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

    const renderCards = () =>
      render(
        <>
          <h2 id="heading">What people are saying</h2>
          <ReviewsCarousel labelledBy="heading">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} data-index={i}>
                <a href={`https://example.test/review/${i}`}>Review {i}</a>
              </div>
            ))}
          </ReviewsCarousel>
        </>,
      )

    it('steps by the measured stride, not the nominal one', async () => {
      renderCards()
      fireEvent.click(screen.getByRole('button', { name: 'Next review' }))
      await nextFrame()
      expect(offset()).toBe(STRIDE)
    })

    it('wraps at half the cards times the stride', async () => {
      renderCards()
      fireEvent.click(screen.getByRole('button', { name: 'Previous review' }))
      await nextFrame()
      // Three cards per half: one back from the start is the third card.
      expect(offset()).toBe(3 * STRIDE - STRIDE)
    })

    it('moves the strip so a focused card outside the viewport is fully in view', async () => {
      renderCards()
      await nextFrame()
      expect(offset()).toBe(0)

      // Card 2 spans 576–848: cut off by the 700px viewport.
      fireEvent.focus(screen.getByRole('link', { name: 'Review 2' }))
      await nextFrame()
      expect(offset()).toBe(2 * STRIDE + CARD - 700)
    })

    it('leaves the strip where it is when the focused card is already in view', async () => {
      renderCards()
      fireEvent.focus(screen.getByRole('link', { name: 'Review 1' }))
      await nextFrame()
      expect(offset()).toBe(0)
    })

    it('does not move the strip under a link that is being pressed with a pointer', async () => {
      renderCards()
      const link = screen.getByRole('link', { name: 'Review 2' })
      fireEvent.pointerDown(link, { pointerId: 1, clientX: 600, pointerType: 'mouse', button: 0 })
      fireEvent.focus(link)
      await nextFrame()
      expect(offset()).toBe(0)
    })
  })
})
