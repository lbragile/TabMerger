'use client'

import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function getSnapshot(): string {
  return window.location.hash
}

function getServerSnapshot(): string {
  // Fragments are never sent over HTTP, so the server has no way to know the hash —
  // this must be a stable placeholder, never a crash on `window`.
  return ''
}

/**
 * Reads `window.location.hash` safely across SSR/hydration via `useSyncExternalStore`
 * instead of `useState` + a mount effect (the latter is exactly the setState-in-effect
 * cascading-render pattern the `react-hooks/set-state-in-effect` rule flags). The server
 * snapshot is always `''`; the real value is picked up in the resync render that
 * `useSyncExternalStore` performs right after hydration, with no separate effect needed.
 */
export function useLocationHash(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
