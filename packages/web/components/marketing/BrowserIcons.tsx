import type { ReactElement } from 'react'
import type { StoreId } from '@/lib/stores'

export function ChromeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" role="img" aria-label="Chrome">
      <circle cx="10" cy="10" r="10" fill="#4285F4" />
      <path d="M10 10 L10 1 A9 9 0 0 1 17.79 14.5 Z" fill="#EA4335" />
      <path d="M10 10 L17.79 14.5 A9 9 0 0 1 2.21 14.5 Z" fill="#FBBC05" />
      <path d="M10 10 L2.21 14.5 A9 9 0 0 1 10 1 Z" fill="#34A853" />
      <circle cx="10" cy="10" r="5.5" fill="white" />
      <circle cx="10" cy="10" r="3.8" fill="#4285F4" />
    </svg>
  )
}

export function FirefoxIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" role="img" aria-label="Firefox">
      <circle cx="10" cy="10" r="9" fill="#0060DF" />
      <path
        d="M10 1.5C9.4 1.5 8 1.8 7 2.5c.7.1 1.3.4 1.7.9C6.5 3.8 4.8 5.3 4 7c-.5 1-.7 2.1-.7 3.2 0 3.7 3 6.7 6.7 6.7s6.7-3 6.7-6.7c0-1.6-.6-3.2-1.6-4.4-.2.9-.7 1.7-1.4 2.2.1-.7.1-1.5-.1-2.2-.3-1-1-1.9-1.9-2.4-.4.8-.5 1.7-.3 2.6-.6-.5-1-1.2-1-2-.1-.4 0-.8.1-1.2L10 1.5z"
        fill="#FF9500"
      />
      <path
        d="M10.5 5.5c.3 1 .2 2.2-.4 3-.4.6-1 1-1.7 1.2-.3.1-.7.1-1 0-.2.7-.1 1.5.3 2.1.5.8 1.4 1.2 2.3 1.2 1.8 0 3.2-1.4 3.2-3.2 0-1.7-1-3.1-2.7-4.3z"
        fill="#FF4F00"
      />
      <ellipse cx="8" cy="9" rx="2" ry="2.5" fill="rgba(255,255,255,0.18)" />
    </svg>
  )
}

export function EdgeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" role="img" aria-label="Edge">
      <path
        d="M10 1.5C5.3 1.5 1.5 5.3 1.5 10c0 4.7 3.8 8.5 8.5 8.5 2.1 0 4-.8 5.5-2H8.5C6.6 16.5 5 14.9 5 13s1.6-3.5 3.5-3.5H18c.3-.9.5-1.9.5-3 0-2.8-1.5-5.2-3.7-6.5-.6 1.1-.8 2.4-.5 3.7-1-1.2-1.5-2.8-1.3-4.2z"
        fill="#0078D4"
      />
      <path
        d="M14.8 4.2C13.4 2.6 11.3 1.5 10 1.5c-.5 1.3-.4 2.8.3 4 .5.8 1.3 1.4 2.2 1.5 1-.2 1.8-.7 2.3-1.5.1-.4.1-.9 0-1.3z"
        fill="#50E6FF"
      />
      <path
        d="M15.5 16c1.2-1.3 2-3 2-4.8v-.7H8.5c-1 0-2 .8-2 1.8 0 .6.3 1.1.7 1.4 1 .6 2.3.8 3.8.8 2 0 3.7-.5 4.5-1.3z"
        fill="#1DB5D5"
      />
    </svg>
  )
}

/**
 * The icon of the browser each store belongs to. Every icon carries its own accessible
 * name ("Chrome"); where the store is already written out as text next to it, wrap it in
 * an `aria-hidden` element so it isn't announced twice.
 */
export const STORE_ICON: Record<StoreId, (props: { size?: number }) => ReactElement> = {
  chrome: ChromeIcon,
  firefox: FirefoxIcon,
  edge: EdgeIcon,
}
