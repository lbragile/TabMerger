'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CONTROL_FOCUS, useCompareScroll, useHydrated } from './CompareScrollBox'

const END_BUTTON = cn(
  'flex h-full min-w-0 items-center gap-1.5 px-3.5 text-[0.8125rem] text-text2 transition-colors hover:bg-muted hover:text-foreground',
  'disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60 disabled:hover:bg-transparent',
  CONTROL_FOCUS,
  'focus-visible:-outline-offset-2'
)

/** "4" → "04", "8" → "08": the counter's fixed two-digit look. */
const twoDigits = (n: number) => String(n).padStart(2, '0')

/**
 * The section bar in the table's sticky footer, right above the legend (only while the box
 * scrolls, so from `md` up; never without JavaScript): "˄ previous section", the position
 * ("04 / 08", current number in primary) with the current section's name, and "next section ˅".
 * A primary line along its top shows progress through the sections. Each end jumps to its
 * neighbour, landing the section header right under the product-name row; at the first/last
 * section that end is disabled and shows no name. It is exactly as wide as the box's visible
 * area and sticks to its inline start, so it stays put while the table scrolls sideways. Not a
 * live region: scrolling would make it chatty.
 */
export function CompareSectionBar() {
  const hydrated = useHydrated()
  const scroll = useCompareScroll()
  if (!hydrated || !scroll || !scroll.metrics.overflowY) return null
  const { metrics, labels, goToSection } = scroll
  const total = labels.sections.length
  const index = Math.min(metrics.section, total - 1)
  const previous = index > 0 ? index - 1 : null
  const next = index < total - 1 ? index + 1 : null

  return (
    <div
      className="sticky inset-s-0 flex h-11 items-stretch border-b border-border bg-surface2 shadow-[0_-0.25rem_0.75rem_-0.25rem_hsl(var(--foreground)/0.12)]"
      style={{ width: metrics.width || undefined }}
    >
      {/* Progress through the sections. */}
      <span
        aria-hidden="true"
        className="absolute -top-px inset-s-0 h-0.5 bg-primary transition-[width]"
        style={{ width: `${((index + 1) / total) * 100}%` }}
      />
      <button
        type="button"
        className={cn(END_BUTTON, 'border-e border-border')}
        onClick={() => previous !== null && goToSection(previous)}
        disabled={previous === null}
        aria-label={previous === null ? labels.previousSection : labels.goToPreviousSection[previous]}
      >
        <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0" />
        {previous !== null && <span className="truncate">{labels.sections[previous]}</span>}
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-3 px-3">
        {/* Left to right in every language: "04 / 08", never "08 / 04". */}
        <span aria-hidden="true" dir="ltr" className="font-mono text-xs tabular-nums">
          <span className="text-primary">{twoDigits(index + 1)}</span>
          <span className="text-muted-foreground"> / {twoDigits(total)}</span>
        </span>
        <span className="sr-only">{labels.sectionOf[index]}</span>
        <span className="truncate text-sm font-semibold">{labels.sections[index]}</span>
      </div>
      <button
        type="button"
        className={cn(END_BUTTON, 'border-s border-border')}
        onClick={() => next !== null && goToSection(next)}
        disabled={next === null}
        aria-label={next === null ? labels.nextSection : labels.goToNextSection[next]}
      >
        {next !== null && <span className="truncate">{labels.sections[next]}</span>}
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
      </button>
    </div>
  )
}
