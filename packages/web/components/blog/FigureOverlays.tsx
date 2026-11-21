import { MARKER_BORDER, MarkerBadge } from '@/components/blog/MarkerBadge'
import type { NumberedBox } from '@/lib/blog/figures'
import { cn } from '@/lib/utils'

const pct = (n: number) => `${n}%`

/**
 * A figure's annotation boxes and their numbered badges, positioned in % over the image (the
 * parent must be `relative` and exactly the image's size), each badge on its box's top-start
 * corner. A figure with one box shows just the box (no number: there is nothing to tell apart).
 * `aria-hidden`: the caption's legend says what each number marks. Used on the page, in the lens
 * and, at full size, in the lightbox.
 */
export function FigureOverlays({ boxes, large = false }: { boxes: readonly NumberedBox[]; large?: boolean }) {
  if (boxes.length === 0) return null
  const numbered = boxes.length > 1
  return (
    <span aria-hidden="true">
      {boxes.map((box) => (
        <span key={box.n}>
          <span
            className={cn('pointer-events-none absolute box-border border-[0.1875rem]', MARKER_BORDER)}
            style={{ left: pct(box.l), top: pct(box.t), width: pct(box.w), height: pct(box.h) }}
          />
          {numbered && (
            <MarkerBadge
              n={box.n}
              className={cn('pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 shadow-sh1', large && 'size-7 text-sm')}
              style={{ left: pct(box.l), top: pct(box.t) }}
            />
          )}
        </span>
      ))}
    </span>
  )
}
