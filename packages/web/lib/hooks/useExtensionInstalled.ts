'use client'

import { useEffect, useState } from 'react'
import { EXTENSION_ID } from '@/lib/extensionId'

// ponytail: no @types/chrome dep in this package — minimal ambient shape for the
// one API surface we touch (externally_connectable sendMessage probe).
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback: (response?: { type?: string; version?: string; ok?: boolean; reason?: string; message?: string }) => void
        ) => void
        lastError?: { message?: string }
      }
    }
  }
  const chrome: Window['chrome']
}

const STORAGE_KEY = 'tm_extension_installed'

/**
 * Detects whether the TabMerger extension is installed via two redundant signals:
 *
 * 1. Active probe — `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'PING' })`
 *    via `externally_connectable`. Resolves immediately on mount, no race. Only
 *    available when a compatible extension exists for this origin — `chrome.runtime`
 *    is undefined on regular pages, so the presence check IS the feature detection.
 * 2. Passive listener — the `INSTALLED` postMessage the extension's content script
 *    fires (once, on load) — see packages/extension/src/entrypoints/content.ts.
 *    The content script runs at `document_idle`, so there's a real race: if this
 *    hook mounts after the message already fired, it would miss it. Kept as a
 *    fallback since the active probe requires `externally_connectable` to be
 *    configured with this origin.
 *
 * Either signal persists the `tm_extension_installed` localStorage flag so later
 * visits don't depend on catching either signal again.
 */
export function useExtensionInstalled(): boolean {
  const [installed, setInstalled] = useState(false)

  // Read localStorage after mount — direct access in useState initializer crashes SSR
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === '1') setInstalled(true)
  }, [])

  useEffect(() => {
    const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime
    if (!runtime?.sendMessage) return

    runtime.sendMessage(EXTENSION_ID, { type: 'PING' }, (response?: { type?: string }) => {
      // Must read lastError even though we ignore it, or Chrome logs an unhandled warning.
      if (runtime.lastError) return
      if (response?.type === 'PONG') {
        localStorage.setItem(STORAGE_KEY, '1')
        setInstalled(true)
      }
    })
  }, [])

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (
        e.origin === window.location.origin &&
        e.data?.source === 'tabmerger-extension' &&
        e.data?.type === 'INSTALLED'
      ) {
        localStorage.setItem(STORAGE_KEY, '1')
        setInstalled(true)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return installed
}
