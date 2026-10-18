'use client'

import { openCookieSettings } from '@/lib/consent'

/**
 * "Cookie settings": reopens the cookie banner so the visitor can change their choice. A button,
 * not a link, since it goes nowhere. The label comes from the (server-rendered) caller.
 */
export function CookieSettingsButton({ label, className }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={openCookieSettings} className={className}>
      {label}
    </button>
  )
}
