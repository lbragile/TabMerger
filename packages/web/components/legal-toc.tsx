'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export interface LegalTocItem {
  id: string
  label: string
}

/**
 * Sticky table-of-contents nav for legal pages (Terms, Privacy). Tracks which
 * `<section id="...">` is currently under the sticky nav via IntersectionObserver
 * and highlights the corresponding link.
 */
export function LegalToc({ items, heading }: { items: LegalTocItem[]; heading: string }) {
  const [activeId, setActiveId] = useState(items[0]?.id)

  useEffect(() => {
    // ponytail: jsdom (test env) has no IntersectionObserver — skip scroll-spy there,
    // static first-item highlight from useState above still covers the test assertions.
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      // top-24 sticky nav + scroll-mt-24 sections: treat a section as "current"
      // once its header has crossed just below the sticky nav.
      { rootMargin: '-100px 0px -70% 0px', threshold: 0 }
    )

    items.forEach((item) => {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [items])

  return (
    <nav className="hidden lg:flex sticky top-24 flex-col gap-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-text3 mb-1">{heading}</div>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
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
