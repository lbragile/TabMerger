'use client'

import { Children, isValidElement, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mediaMatches } from '@/lib/blog/media'

/** A slide's short name, used in the arrows' accessible names ("Next slide: Merge menu"). */
export interface CarouselStep {
  title: string
}

const reducedMotion = () => mediaMatches('(prefers-reduced-motion: reduce)')

/**
 * A sequence of similar screenshots as a carousel (WAI-ARIA carousel pattern, no autoplay).
 *
 * Every slide is in the server HTML, side by side in a horizontal scroll-snap track, so crawlers
 * see every figure and touch or trackpad swipes work natively. The only controls are two round
 * arrow buttons on the slide's sides (disabled, not hidden, at the ends) whose names say where
 * they go; arrow keys move while focus is inside; "Slide 2 of 3" is announced in a visually
 * hidden polite region, with position dots under the screenshot as a visual indicator. Slides other than the shown one are `inert` (out of the Tab order and the
 * accessibility tree, still in the HTML). The track takes the shown slide's height (a 200ms
 * transition, none with reduced motion); images keep their full aspect ratio.
 */
export function Carousel({ label, steps, children }: { label: string; steps: readonly CarouselStep[]; children: ReactNode }) {
  const t = useTranslations('blog.interactive')
  const slides = Children.toArray(children).filter(isValidElement)
  const total = slides.length
  const [current, setCurrent] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<(HTMLDivElement | null)[]>([])
  const arrows = useRef<HTMLDivElement>(null)

  // The track is as tall as the shown slide (not the tallest), so a short caption leaves no gap
  // below; and the arrows' layer covers exactly that slide's visible image (its top and height), so
  // they sit on the middle of the screenshot. DOM writes, kept current by one ResizeObserver.
  useEffect(() => {
    const slide = slideRefs.current[current]
    const layer = arrows.current
    const section = layer?.parentElement
    if (!slide || !layer || !section) return
    const sync = () => {
      if (track.current) track.current.style.height = `${slide.offsetHeight}px`
      const image = [...slide.querySelectorAll('img')].find((img) => img.offsetHeight > 0)
      if (!image) return
      const top = image.getBoundingClientRect().top - section.getBoundingClientRect().top
      layer.style.top = `${top}px`
      layer.style.height = `${image.offsetHeight}px`
    }
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    for (const img of slide.querySelectorAll('img')) observer.observe(img)
    observer.observe(slide)
    observer.observe(section)
    return () => observer.disconnect()
  }, [current])

  // The shown slide follows the scroll position (arrows, swipes and keys alike).
  useEffect(() => {
    const root = track.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(Number((entry.target as HTMLElement).dataset.index))
        }
      },
      { root, threshold: 0.6 }
    )
    for (const el of slideRefs.current) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [total])

  const go = (index: number) => {
    const next = Math.max(0, Math.min(total - 1, index))
    const target = slideRefs.current[next]
    if (!target) return
    // Horizontal only (`block: 'nearest'` leaves the page where it is); works in both directions.
    target.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'nearest', inline: 'start' })
    setCurrent(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if ((event.target as HTMLElement).closest('dialog, input, textarea, [role="menu"]')) return
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const forward = (event.key === 'ArrowRight') !== rtl
    event.preventDefault()
    go(current + (forward ? 1 : -1))
  }

  const title = (i: number) => steps[i]?.title ?? String(i + 1)
  const arrow =
    'absolute top-1/2 z-10 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border2 bg-background text-foreground shadow-sh2 transition-colors hover:bg-surface3 disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

  return (
    <section aria-roledescription={t('carousel')} aria-label={label} onKeyDown={onKeyDown} className="relative mb-5">
      <div
        ref={track}
        className="flex snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden overscroll-x-contain transition-[height] duration-200 ease-out motion-reduce:transition-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            ref={(el) => {
              slideRefs.current[i] = el
            }}
            data-index={i}
            role="group"
            aria-roledescription={t('slide')}
            aria-label={t('slideOf', { n: i + 1, total })}
            inert={i !== current ? true : undefined}
            className="w-full shrink-0 snap-start snap-always px-px [&>figure]:m-0 [&_figcaption]:mt-5"
          >
            {slide}
          </div>
        ))}
      </div>
      {/* Centred on the screenshot area (the caption sits under it), overlapping its edges. */}
      <div ref={arrows} className="pointer-events-none absolute inset-x-0 top-0 h-3/5" data-carousel-arrows="">
        <button
          type="button"
          onClick={() => go(current - 1)}
          disabled={current === 0}
          aria-label={current > 0 ? t('prevSlide', { title: title(current - 1) }) : t('prevSlideNone')}
          className={cn(arrow, 'pointer-events-auto -start-3')}
        >
          <ChevronLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        </button>
        <button
          type="button"
          onClick={() => go(current + 1)}
          disabled={current >= total - 1}
          aria-label={current < total - 1 ? t('nextSlide', { title: title(current + 1) }) : t('nextSlideNone')}
          className={cn(arrow, 'pointer-events-auto -end-3')}
        >
          <ChevronRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        </button>
        {/* Position dots, Instagram-style: an indicator only (the live region announces the
            position); just under the screenshot, above its caption. */}
        <div aria-hidden="true" data-carousel-dots="" className="absolute inset-x-0 top-full mt-1.5 flex justify-center gap-1.5">
          {slides.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-2 rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none',
                i === current ? 'w-5 bg-primary' : 'w-2 bg-text3'
              )}
            />
          ))}
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {t('slideStatus', { n: current + 1, total })}
      </p>
    </section>
  )
}
