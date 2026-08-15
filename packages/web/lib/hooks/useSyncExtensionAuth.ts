'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { EXTENSION_ID } from '@/lib/extensionId'

/**
 * Forwards the current Supabase session to the extension via
 * `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'SYNC_AUTH', ... })` —
 * the externally_connectable channel the extension's background script
 * listens on (`chrome.runtime.onMessageExternal`). Fires on every
 * `onAuthStateChange` event that carries a session (sign-in, token refresh,
 * initial load if already signed in), so the extension stays in sync
 * without needing its own content script or host permissions.
 *
 * Mirrors useExtensionInstalled's defensive style: no-op when `chrome` is
 * undefined (Firefox, non-Chromium) or the extension isn't
 * installed/reachable — `lastError` is read-and-discarded, never surfaced.
 */
export function useSyncExtensionAuth(): void {
  useEffect(() => {
    const supabase = createClient()

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime
      if (!runtime?.sendMessage || !session) return

      runtime.sendMessage(
        EXTENSION_ID,
        {
          type: 'SYNC_AUTH',
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        },
        () => {
          // Must read lastError even though we ignore it, or Chrome logs an unhandled warning.
          void runtime.lastError
        }
      )
    })

    return () => subscription.subscription.unsubscribe()
  }, [])
}
