'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The scroll controls' words (from `compare.table`, formatted by the server component). */
export interface CompareScrollLabels {
  previousTool: string
  nextTool: string
  /** Shown when there is no previous / next section (the button is disabled). */
  previousSection: string
  nextSection: string
  /** The section names, in page order (the translated group labels). */
  sections: readonly string[]
  /** Per section index: "Previous section: {name}" / "Next section: {name}" for the button that goes there. */
  goToPreviousSection: readonly string[]
  goToNextSection: readonly string[]
  /** Per section index: "Section {n} of {total}" (the visible "04 / 08" is hidden from assistive technology). */
  sectionOf: readonly string[]
}

/** What the box shows right now, measured from the DOM after every scroll and resize. */
export interface Metrics {
  /** Heights of the sticky product-name row and the sticky footer (section bar + legend). */
  header: number
  footer: number
  /** Inline size of the pinned columns (features, TabMerger), plus the start rail when there is one. */
  pinned: number
  /** The box's visible width (the section bar is exactly this wide while the table scrolls sideways). */
  width: number
  /** Whether there is more content in each direction (an edge fade shows there). */
  start: boolean
  end: boolean
  up: boolean
  down: boolean
  /** Whether the box scrolls at all on each axis (the controls only show when it does). */
  overflowX: boolean
  overflowY: boolean
  /** No room for the tool arrows in the page margins: they sit in rails inside the box instead. */
  rail: boolean
  /** The section at the top of the box (index into the section list). */
  section: number
}

const NOTHING: Metrics = {
  header: 0,
  footer: 0,
  pinned: 0,
  width: 0,
  start: false,
  end: false,
  up: false,
  down: false,
  overflowX: false,
  overflowY: false,
  rail: false,
  section: 0,
}

/** Rounding slack, in CSS pixels, for "at the edge" checks. */
const EDGE = 1
/** Arrow size and the gap to the box, in rem: the page margin must hold both for the outside arrows. */
const ARROW_REM = 2.5
const GUTTER_GAP_REM = 0.5

const subscribeNothing = () => () => {}
/** False on the server and while hydrating, true after: the controls never render without JavaScript. */
export const useHydrated = () =>
  useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  )

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
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

/** Section header tops, measured from the box's top edge. */
function sectionTops(box: HTMLElement): number[] {
  const top = box.getBoundingClientRect().top
  return sectionHeaders(box).map((th) => th.getBoundingClientRect().top - top)
}

function measure(box: HTMLElement): Metrics {
  const rtl = isRtl(box)
  const rect = box.getBoundingClientRect()
  const header = box.querySelector('thead')?.getBoundingClientRect().height ?? 0
  const footer = box.querySelector('tfoot')?.getBoundingClientRect().height ?? 0
  const maxX = box.scrollWidth - box.clientWidth
  const maxY = box.scrollHeight - box.clientHeight
  const x = Math.abs(box.scrollLeft)
  const y = box.scrollTop
  // Sideways scrolling (and so the tool arrows and rails) only exists in the "All tools" table:
  // with one competitor picked the layout is stacked and nothing is hidden sideways, whatever a
  // stale scroll width says.
  const stacked = box.closest('[data-compare-layout]')?.getAttribute('data-compare-layout') === 'stacked'
  const overflowX = !stacked && maxX > EDGE
  // The outside arrows need ARROW + GAP in both page margins; otherwise they move into rails.
  const margin = Math.min(rect.left, document.documentElement.clientWidth - rect.right)
  const rail = overflowX && margin < (ARROW_REM + GUTTER_GAP_REM) * remPx()
  // The pinned columns (features, TabMerger) end where TabMerger's header cell ends.
  const tabMerger = box.querySelector('thead th[data-product="tabmerger"]')
  const columns = overflowX && tabMerger ? inlineStartOf(tabMerger, box, rtl) + tabMerger.getBoundingClientRect().width : 0
  const pinned = columns + (rail ? ARROW_REM * remPx() : 0)
  const tops = sectionTops(box)
  // The section at the top: the last header at or above the line under the product row; at the
  // very bottom, the last section (it may never reach that line).
  let section = Math.max(0, tops.findLastIndex((t) => t <= header + EDGE))
  if (maxY > EDGE && y >= maxY - EDGE) section = tops.length - 1
  return {
    header,
    footer,
    pinned,
    width: box.clientWidth,
    start: x > EDGE,
    end: overflowX && x < maxX - EDGE,
    up: y > EDGE,
    down: maxY > EDGE && y < maxY - EDGE,
    overflowX,
    overflowY: maxY > EDGE,
    rail,
    section,
  }
}

/** Smooth unless the visitor asked for less motion. */
const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

/** The square, token-styled control shared by the tool arrows and the section bar's ends. */
export const CONTROL_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const ARROW = cn(
  'inline-flex h-10 w-10 items-center justify-center border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted',
  'disabled:cursor-not-allowed disabled:opacity-40',
  CONTROL_FOCUS
)

/** A soft fade at one edge of the box, over content that can be scrolled into view from that side. */
const FADE = 'pointer-events-none absolute z-40 from-background to-transparent'

/** An opaque strip inside the box holding a tool arrow; cells slide under it. */
const RAIL = 'absolute z-40 flex w-10 items-center justify-center border-border bg-background'

interface CompareScrollState {
  metrics: Metrics
  labels: CompareScrollLabels
  /** Scrolls so section `index`'s header sits right under the product-name row. */
  goToSection: (index: number) => void
}

const CompareScrollContext = createContext<CompareScrollState | null>(null)

/** The scroll box's state, for the section bar inside its table (null outside the box). */
export const useCompareScroll = () => useContext(CompareScrollContext)

interface CompareScrollBoxProps {
  /** The id of the heading that names the box (the "Feature by feature" section heading). */
  labelledBy: string
  labels: CompareScrollLabels
  children: ReactNode
}

/**
 * The comparison table's scroll box (from `md` up; below it the page scrolls and the box doesn't).
 * Native scrollbars are hidden; instead:
 * - edge fades show where more content is;
 * - previous/next tool arrows move one competitor column (only when the table is wider than the
 *   box, i.e. "All tools"). They sit in the page margins, just outside the box, when the margins
 *   hold them; otherwise in opaque rails inside the box (after the pinned columns and at the
 *   inline end), with cells sliding under them;
 * - the section bar (`CompareSectionBar`, in the table's sticky footer) moves between sections.
 * Everything is measured from the DOM, so it follows RTL ("next tool" always moves toward later
 * columns), the pinned feature and TabMerger columns, and the chosen layout. Wheel, trackpad,
 * keyboard (the box is a focusable region) and touch scrolling all keep working. Nothing here
 * renders without JavaScript; the server HTML is the complete table.
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
    // Re-measure as soon as the picker switches between "All tools" and one competitor.
    const layout = box.closest('[data-compare-layout]')
    const mutations = layout && typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null
    if (layout) mutations?.observe(layout, { attributes: true, attributeFilter: ['data-compare-layout', 'data-chosen'] })
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
      mutations?.disconnect()
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
    const target = direction > 0 ? starts.find((s) => s > pinned + EDGE) : starts.findLast((s) => s < pinned - EDGE)
    if (target === undefined) return
    const delta = target - pinned
    box.scrollBy({ left: rtl ? -delta : delta, behavior: scrollBehavior() })
  }

  const goToSection = useCallback((index: number) => {
    const box = boxRef.current
    if (!box) return
    const { header } = measure(box)
    const top = sectionTops(box)[index]
    if (top === undefined) return
    box.scrollBy({ top: top - header, behavior: scrollBehavior() })
  }, [])

  const between = { top: m.header, bottom: m.footer }
  const railWidth = `${ARROW_REM}rem`

  return (
    <CompareScrollContext.Provider value={{ metrics: m, labels, goToSection }}>
      <div className="relative mt-5 md:compare-stacked:max-w-[48rem]">
        {/* `relative` makes the box the containing block of the cells' sr-only (absolute) text, so
            that text is clipped by the box instead of widening the page. */}
        <div
          ref={boxRef}
          role="region"
          tabIndex={0}
          aria-labelledby={labelledBy}
          onScroll={update}
          // With rails, room after the last column so it can scroll fully out from under the end rail.
          style={m.rail ? { paddingInlineEnd: railWidth } : undefined}
          className={cn(
            'relative focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            // Short enough that, with the "Feature by feature" heading landed 1rem under the 4rem navbar,
            // the heading, lead, picker (9.625rem together) and the whole box fit on screen with ~2rem
            // to spare (17rem in all, measured at 1024-1920px wide); never below 24rem on short screens.
            'md:max-h-[max(24rem,calc(100svh-17rem))] md:overflow-auto',
            // No native scrollbars: the fades and controls say where more content is.
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
            {m.end && (
              <div
                aria-hidden="true"
                className={cn(FADE, 'w-6 ltr:bg-linear-to-l rtl:bg-linear-to-r')}
                style={{ ...between, insetInlineEnd: m.rail ? railWidth : 0 }}
              />
            )}
            {m.overflowX &&
              (m.rail ? (
                <>
                  <div
                    className={cn(RAIL, 'border-e shadow-[0.25rem_0_0.5rem_-0.25rem_hsl(var(--foreground)/0.12)] rtl:shadow-[-0.25rem_0_0.5rem_-0.25rem_hsl(var(--foreground)/0.12)]')}
                    style={{ ...between, insetInlineStart: `calc(${m.pinned}px - ${railWidth})` }}
                  >
                    <ToolArrow direction={-1} disabled={!m.start} label={labels.previousTool} onClick={scrollColumn} />
                  </div>
                  <div
                    className={cn(RAIL, 'inset-e-0 border-s shadow-[-0.25rem_0_0.5rem_-0.25rem_hsl(var(--foreground)/0.12)] rtl:shadow-[0.25rem_0_0.5rem_-0.25rem_hsl(var(--foreground)/0.12)]')}
                    style={between}
                  >
                    <ToolArrow direction={1} disabled={!m.end} label={labels.nextTool} onClick={scrollColumn} />
                  </div>
                </>
              ) : (
                <>
                  {/* In the page margins, just outside the box, vertically centred on it. */}
                  <div className="absolute -inset-s-12 top-1/2 z-40 -translate-y-1/2">
                    <ToolArrow direction={-1} disabled={!m.start} label={labels.previousTool} onClick={scrollColumn} />
                  </div>
                  <div className="absolute -inset-e-12 top-1/2 z-40 -translate-y-1/2">
                    <ToolArrow direction={1} disabled={!m.end} label={labels.nextTool} onClick={scrollColumn} />
                  </div>
                </>
              ))}
          </>
        )}
      </div>
    </CompareScrollContext.Provider>
  )
}

/** A previous (`-1`) or next (`1`) tool arrow; the chevron mirrors in RTL. */
function ToolArrow({
  direction,
  disabled,
  label,
  onClick,
}: {
  direction: 1 | -1
  disabled: boolean
  label: string
  onClick: (direction: 1 | -1) => void
}) {
  const Icon = direction > 0 ? ChevronRight : ChevronLeft
  return (
    <button type="button" className={ARROW} onClick={() => onClick(direction)} disabled={disabled} aria-label={label}>
      <Icon aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
    </button>
  )
}
