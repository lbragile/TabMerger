'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { CARD_STRIDE_PX, CAROUSEL_TRACK_CLASS, CAROUSEL_VIEWPORT_CLASS } from './reviewsLayout'

/**
 * The reviews strip: scrolls on its own, and can be paused, stepped a card at a time with
 * the arrow buttons, or dragged/swiped. It replaces a CSS keyframe marquee, which
 * can't be driven by the user — a keyframe owns `transform`, so there's no way to
 * nudge it left or right, or follow a finger.
 *
 * Motion is one number, `offset` (px scrolled), applied as a transform every frame.
 * The track is two identical halves (see buildMarqueeTrack), so rendering
 * `offset mod halfWidth` loops seamlessly in both directions.
 *
 * Auto-scroll stops for good (until it is started again, or the page is reloaded) only
 * when the visitor says so:
 * - with the pause button. Content that moves on its own for more than five seconds needs
 *   a way to stop it that doesn't depend on a mouse. Decision: the button is not shown; it
 *   is the first control in the tab order and appears at the strip's top-left corner when
 *   the keyboard reaches it, and screen readers find it there too;
 * - by tapping the strip on a touch screen (anywhere but a link), which starts it again too.
 *
 * It stops for a while:
 * - while the strip is hovered or a link in a card has focus (so a card being read, or a
 *   link being tabbed to, doesn't move). Focus on the buttons doesn't count: an arrow that
 *   was clicked keeps focus, and so does the play button once pressed, and the strip has
 *   to start moving all the same;
 * - for a few seconds after a step, a swipe, or the strip moving itself to show a focused
 *   card. Decision: stepping and swiping never pause for good. A mouse leaving the strip
 *   ends that wait at once, since hovering is what was holding it.
 *
 * And it never runs under prefers-reduced-motion. There, buttons and swipes jump instead of
 * animating, and there is no pause button, having nothing to pause.
 *
 * The buttons come before the cards in the DOM, so Tab reaches them before the review
 * links. They are positioned over the strip, so that order changes nothing on screen.
 * Decision: the arrows are shown from `sm` up only; a phone moves the strip by swiping.
 */

const AUTO_SPEED_PX_PER_S = 40
const STEP_MS = 350
/** After a click or swipe, hold still this long before auto-scroll resumes. */
const RESUME_AFTER_MS = 4000
/** Pointer travel before a press becomes a drag; below it, it's a click. */
const DRAG_THRESHOLD_PX = 6
/** How far a swipe must travel to move on a card rather than snap back. */
const SWIPE_COMMIT_FRACTION = 0.15

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** `offset` wrapped into [0, half). */
export function wrapOffset(offset: number, half: number): number {
  if (half <= 0) return 0
  return ((offset % half) + half) % half
}

/**
 * Where a prev/next press lands: the card boundary `dir` cards from `base`. `base`
 * is the in-flight step's target when one is running, so rapid clicks queue up
 * rather than each restarting from mid-animation.
 */
export function stepTarget(base: number, dir: -1 | 1, stride = CARD_STRIDE_PX): number {
  return (Math.round(base / stride) + dir) * stride
}

/**
 * Where a released swipe settles. `dragged` is pointer travel in px (negative =
 * finger moved left = content moves on). Past the commit distance it moves to the
 * next card in the swipe's direction; short of it, it snaps back to the card it
 * started on.
 */
export function swipeTarget(startOffset: number, dragged: number, stride = CARD_STRIDE_PX): number {
  const start = Math.round(startOffset / stride) * stride
  if (Math.abs(dragged) < stride * SWIPE_COMMIT_FRACTION) return start
  const moved = startOffset - dragged
  return dragged < 0 ? Math.ceil(moved / stride) * stride : Math.floor(moved / stride) * stride
}

/**
 * The offset that brings a card fully into view, or null when it already is.
 *
 * `cardLeft` is the card's position along the track, `offset` the wrapped offset (the track
 * position at the viewport's left edge). The card moves the shortest distance: to the left
 * edge when it is cut off there, to the right edge when it is cut off there. A card wider
 * than the viewport is aligned to the left edge.
 */
export function revealTarget(cardLeft: number, cardWidth: number, viewportWidth: number, offset: number): number | null {
  const fits = cardWidth <= viewportWidth
  if (cardLeft < offset) return cardLeft
  if (cardLeft + cardWidth > offset + viewportWidth) return fits ? cardLeft + cardWidth - viewportWidth : cardLeft
  return null
}

/**
 * The same place on the loop as `to`, but the one nearest to `from`: the track repeats every
 * `half`, so going from the end of the loop to its start is a short step forward, not a
 * long run backward through every card.
 */
export function nearestOnLoop(from: number, to: number, half: number): number {
  if (half <= 0) return to
  let delta = (to - from) % half
  if (delta > half / 2) delta -= half
  if (delta < -half / 2) delta += half
  return from + delta
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia?.(REDUCED_MOTION_QUERY)
  mq?.addEventListener?.('change', onChange)
  return () => mq?.removeEventListener?.('change', onChange)
}
const prefersReducedMotion = () => !!window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches

// The ring is the text colour, not the brand cyan: in the light theme that is under 3:1
// against the page.
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background'

const arrowClass =
  'hidden sm:flex absolute top-1/2 -translate-y-1/2 z-10 h-10 w-10 items-center justify-center rounded-full ' +
  'border border-border bg-background/90 backdrop-blur text-foreground shadow-sm transition-colors ' +
  `hover:bg-surface ${focusRing}`

// Hidden until the keyboard focuses it, then a small button over the strip's top-left
// corner. It is positioned, so showing it moves nothing.
const pauseClass =
  'sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-3 focus-visible:top-3 focus-visible:z-20 ' +
  'focus-visible:inline-flex focus-visible:h-8 focus-visible:items-center focus-visible:gap-1.5 focus-visible:rounded-full ' +
  'focus-visible:border focus-visible:border-border focus-visible:bg-background focus-visible:px-3 ' +
  `focus-visible:text-[0.75rem] focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-sm ${focusRing}`

export function ReviewsCarousel({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const m = useRef({
    offset: 0,
    half: 0,
    stride: CARD_STRIDE_PX,
    hovered: false,
    focused: false,
    userPaused: false,
    reducedMotion: false,
    resumeAt: 0,
    tween: null as null | { from: number; to: number; start: number },
    drag: null as null | { pointerId: number; startX: number; startOffset: number; active: boolean },
    suppressClick: false,
  })
  // The same two facts the loop reads from the ref, as state, for what is rendered.
  const [paused, setPaused] = useState(false)
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const s = m.current

    // The card narrows on a small screen, so the stride is read from the cards themselves.
    // The loop repeats every `cards / 2` strides: half the track's own width would be half
    // a gap short of that, a visible jump once per lap. Without layout (or with fewer than
    // two cards) there is nothing to read, and the nominal figures stand in.
    const measure = () => {
      const cards = track.children
      const first = cards[0] as HTMLElement | undefined
      const second = cards[1] as HTMLElement | undefined
      const stride = first && second ? second.offsetLeft - first.offsetLeft : 0
      if (stride > 0) {
        s.stride = stride
        s.half = (cards.length / 2) * stride
      } else {
        s.stride = CARD_STRIDE_PX
        s.half = track.scrollWidth / 2
      }
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(track)

    const mq = window.matchMedia?.(REDUCED_MOTION_QUERY)
    const onMotion = () => { s.reducedMotion = !!mq?.matches }
    onMotion()
    mq?.addEventListener?.('change', onMotion)

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000 // cap: a backgrounded tab resumes without a jump
      last = now
      if (s.tween) {
        // Clamped at 0 too: a frame's timestamp is when the frame began, which can be just
        // before the click that started the step.
        const t = Math.min(1, Math.max(0, (now - s.tween.start) / STEP_MS))
        s.offset = s.tween.from + (s.tween.to - s.tween.from) * easeOutCubic(t)
        if (t === 1) s.tween = null
      } else if (
        !s.userPaused &&
        !s.drag?.active &&
        !s.hovered &&
        !s.focused &&
        !s.reducedMotion &&
        now >= s.resumeAt
      ) {
        s.offset += AUTO_SPEED_PX_PER_S * dt
      }
      // Keep the raw number bounded while nothing is animating toward a target.
      if (!s.tween && !s.drag?.active) s.offset = wrapOffset(s.offset, s.half)
      track.style.transform = `translate3d(${-wrapOffset(s.offset, s.half)}px,0,0)`
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      mq?.removeEventListener?.('change', onMotion)
    }
  }, [])

  const goTo = (to: number) => {
    const s = m.current
    s.resumeAt = performance.now() + RESUME_AFTER_MS
    if (s.reducedMotion) {
      s.tween = null
      s.offset = to
      return
    }
    s.tween = { from: s.offset, to, start: performance.now() }
  }

  /** The loop reads the ref; the pause button renders the state. */
  const setUserPaused = (next: boolean) => {
    m.current.userPaused = next
    setPaused(next)
  }

  const step = (dir: -1 | 1) => {
    const s = m.current
    goTo(stepTarget(s.tween ? s.tween.to : s.offset, dir, s.stride))
  }

  /**
   * A link in a card received focus. Tabbing to a card outside the viewport would otherwise
   * leave the focused link out of sight, or have the browser scroll the viewport to it (see
   * onViewportScroll). So the strip itself moves until that card is fully in view.
   */
  const onTrackFocus = (e: React.FocusEvent) => {
    const s = m.current
    s.focused = true
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    viewport.scrollLeft = 0
    // Focus that comes from pressing a link: the card is under the pointer already, and
    // moving it away between press and release would lose the click.
    if (s.drag) return

    let card = e.target as HTMLElement
    while (card.parentElement && card.parentElement !== track) card = card.parentElement
    const first = track.firstElementChild as HTMLElement | null
    if (card.parentElement !== track || !first) return

    const offset = wrapOffset(s.offset, s.half)
    const target = revealTarget(card.offsetLeft - first.offsetLeft, card.offsetWidth, viewport.clientWidth, offset)
    if (target === null) return
    // Tween from the wrapped offset, so the distance is the short one nearestOnLoop picked.
    s.offset = offset
    goTo(nearestOnLoop(offset, target, s.half))
  }

  /**
   * The viewport clips the track (`overflow: hidden`), which still leaves it scrollable by
   * the browser: focusing a link, find-in-page and a screen reader's "scroll into view" all
   * scroll it. The loop only knows its own offset, so a scrolled viewport shows the wrong
   * cards, and blank space once it scrolls past the end of the track. It is put back to 0
   * here, before the frame is painted. When focus caused the scroll, onTrackFocus has
   * already moved the strip to the focused card; otherwise the distance scrolled is added
   * to the offset, so what the browser meant to show is still what is shown.
   */
  const onViewportScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const viewport = e.currentTarget
    const dx = viewport.scrollLeft
    viewport.scrollTop = 0
    if (dx === 0) return
    viewport.scrollLeft = 0
    const s = m.current
    if (s.focused) return
    s.tween = null
    s.offset += dx
    s.resumeAt = performance.now() + RESUME_AFTER_MS
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const s = m.current
    // Grab the strip where it is, even mid-step.
    s.tween = null
    s.drag = { pointerId: e.pointerId, startX: e.clientX, startOffset: s.offset, active: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = m.current.drag
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    if (!d.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      d.active = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    m.current.offset = d.startOffset - dx
  }

  const endDrag = (e: React.PointerEvent) => {
    const s = m.current
    const d = s.drag
    if (!d || d.pointerId !== e.pointerId) return
    s.drag = null
    if (!d.active) {
      // A press that never became a drag. On a touch screen that is a tap, and a tap on the
      // strip pauses it or starts it again: there is no hover there, and no visible button.
      // Not when the press was cancelled (the page was scrolled instead), and not on a
      // link, which the tap opens.
      const tapped = e.type === 'pointerup' && e.pointerType !== 'mouse'
      if (tapped && !(e.target as Element).closest?.('a')) setUserPaused(!s.userPaused)
      return
    }
    // A drag that ends over a card's link must not also open it.
    s.suppressClick = true
    goTo(swipeTarget(d.startOffset, e.clientX - d.startX, s.stride))
  }

  const onClickCapture = (e: React.MouseEvent) => {
    if (!m.current.suppressClick) return
    m.current.suppressClick = false
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      className="relative"
      role="region"
      aria-roledescription="carousel"
      aria-labelledby={labelledBy}
      // Mouse only: on touch screens a tap fires a synthetic mouseenter with no matching
      // leave, which would pause the strip for good after a single tap.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') m.current.hovered = true }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return
        m.current.hovered = false
        // The mouse held the strip still while it was over it; once it has left, the strip
        // moves again at once, without sitting out the rest of the hold after a step.
        m.current.resumeAt = 0
      }}
    >
      {/* Before the cards in the DOM: Tab reaches the controls first. */}
      {!reducedMotion && (
        <button type="button" aria-pressed={paused} onClick={() => setUserPaused(!paused)} className={pauseClass}>
          {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
          {paused ? 'Play reviews' : 'Pause reviews'}
        </button>
      )}
      {/* Arrows from sm up; on phones the strip is swiped instead. */}
      <button type="button" aria-label="Previous review" onClick={() => step(-1)} className={`${arrowClass} left-3`}>
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </button>
      <button type="button" aria-label="Next review" onClick={() => step(1)} className={`${arrowClass} right-3`}>
        <ChevronRight className="h-5 w-5" aria-hidden />
      </button>

      <div
        ref={viewportRef}
        // pan-y: vertical page scrolling stays native; horizontal gestures come here.
        className={`${CAROUSEL_VIEWPORT_CLASS} touch-pan-y select-none cursor-grab active:cursor-grabbing`}
        onScroll={onViewportScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* A list of the reviews: each card that isn't a hidden repeat is one item. */}
        <div
          ref={trackRef}
          role="list"
          className={`${CAROUSEL_TRACK_CLASS} will-change-transform`}
          data-testid="reviews-track"
          onFocus={onTrackFocus}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) m.current.focused = false
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
