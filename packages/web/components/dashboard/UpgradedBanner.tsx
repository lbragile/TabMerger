'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  /** Plan name shown in the greeting, e.g. "Pro" or "Pro AI". */
  planName: string
}

/**
 * One-time "Welcome to Pro" notice shown after checkout redirects to `/dashboard?upgraded=1`.
 * Dismissing also removes `upgraded` from the URL, so a refresh doesn't bring it back.
 * `history.replaceState` (rather than `router.replace`) avoids re-running the server
 * component just to drop a query param; Next.js keeps its router in sync with it.
 */
export function UpgradedBanner({ planName }: Props) {
  const [dismissed, setDismissed] = useState(false)

  function dismiss() {
    setDismissed(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('upgraded')
    window.history.replaceState(null, '', url)
  }

  if (dismissed) return null

  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-lg border border-ok/30 bg-ok-soft p-4 text-sm text-ok"
    >
      <p>
        Welcome to {planName}! Your subscription is now active. Enjoy your new features.
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="-my-1 -mr-1 h-6 w-6 shrink-0 text-ok hover:bg-ok/10 hover:text-ok"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
