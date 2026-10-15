'use client'

import { useEffect, useState, type ReactNode } from 'react'

/** The longest the measurement scripts wait, after the page has loaded, for a first interaction. */
export const IDLE_DELAY_MS = 6000

/** What counts as the visitor having started to use the page. */
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const

/**
 * Runs `fn` once the page has loaded and the visitor starts using it (first press, key or
 * scroll), or after `IDLE_DELAY_MS` if they don't, and then only when the browser is idle. It
 * never competes with first paint, and a visitor who interacts is not left unmeasured.
 * Returns a function that cancels it.
 */
export function whenPageIdle(fn: () => void): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopWaiting = () => {
    clearTimeout(timer)
    for (const type of INTERACTION_EVENTS) globalThis.removeEventListener(type, go)
  }
  const go = () => {
    stopWaiting()
    if (cancelled) return
    if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(fn, { timeout: 2000 })
    else fn()
  }
  const run = () => {
    if (cancelled) return
    for (const type of INTERACTION_EVENTS) globalThis.addEventListener(type, go, { once: true, passive: true })
    timer = setTimeout(go, IDLE_DELAY_MS)
  }
  if (document.readyState === 'complete') run()
  else globalThis.addEventListener('load', run, { once: true })
  return () => {
    cancelled = true
    stopWaiting()
    globalThis.removeEventListener('load', run)
  }
}

/**
 * Mounts `children` only after the page has loaded and the browser is idle. Analytics scripts
 * have no business competing with the content for bandwidth and the main thread, and nothing
 * the visitor sees depends on them.
 */
export function DeferredOnLoad({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => whenPageIdle(() => setReady(true)), [])
  return ready ? <>{children}</> : null
}
