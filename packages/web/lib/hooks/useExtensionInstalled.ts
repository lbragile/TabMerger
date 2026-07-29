'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'tm_extension_installed'

/**
 * Detects whether the TabMerger extension is installed by listening for the
 * `INSTALLED` postMessage the extension's content script fires (once, on load)
 * on any page matching the web app's own origin — see
 * packages/extension/src/entrypoints/content.ts.
 *
 * The content script runs at `document_idle`, so there's a real race: if this
 * hook mounts after the message already fired on this page load, it would miss
 * it. Once detected, we persist a flag to localStorage so later visits don't
 * depend on catching the message again.
 */
export function useExtensionInstalled(): boolean {
  const [installed, setInstalled] = useState(false)

  // Read localStorage after mount — direct access in useState initializer crashes SSR
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === '1') setInstalled(true)
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
