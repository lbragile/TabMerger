'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The scroll controls' accessible names (from `compare.table`, passed in by the server component). */
export interface CompareScrollLabels {
  previousTool: string
  nextTool: string
  previousSection: string
  nextSection: string
}

/** What the box shows right now, measured from the DOM after every scroll and resize. */
interface Metrics {
  /** Heights of the sticky product-name row and legend, and the inline size of the pinned columns. */
  header: number
  footer: number
  pinned: number
  /** Whether there is more content in each direction (an edge fade shows there). */
  start: boolean
  end: boolean
  up: boolean
  down: boolean
  /** Whether the box scrolls at all on each axis (the arrows only show when it does). */
  overflowX: boolean
  overflowY: boolean
  /** Whether a section header lies above / below the line under the product-name row. */
  previousSection: boolean
  nextSection: boolean
  /** The name of the section at the top of the box. */
  section: string
}

const NOTHING: Metrics = {
  header: 0,
  footer: 0,
  pinned: 0,
  start: false,
  end: false,
  up: false,
  down: false,
  overflowX: false,
  overflowY: false,
  previousSection: false,
  nextSection: false,
  section: '',
}

/** Rounding slack, in CSS pixels, for "at the edge" checks. */
const EDGE = 1

const subscribeNothing = () => () => {}
/** False on the server and while hydrating, true after: the controls never render without JavaScript. */
const useHydrated = () =>
  useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  )

const isRtl = (el: Element) => getComputedStyle(el).direction === 'rtl'

/** The element's inline-start edge, measured from the box's visible inline-start edge (RTL-aware). */
function inlineStartOf(el: Element, box: HTMLElement, rtl: boolean): number {
  const boxRect = box.getBoundingClientRect()
  const rect = el.getBoundingClientRect()
  return rtl ? boxRect.right - rect.right : rect.left - boxRect.left
}

const isShown = (el: Element) => getComputedStyle(el).display !== 'none'

/** The competitor header cells currently shown, in column order. */
const competitorHeaders = (box: HTMLElement) => [...box.querySelectorAll('thead th[data-col]')].filter(isShown)

/** The section (group) header cells, in page order. */
const sectionHeaders = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>('tbody th[scope="colgroup"]')]

function measure(box: HTMLElement): Metrics {
  const rtl = isRtl(box)
  const boxTop = box.getBoundingClientRect().top
  const header = box.querySelector('thead')?.getBoundingClientRect().height ?? 0
  const footer = box.querySelector('tfoot')?.getBoundingClientRect().height ?? 0
  const maxX = box.scrollWidth - box.clientWidth
  const maxY = box.scrollHeight - box.clientHeight
  const x = Math.abs(box.scrollLeft)
  const y = box.scrollTop
  const overflowX = maxX > EDGE
  // The pinned columns (features, TabMerger) end where TabMerger's header cell ends.
  const tabMerger = box.querySelector('thead th[data-product="tabmerger"]')
  const pinned = overflowX && tabMerger ? inlineStartOf(tabMerger, box, rtl) + tabMerger.getBoundingClientRect().width : 0
  const sections = sectionHeaders(box).map((th) => ({ top: th.getBoundingClientRect().top - boxTop, name: th.textContent ?? '' }))
  const current = [...sections].reverse().find((s) => s.top <= header + EDGE) ?? sections[0]
  return {
    header,
    footer,
    pinned,
    start: x > EDGE,
    end: overflowX && x < maxX - EDGE,
    up: y > EDGE,
    down: maxY > EDGE && y < maxY - EDGE,
    overflowX,
    overflowY: maxY > EDGE,
    previousSection: sections.some((s) => s.top < header - EDGE),
    nextSection: y < maxY - EDGE && sections.some((s) => s.top > header + EDGE),
    section: current?.name ?? '',
  }
}

/** Smooth unless the visitor asked for less motion. */
const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

const ARROW =
  'inline-flex h-8 w-8 items-center justify-center border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40'

/** A soft fade at one edge of the box, over content that can be scrolled into view from that side. */
const FADE = 'pointer-events-none absolute z-40 from-background to-transparent'

interface CompareScrollBoxProps {
  /** The id of the heading that names the box (the "Feature by feature" section heading). */
  labelledBy: string
  labels: CompareScrollLabels
  children: ReactNode
}

/**
 * The comparison table's scroll box (from `md` up; below it the page scrolls and the box doesn't).
 * Native scrollbars are hidden: edge fades show where more content is, and arrow buttons move one
 * competitor column sideways (only when the table is wider than the box, i.e. "All tools") or one
 * section up or down, landing it just under the sticky product-name row. The arrows are measured
 * from the DOM, so they follow RTL ("next tool" always moves toward later columns), the pinned
 * feature and TabMerger columns, and the chosen layout. Wheel, trackpad, keyboard (the box is a
 * focusable region) and touch scrolling all keep working. Nothing here renders without
 * JavaScript; the server HTML is the complete table.
 */
export function CompareScrollBox({ labelledBy, labels, children }: CompareScrollBoxProps) {
  const hydrated = useHydrated()
  const boxRef = useRef<HTMLDivElement>(null)
  const [m, setMetrics] = useState<Metrics>(NOTHING)
  const frame = useRef(0)

  const update = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      if (boxRef.current) setMetrics(measure(boxRef.current))
    })
  }, [])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    update()
    window.addEventListener('resize', update)
    // Picking a competitor re-lays the table out; a ResizeObserver on the table catches that.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(box)
    const table = box.querySelector('table')
    if (table) observer?.observe(table)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
      cancelAnimationFrame(frame.current)
    }
  }, [update])

  /** Moves one competitor column toward the end (`1`) or the start (`-1`), aligned to the pinned edge. */
  const scrollColumn = (direction: 1 | -1) => {
    const box = boxRef.current
    if (!box) return
    const rtl = isRtl(box)
    const { pinned } = measure(box)
    const starts = competitorHeaders(box).map((th) => inlineStartOf(th, box, rtl))
    const target = direction > 0 ? starts.find((s) => s > pinned + EDGE) : [...starts].reverse().find((s) => s < pinned - EDGE)
    if (target === undefined) return
    const delta = target - pinned
    box.scrollBy({ left: rtl ? -delta : delta, behavior: scrollBehavior() })
  }

  /** Moves to the next (`1`) or previous (`-1`) section, its header landing under the product-name row. */
  const scrollSection = (direction: 1 | -1) => {
    const box = boxRef.current
    if (!box) return
    const { header } = measure(box)
    const boxTop = box.getBoundingClientRect().top
    const tops = sectionHeaders(box).map((th) => th.getBoundingClientRect().top - boxTop)
    const target = direction > 0 ? tops.find((t) => t > header + EDGE) : [...tops].reverse().find((t) => t < header - EDGE)
    if (target === undefined) return
    box.scrollBy({ top: target - header, behavior: scrollBehavior() })
  }

  const between = { top: m.header, bottom: m.footer }

  return (
    <div className="relative mt-5 md:compare-stacked:max-w-[48rem]">
      {/* `relative` makes the box the containing block of the cells' sr-only (absolute) text, so
          that text is clipped by the box instead of widening the page. */}
      <div
        ref={boxRef}
        role="region"
        tabIndex={0}
        aria-labelledby={labelledBy}
        onScroll={update}
        className={cn(
          'relative focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'md:max-h-[calc(100svh-6rem)] md:overflow-auto',
          // No native scrollbars: the fades and arrows below say where more content is.
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        {children}
      </div>
      {hydrated && (
        <>
          {m.up && <div aria-hidden="true" className={cn(FADE, 'inset-x-0 h-6 bg-linear-to-b')} style={{ top: m.header }} />}
          {m.down && <div aria-hidden="true" className={cn(FADE, 'inset-x-0 h-6 bg-linear-to-t')} style={{ bottom: m.footer }} />}
          {m.start && (
            <div
              aria-hidden="true"
              className={cn(FADE, 'w-6 ltr:bg-linear-to-r rtl:bg-linear-to-l')}
              style={{ ...between, insetInlineStart: m.pinned }}
            />
          )}
          {m.end && <div aria-hidden="true" className={cn(FADE, 'inset-e-0 w-6 ltr:bg-linear-to-l rtl:bg-linear-to-r')} style={between} />}
          {m.overflowX && (
            <>
              <button
                type="button"
                className={cn(ARROW, 'absolute top-1/2 z-40 ms-1 -translate-y-1/2')}
                style={{ insetInlineStart: m.pinned }}
                onClick={() => scrollColumn(-1)}
                disabled={!m.start}
                aria-label={labels.previousTool}
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
              </button>
              <button
                type="button"
                className={cn(ARROW, 'absolute inset-e-1 top-1/2 z-40 -translate-y-1/2')}
                onClick={() => scrollColumn(1)}
                disabled={!m.end}
                aria-label={labels.nextTool}
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
              </button>
            </>
          )}
          {m.overflowY && (
            // In the legend bar (its items sit at the inline start), so it never covers a cell.
            <div className="absolute inset-e-2 z-40 flex items-center gap-1" style={{ bottom: `max(0rem, calc((${m.footer}px - 2rem) / 2))` }}>
              {m.section && (
                <span className="max-w-[12rem] truncate border border-border bg-background px-2 py-1 text-xs font-medium text-text2 shadow-sm">
                  {m.section}
                </span>
              )}
              <button
                type="button"
                className={ARROW}
                onClick={() => scrollSection(-1)}
                disabled={!m.previousSection}
                aria-label={labels.previousSection}
              >
                <ChevronUp aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={ARROW}
                onClick={() => scrollSection(1)}
                disabled={!m.nextSection}
                aria-label={labels.nextSection}
              >
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
