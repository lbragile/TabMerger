'use client'

import { useEffect, useRef, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/**
 * The moving part of `ShellBackdrop` (error pages and /uninstalled): two soft glows, and a grid
 * that shows only in a circle around the pointer.
 *
 * One passive `pointermove` listener on `window` stores the pointer; the next
 * `requestAnimationFrame` callback reads this element's rect once, clamps the pointer to it, and
 * writes each glow's offset from its resting point in px as custom properties on this element
 * (`--g1x`/`--g1y` main glow, `--g2x`/`--g2y` trailing glow): one style write per frame.
 *
 * - The main glow, and the grid circle centred on it, sit exactly under the pointer: no easing,
 *   and no CSS transition on `transform`, either of which would add lag.
 * - The second glow eases only part of the way, slowly, so it trails behind for depth.
 * - The grid appears on the first move and fades out (opacity transition) when the pointer
 *   leaves the window, while both glows ease back to rest. The loop stops once settled.
 * - A passive scroll listener re-aims under a still pointer (the layer scrolls with the page).
 * - No React state changes per move.
 *
 * Static (no listener, no grid, glows at rest) under `prefers-reduced-motion: reduce`, on devices
 * without hover or with a coarse pointer, and where `matchMedia` is missing. The server output
 * sets no custom properties, so the `var(--g1x, 0px)` fallbacks put the glows at rest and
 * hydration matches.
 *
 * Colours and opacities are theme tokens in `globals.css` (`--glow-1`, `--glow-2`, `--grid-lit`).
 * No context or providers: `global-error.tsx` renders this after the root layout has failed.
 */
interface GlowConfig {
  /** Resting centre, as a fraction of the backdrop's width and height. */
  rest: { x: number; y: number }
  /**
   * Fraction of the remaining distance covered per frame. The main glow ignores it while the
   * pointer is in the window (it sits exactly under the pointer) and uses it only to ease back
   * to rest when the pointer leaves.
   */
  lerp: number
  /** Sit exactly under the pointer, no lag. */
  exact?: boolean
  /** How much of the way from rest to the pointer the glow travels (1 = centred on it). */
  reach: number
}

export const SHELL_GLOWS: [GlowConfig, GlowConfig] = [
  { rest: { x: 0.5, y: 0.25 }, lerp: 0.07, reach: 1, exact: true },
  { rest: { x: 0.62, y: 0.35 }, lerp: 0.04, reach: 0.6 },
]

/** Radius of the grid circle around the pointer. */
const LIT_RADIUS = '18rem'
/** Opacity of the grid circle. Lowered until body text over it reads as easily as elsewhere. */
export const LIT_OPACITY = '0.6'
/** Below this distance (px) on both axes a glow counts as settled. */
const SETTLE_PX = 0.1
const STATIC_QUERIES = ['(prefers-reduced-motion: reduce)', '(hover: none)', '(pointer: coarse)'] as const

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// 4rem cells: few lines cross the text.
const GRID_STYLE: CSSProperties = {
  backgroundImage:
    'linear-gradient(hsl(var(--grid-lit)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--grid-lit)) 1px, transparent 1px)',
  backgroundSize: '4rem 4rem',
}

// Big and heavily blurred so they read as a wash of colour rather than a spotlight.
const GLOW_CLASSES = ['h-[26rem] w-[26rem] sm:h-[36rem] sm:w-[36rem]', 'h-[18rem] w-[18rem] sm:h-[24rem] sm:w-[24rem]'] as const

export function ShellGlows() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof window.matchMedia !== 'function') return

    const queries = STATIC_QUERIES.map((q) => window.matchMedia(q))
    let pointer: { x: number; y: number } | null = null
    const offsets = SHELL_GLOWS.map(() => ({ x: 0, y: 0 }))
    let frame = 0
    let listening = false
    let lit = false

    const write = () => {
      offsets.forEach((o, i) => {
        el.style.setProperty(`--g${i + 1}x`, `${o.x.toFixed(2)}px`)
        el.style.setProperty(`--g${i + 1}y`, `${o.y.toFixed(2)}px`)
      })
    }
    const setLit = (on: boolean) => {
      lit = on
      if (on) el.style.setProperty('--lit', LIT_OPACITY)
      else el.style.removeProperty('--lit')
    }

    const tick = () => {
      frame = 0
      // Read once per frame, not per pointer event.
      const rect = el.getBoundingClientRect()
      let moving = false
      SHELL_GLOWS.forEach((glow, i) => {
        let tx = 0
        let ty = 0
        if (pointer && rect.width > 0 && rect.height > 0) {
          tx = (clamp(pointer.x - rect.left, 0, rect.width) - glow.rest.x * rect.width) * glow.reach
          ty = (clamp(pointer.y - rect.top, 0, rect.height) - glow.rest.y * rect.height) * glow.reach
        }
        const o = offsets[i]
        const factor = pointer && glow.exact ? 1 : glow.lerp
        o.x += (tx - o.x) * factor
        o.y += (ty - o.y) * factor
        if (Math.abs(tx - o.x) < SETTLE_PX && Math.abs(ty - o.y) < SETTLE_PX) {
          o.x = tx
          o.y = ty
        } else {
          moving = true
        }
      })
      write()
      if (moving) frame = requestAnimationFrame(tick)
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick)
    }

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY }
      if (!lit) setLit(true)
      schedule()
    }
    // The page moved under a still pointer: re-aim.
    const onScroll = () => {
      if (pointer) schedule()
    }
    // The pointer left the window: fade the grid out and drift back to rest.
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) {
        pointer = null
        setLit(false)
        schedule()
      }
    }

    const start = () => {
      if (listening) return
      listening = true
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('scroll', onScroll, { passive: true })
      document.addEventListener('pointerout', onOut, { passive: true })
    }
    const stop = () => {
      if (listening) {
        listening = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('scroll', onScroll)
        document.removeEventListener('pointerout', onOut)
      }
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      pointer = null
      offsets.forEach((o, i) => {
        o.x = 0
        o.y = 0
        el.style.removeProperty(`--g${i + 1}x`)
        el.style.removeProperty(`--g${i + 1}y`)
      })
      setLit(false)
    }

    const update = () => {
      if (queries.some((q) => q.matches)) stop()
      else start()
    }

    update()
    queries.forEach((q) => q.addEventListener?.('change', update))
    return () => {
      queries.forEach((q) => q.removeEventListener?.('change', update))
      stop()
    }
  }, [])

  const [main] = SHELL_GLOWS
  // Centred on the main glow, so on the pointer while it moves.
  const litMask = `radial-gradient(circle ${LIT_RADIUS} at calc(${main.rest.x * 100}% + var(--g1x, 0px)) calc(${main.rest.y * 100}% + var(--g1y, 0px)), black, transparent)`

  return (
    <div ref={ref} className="absolute inset-0" data-testid="backdrop-glows">
      {/* The grid, only in a circle around the pointer. Hidden (`--lit` unset) until the first
          move, after the pointer leaves, when static, and in the server output. The opacity
          transition is the fade in and out; position has none (that would lag). */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        data-testid="backdrop-lit-grid"
        style={{ ...GRID_STYLE, opacity: 'var(--lit, 0)', maskImage: litMask, WebkitMaskImage: litMask }}
      />
      {SHELL_GLOWS.map((glow, i) => (
        <div
          key={i}
          // `-translate-*` is the CSS `translate` property in Tailwind v4, so it centres the glow
          // on its resting point and composes with the `transform` that follows the pointer.
          className={cn(
            'absolute -translate-x-1/2 -translate-y-1/2 rounded-full blur-[7rem] will-change-transform',
            GLOW_CLASSES[i]
          )}
          style={{
            backgroundColor: `hsl(var(--glow-${i + 1}) / var(--glow-${i + 1}-alpha))`,
            left: `${glow.rest.x * 100}%`,
            top: `${glow.rest.y * 100}%`,
            transform: `translate3d(var(--g${i + 1}x, 0px), var(--g${i + 1}y, 0px), 0)`,
          }}
        />
      ))}
    </div>
  )
}
