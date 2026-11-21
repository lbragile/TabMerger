import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { FigureOverlays } from '@/components/blog/FigureOverlays'
import { MarkerBadge } from '@/components/blog/MarkerBadge'
import { ZoomTrigger, type ZoomFigure } from '@/components/blog/FigureLightbox'
import { figureBoxes, figureNumber, type NumberedBox, type PostBox } from '@/lib/blog/figures'
import { cn } from '@/lib/utils'

export type { FigureBox } from '@/lib/blog/figures'

/**
 * A captioned, numbered screenshot with its annotation overlays, which opens in the lightbox.
 * Badges are numbered 1..n per image in reading order (`numberBoxes`), the figure number comes
 * from rehype-figure-numbers.mjs and starts the caption. Shared by `AnnotatedFigure` (one image)
 * and `ThemedScreenshot` (light and dark captures).
 */
export function FigureFrame({
  image,
  zoom,
  boxes = [],
  figure,
  caption,
  source,
  small = false,
  className,
}: {
  image: ReactNode
  zoom: Pick<ZoomFigure, 'src' | 'alt' | 'width' | 'height'>
  boxes?: readonly PostBox[]
  /** Set by rehype-figure-numbers.mjs (a string in MDX). */
  figure?: number | string
  caption?: ReactNode
  /** Where and on what version it was captured ("chrome://bookmarks · Chrome 157.0.8103.79"). */
  source?: string
  /** Smaller caption and badges, for figures in a grid. */
  small?: boolean
  className?: string
}) {
  const t = useTranslations('blog.interactive')
  const numbered = figureBoxes(typeof zoom.src === 'string' ? zoom.src : zoom.src.light, boxes)
  const n = figureNumber(figure)
  const label = n ? <span className="font-semibold text-foreground">{t('figure', { n })}</span> : null
  // A legend only tells numbered boxes apart: one box gets neither a number nor a legend.
  const legend = numbered.length > 1 ? numbered : []
  return (
    <figure className={cn('m-0', className)}>
      <div className="relative">
        <ZoomTrigger
          figure={{
            ...zoom,
            figure: n,
            boxes: numbered,
            caption: <FigureCaptionBody figureLabel={label} caption={caption} legend={legend} inverted />,
            source,
          }}
        >
          {image}
          <FigureOverlays boxes={numbered} />
        </ZoomTrigger>
      </div>
      {(caption || source || label || legend.length > 0) && (
        <figcaption className={cn('mt-2.5 leading-normal text-text2', small ? 'text-sm' : 'text-[0.9375rem]')}>
          <FigureCaptionBody figureLabel={label} caption={caption} legend={legend} />
          {source && <span className="mt-1 block font-mono text-xs text-text3">{source}</span>}
        </figcaption>
      )}
    </figure>
  )
}

/** A legend text with `inline code` spans rendered as code. */
function LegendText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="bg-surface3 px-1 font-mono text-[0.9em] text-foreground">
            {part}
          </code>
        ) : (
          part
        )
      )}
    </>
  )
}

/** One legend entry: the marker's badge (hidden from screen readers) and "Marker 1: …" for them. */
function LegendEntry({ box }: { box: NumberedBox }) {
  const t = useTranslations('blog.interactive')
  return (
    <>
      <MarkerBadge n={box.n} className="mt-px" />
      <span className="min-w-0">
        <span className="sr-only">
          {t('marker', { n: box.n })}{' '}
        </span>
        <LegendText text={box.label ?? ''} />
      </span>
    </>
  )
}

/**
 * "Figure N", the caption (what the screenshot shows and why it matters), then, for two or more
 * boxes, the legend: one marker per row (badge + a 2–5 word name) in badge order.
 */
function FigureCaptionBody({
  figureLabel,
  caption,
  legend,
  inverted = false,
}: {
  figureLabel: ReactNode
  caption?: ReactNode
  legend: readonly NumberedBox[]
  /** On the lightbox's dark backdrop. */
  inverted?: boolean
}) {
  if (legend.length === 1 && !caption) {
    return (
      <span className="flex flex-wrap items-start gap-x-2 gap-y-1">
        {figureLabel}
        <span className="flex min-w-0 items-start gap-2">
          <LegendEntry box={legend[0]} />
        </span>
      </span>
    )
  }
  return (
    <>
      {(figureLabel || caption) && (
        <span className={cn('block', inverted && '[&_.text-foreground]:text-white')}>
          {figureLabel} {caption}
        </span>
      )}
      {legend.length > 0 && (
        <ol className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
          {legend.map((box) => (
            <li key={box.n} className="flex items-start gap-2">
              <LegendEntry box={box} />
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

/** Two related standalone figures side by side from 64rem, stacked below; never more than two in a row. */
export function FigureGrid({ children }: { children: ReactNode }) {
  return <div className="mb-8 grid gap-6 lg:grid-cols-2">{children}</div>
}
