'use client'

import { useEffect } from 'react'
import { mediaMatches } from '@/lib/blog/media'

/** What reveals once: the article's sections. */
const TARGETS = '.blog-article .blog-section'

/**
 * One-shot reveal for the post (time-based, never scrubbed by scroll, so nothing is left half
 * drawn when scrolling stops). Only targets still below the viewport when the page loads are held
 * back (`data-reveal="pending"`); each plays once (`data-reveal="shown"`) the first time it comes
 * into view. With reduced motion, or without IntersectionObserver, nothing is held back. The
 * styles are in blog.css; without this script (crawlers, no JS) everything is simply shown.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    if (mediaMatches('(prefers-reduced-motion: reduce)')) return
    const targets = [...document.querySelectorAll<HTMLElement>(TARGETS)].filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight
    )
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).dataset.reveal = 'shown'
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px' }
    )
    for (const el of targets) {
      el.dataset.reveal = 'pending'
      observer.observe(el)
    }
    return () => {
      observer.disconnect()
      for (const el of targets) delete el.dataset.reveal
    }
  }, [])
  return null
}
