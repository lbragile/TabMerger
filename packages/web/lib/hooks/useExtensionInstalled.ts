'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { sendToExtension, onExtensionReady } from '@/lib/extensionMessaging'
import { EXTENSION_MESSAGE, WEB_BRIDGE } from '@tabmerger/shared'

const STORAGE_KEY = 'tm_extension_installed'

function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

function getPersistedInstalled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1'
}

function getServerPersistedInstalled(): boolean {
  return false
}

/**
 * Detects whether the TabMerger extension is installed via two redundant signals:
 *
 * 1. Active probe — `sendToExtension({ type: 'PING' })`, which tries every known
 *    store ID (Chrome Web Store, Edge Add-ons, dev) via `externally_connectable`
 *    until one answers. Resolves immediately on mount, no race. Only available
 *    when a compatible extension exists for this origin — `chrome.runtime` is
 *    undefined on regular pages, so the presence check IS the feature detection.
 * 2. Passive listener — the `INSTALLED` postMessage the extension's content script
 *    fires (once, on load) — see packages/extension/src/entrypoints/content.ts.
 *    The content script runs at `document_idle`, so there's a real race: if this
 *    hook mounts after the message already fired, it would miss it. Kept as a
 *    fallback since the active probe requires `externally_connectable` to be
 *    configured with this origin.
 * 3. `onExtensionReady` — the Firefox content-script relay's one-time `READY`
 *    announcement (see `lib/extensionMessaging.ts`). That listener is
 *    registered at module scope, not inside this effect, so `READY` firing
 *    before this hook mounts is still replayed to it.
 *
 * Either signal persists the `tm_extension_installed` localStorage flag so later
 * visits don't depend on catching either signal again.
 */
export function useExtensionInstalled(): boolean {
  // Cross-tab/cross-visit persisted flag — read safely (SSR snapshot is `false`,
  // localStorage doesn't exist on the server) via useSyncExternalStore instead of a
  // useState + mount effect, which is exactly the setState-in-effect cascading-render
  // pattern the react-hooks lint rule flags.
  const persisted = useSyncExternalStore(subscribeToStorage, getPersistedInstalled, getServerPersistedInstalled)
  // This tab's own probe/message confirmation — genuinely async signals arriving via a
  // callback, not a synchronous setState-in-effect (see PING/PONG and postMessage below).
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    let cancelled = false
    sendToExtension<{ type?: string }>({ type: EXTENSION_MESSAGE.PING }).then((result) => {
      if (cancelled) return
      if (result?.response?.type === EXTENSION_MESSAGE.PONG) {
        localStorage.setItem(STORAGE_KEY, '1')
        setConfirmed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (
        e.origin === window.location.origin &&
        e.data?.source === WEB_BRIDGE.EXTENSION_SOURCE &&
        e.data?.type === 'INSTALLED'
      ) {
        localStorage.setItem(STORAGE_KEY, '1')
        setConfirmed(true)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    return onExtensionReady(() => {
      localStorage.setItem(STORAGE_KEY, '1')
      setConfirmed(true)
    })
  }, [])

  return persisted || confirmed
}
