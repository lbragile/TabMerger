'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Copy } from 'lucide-react'
import { useBlogPostState } from '@/components/blog/BlogPostState'
import { copyText } from '@/lib/blog/clipboard'
import { cn } from '@/lib/utils'

/**
 * A small icon button after a link (or a browser address) in a post that copies its absolute URL.
 * Named "Copy link: <url>" / "Copy address: <url>"; the result goes to the page's live region.
 * Always visible on touch screens; on a mouse it is faint until the link or the button is hovered
 * or focused (the parent `group/link`). The Copy → Check swap keeps the same box, so nothing moves.
 */
export function CopyLinkButton({ url, kind = 'link' }: { url: string; kind?: 'link' | 'address' }) {
  const t = useTranslations('blog.interactive')
  const { announce } = useBlogPostState()
  const [done, setDone] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const label = kind === 'address' ? t('copyAddress', { url }) : t('copyLinkTo', { url })
  const onClick = async () => {
    if (await copyText(url)) {
      setDone(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setDone(false), 1500)
      announce(t('copied'))
    } else {
      announce(t('copyFailed', { url }))
    }
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'mx-0.5 inline-flex size-6 items-center justify-center align-[-0.3em] text-text3 transition-opacity hover:text-foreground',
        'focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        'pointer-fine:opacity-40 pointer-fine:group-hover/link:opacity-100 pointer-fine:group-focus-within/link:opacity-100 pointer-fine:hover:opacity-100'
      )}
    >
      {done ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
    </button>
  )
}
