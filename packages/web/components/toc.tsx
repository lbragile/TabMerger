'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface TocItem {
  id: string
  label: string
}

interface TocProps {
  items: readonly TocItem[]
  /** Visible heading, also the nav landmark's name ("On this page"). */
  heading: string
  /**
   * `legal`: the compact list of the Terms, Privacy and beta pages. `article`: the blog's list,
   * with a bar marking the current section and 44px rows.
   */
  variant?: 'legal' | 'article'
  className?: string
}

/**
 * Sticky "On this page" nav, shown from the `lg` breakpoint (64rem) up. Tracks which
 * `<section id="...">` is under the sticky navbar with an IntersectionObserver, highlights its
 * link and marks it `aria-current="location"`.
 */
export function Toc({ items, heading, variant = 'legal', className }: TocProps) {
  const [activeId, setActiveId] = useState(items[0]?.id)
  const list = useRef<HTMLOListElement>(null)
  const indicator = useRef<HTMLSpanElement>(null)

  // The article variant's one bar slides to the current item (a DOM write, no state): CSS
  // transitions its transform and height, except for readers who asked for less motion.
  useEffect(() => {
    const bar = indicator.current
    const link = activeId ? list.current?.querySelector<HTMLElement>(`a[href="#${CSS.escape(activeId)}"]`) : null
    if (!bar || !link) return
    bar.style.transform = `translateY(${link.offsetTop}px)`
    bar.style.height = `${link.offsetHeight}px`
    bar.style.opacity = '1'
  }, [activeId])

  useEffect(() => {
    // jsdom (the test environment) has no IntersectionObserver: skip the scroll-spy there; the
    // first item stays highlighted from the initial state.
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      // The sticky navbar is 4rem and sections carry scroll-mt-24: a section is "current" once
      // its heading has crossed just below the navbar.
      { rootMargin: '-100px 0px -70% 0px', threshold: 0 }
    )

    items.forEach((item) => {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [items])

  if (variant === 'article') {
    return (
      <nav
        aria-label={heading}
        className={cn('hidden lg:block sticky top-22 max-h-[calc(100vh-6.5rem)] overflow-y-auto', className)}
      >
        <p className="mb-3 font-mono text-xs uppercase tracking-wider text-text3">{heading}</p>
        <ol ref={list} className="relative flex flex-col gap-0.5 text-[0.9375rem]">
          <span
            ref={indicator}
            aria-hidden="true"
            className="pointer-events-none absolute start-0 top-0 w-0.5 bg-primary opacity-0 transition-[transform,height] duration-200 ease-out motion-reduce:transition-none"
          />
          {items.map((item) => {
            const current = activeId === item.id
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={current ? 'location' : undefined}
                  onClick={() => setActiveId(item.id)}
                  className={cn(
                    'flex min-h-11 items-center px-3 py-1.5 transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    current ? 'bg-surface3 font-semibold text-foreground' : 'text-text2 hover:text-foreground'
                  )}
                >
                  {item.label}
                </a>
              </li>
            )
          })}
        </ol>
      </nav>
    )
  }

  return (
    <nav aria-label={heading} className={cn('hidden lg:flex sticky top-24 flex-col gap-2', className)}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-text3 mb-1">{heading}</div>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={activeId === item.id ? 'location' : undefined}
          onClick={() => setActiveId(item.id)}
          className={cn(
            'text-[13px] transition-colors',
            activeId === item.id ? 'text-primary font-medium' : 'text-text2 hover:text-primary'
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}
