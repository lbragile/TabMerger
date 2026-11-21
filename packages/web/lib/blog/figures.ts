import { BLOG_BOXES } from '@/generated/blog'

/** An annotation box over a screenshot, in % of the image (so it scales with it). */
export interface FigureBox {
  l: number
  t: number
  w: number
  h: number
  /** Stable name of the box within its image (matches `boxes.json`). */
  id?: string
  /** The legend's name for the box (2–5 words; only shown when the figure has two or more). */
  label?: string
}

/**
 * A box as a post lists it: its `id` in the post's boxes.json (which gives the position) and its
 * legend name; numbers only for an image without recorded boxes.
 */
export type PostBox = Partial<Pick<FigureBox, 'l' | 't' | 'w' | 'h'>> & Pick<FigureBox, 'id' | 'label'>

/** A box with its badge number. */
export interface NumberedBox extends FigureBox {
  n: number
}

/**
 * The boxes of one figure numbered 1, 2, 3… in reading order: top to bottom, then left to right
 * (two boxes whose tops are within `rowTolerance` % count as one row). Every box gets a badge, so
 * the caption's ①, ② … legend always matches; nothing is numbered by hand in a post.
 */
export function numberBoxes(boxes: readonly FigureBox[] = [], rowTolerance = 2): NumberedBox[] {
  return [...boxes]
    .sort((a, b) => (Math.abs(a.t - b.t) <= rowTolerance ? a.l - b.l : a.t - b.t))
    .map((box, i) => ({ ...box, n: i + 1 }))
}

/** A figure number from the `figure` prop rehype-figure-numbers.mjs adds (a string in MDX). */
export function figureNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined
}

/** `/blog/<slug>/<stem>[-light|-dark][.webp]` → the post slug and the image stem without its theme. */
const IMAGE_PATH = /^\/blog\/([a-z0-9-]+)\/([a-z0-9-]+?)(?:-(?:light|dark))?(?:\.(?:webp|png|jpg))?$/

/**
 * A figure's boxes. The post decides what is annotated: its boxes, by `id` (and their legend names,
 * so a translated post translates them). Positions come from the post's recorded `boxes.json`
 * (generated/blog.ts `BLOG_BOXES`, measured from the live screens, in reading order) when it has
 * that image and id, matched by stem (themed captures by their light version, then the bare stem);
 * otherwise from the post's own numbers. Recorded boxes the post doesn't list are not shown, and
 * the recorded `label`s (the capture script's identifiers) never reach readers. Numbered 1..n in
 * reading order.
 */
export function figureBoxes(src: string, own: readonly PostBox[] = [], data: typeof BLOG_BOXES = BLOG_BOXES): NumberedBox[] {
  const match = IMAGE_PATH.exec(src)
  const recorded = (match && (data[match[1]]?.[`${match[2]}-light`] ?? data[match[1]]?.[match[2]])) || []
  const order = new Map(recorded.map((box, i) => [box.id, i]))
  const placed: { order: number; box: FigureBox }[] = []
  for (const box of own) {
    const hit = box.id !== undefined ? recorded.find((r) => r.id === box.id) : undefined
    if (hit) placed.push({ order: order.get(hit.id) ?? 0, box: { id: box.id, label: box.label, l: hit.l, t: hit.t, w: hit.w, h: hit.h } })
    else if ([box.l, box.t, box.w, box.h].every((v) => typeof v === 'number'))
      placed.push({ order: Number.POSITIVE_INFINITY, box: box as FigureBox })
  }
  // Recorded boxes keep the recorded (reading) order; hand-placed ones are sorted by position.
  if (placed.every((p) => Number.isFinite(p.order))) {
    return placed.sort((a, b) => a.order - b.order).map(({ box }, i) => ({ ...box, n: i + 1 }))
  }
  return numberBoxes(placed.map(({ box }) => box))
}
