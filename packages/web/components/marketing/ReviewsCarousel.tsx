'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CARD_STRIDE_PX } from './ReviewCard'

/**
 * The reviews strip: scrolls on its own, and can be stepped a card at a time with
 * the arrow buttons or dragged/swiped. It replaces a CSS keyframe marquee, which
 * can't be driven by the user — a keyframe owns `transform`, so there's no way to
 * nudge it left or right, or follow a finger.
 *
 * Motion is one number, `offset` (px scrolled), applied as a transform every frame.
 * The track is two identical halves (see buildMarqueeTrack), so rendering
 * `offset mod halfWidth` loops seamlessly in both directions.
 *
 * Auto-scroll pauses while hovered or focused (so a card being read, or a link
 * being tabbed to, doesn't move), for a few seconds after any manual step or
 * swipe, and entirely under prefers-reduced-motion — there, buttons and swipes
 * jump instead of animating.
 */

const AUTO_SPEED_PX_PER_S = 40
const STEP_MS = 350
/** After a click or swipe, hold still this long before auto-scroll resumes. */
const RESUME_AFTER_MS = 4000
/** Pointer travel before a press becomes a drag; below it, it's a click. */
const DRAG_THRESHOLD_PX = 6
/** How far a swipe must travel to move on a card rather than snap back. */
const SWIPE_COMMIT_FRACTION = 0.15

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

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

export function ReviewsCarousel({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const m = useRef({
    offset: 0,
    half: 0,
    hovered: false,
    focused: false,
    reducedMotion: false,
    resumeAt: 0,
    tween: null as null | { from: number; to: number; start: number },
    drag: null as null | { pointerId: number; startX: number; startOffset: number; active: boolean },
    suppressClick: false,
  })

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const s = m.current

    const measure = () => { s.half = track.scrollWidth / 2 }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(track)

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onMotion = () => { s.reducedMotion = !!mq?.matches }
    onMotion()
    mq?.addEventListener?.('change', onMotion)

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000 // cap: a backgrounded tab resumes without a jump
      last = now
      if (s.tween) {
        const t = Math.min(1, (now - s.tween.start) / STEP_MS)
        s.offset = s.tween.from + (s.tween.to - s.tween.from) * easeOutCubic(t)
        if (t === 1) s.tween = null
      } else if (!s.drag?.active && !s.hovered && !s.focused && !s.reducedMotion && now >= s.resumeAt) {
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

  const step = (dir: -1 | 1) => {
    const s = m.current
    goTo(stepTarget(s.tween ? s.tween.to : s.offset, dir))
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
    if (!d.active) return
    // A drag that ends over a "Read full review" link must not also open it.
    s.suppressClick = true
    goTo(swipeTarget(d.startOffset, e.clientX - d.startX))
  }

  const onClickCapture = (e: React.MouseEvent) => {
    if (!m.current.suppressClick) return
    m.current.suppressClick = false
    e.preventDefault()
    e.stopPropagation()
  }

  const buttonClass =
    'hidden sm:flex absolute top-1/2 -translate-y-1/2 z-10 h-10 w-10 items-center justify-center rounded-full ' +
    'border border-border bg-background/90 backdrop-blur text-foreground shadow-sm transition-colors ' +
    'hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

  return (
    <div
      className="relative"
      role="region"
      aria-roledescription="carousel"
      aria-label="Reviews"
      // Mouse only: on touch screens a tap fires a synthetic mouseenter with no matching
      // leave, which would pause the strip for good after a single tap.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') m.current.hovered = true }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') m.current.hovered = false }}
      onFocus={() => { m.current.focused = true }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) m.current.focused = false
      }}
    >
      <div
        // pan-y: vertical page scrolling stays native; horizontal gestures come here.
        className="overflow-hidden touch-pan-y select-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
      >
        <div ref={trackRef} className="flex gap-4 w-max will-change-transform" data-testid="reviews-track">
          {children}
        </div>
      </div>

      {/* Arrows from sm up; on phones the strip is swiped instead. */}
      <button type="button" aria-label="Previous review" onClick={() => step(-1)} className={`${buttonClass} left-3`}>
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </button>
      <button type="button" aria-label="Next review" onClick={() => step(1)} className={`${buttonClass} right-3`}>
        <ChevronRight className="h-5 w-5" aria-hidden />
      </button>
    </div>
  )
}
