'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * Displays the canonical share URL as a copyable chip so a visitor landing on a
 * shared-bundle page can see and copy the exact link, matching the surrounding
 * page's chip styling (rounded-md, border-border, text-text2).
 */
export function CopyShareUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-2 max-w-full h-8 px-2.5 rounded-md bg-surface2 border border-border text-[12.5px] text-text2 hover:text-text hover:border-border2 transition-colors"
      aria-label="Copy share link"
    >
      <span className="truncate font-mono">{url}</span>
      {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
    </button>
  )
}
