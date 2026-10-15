'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { REFERENCE_ID_HINT } from './copy'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * The error's `digest` as a copyable reference ID. The digest is Next.js's hash of the error,
 * which matches the server log entry; it never contains the error message itself. The result of
 * copying is announced through a polite live region.
 */
export function ReferenceId({ digest }: { digest: string }) {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Digests are short hashes; the cap only guards the layout against anything unexpected.
  const id = digest.slice(0, 64)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function handleCopy() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(id)
      setState('copied')
    } catch {
      setState('failed')
    }
    timer.current = setTimeout(() => setState('idle'), 2500)
  }

  return (
    <div className="mt-6 flex w-full flex-col items-center gap-2">
      <div className="flex max-w-full items-center border border-border bg-surface2 text-[0.8125rem]">
        <span className="shrink-0 border-r border-border px-2.5 py-1.5 text-text3">Reference ID</span>
        <code className="min-w-0 truncate px-2.5 py-1.5 font-mono text-foreground" data-testid="error-reference-id">
          {id}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy reference ID"
          className="grid h-8 w-8 shrink-0 place-items-center border-l border-border text-text2 transition-colors hover:bg-surface3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {state === 'copied' ? (
            <Check className="h-3.5 w-3.5 text-ok" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <p className="max-w-[40ch] text-xs text-text3">{REFERENCE_ID_HINT}</p>
      <p role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Reference ID copied' : state === 'failed' ? 'Copy failed. Select the ID to copy it.' : ''}
      </p>
    </div>
  )
}
