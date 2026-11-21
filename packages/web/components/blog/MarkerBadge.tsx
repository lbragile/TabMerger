import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/**
 * A numbered marker: the same filled circle on the screenshot (over its box) and in the caption's
 * legend, so the two match. Colours: dark orange with white numerals on the light theme (about
 * 6:1 for the numerals, and the circle against a light caption background), bright orange with
 * near-black numerals on the dark theme. Always `aria-hidden`; the legend says "Marker 1:" in
 * screen-reader text instead.
 */
export function MarkerBadge({ n, className, style }: { n: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        'inline-grid size-6 shrink-0 place-items-center rounded-full bg-accent-foreground text-xs font-bold tabular-nums leading-none text-white dark:bg-secondary dark:text-neutral-950',
        className
      )}
    >
      {n}
    </span>
  )
}

/** The border colour of an annotation box, matching `MarkerBadge`. */
export const MARKER_BORDER = 'border-accent-foreground dark:border-secondary'
