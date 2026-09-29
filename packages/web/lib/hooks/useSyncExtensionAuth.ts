'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendToExtension, sendToKnownExtension } from '@/lib/extensionMessaging'
import { EXTENSION_MESSAGE } from '@tabmerger/shared'

/**
 * Forwards the current Supabase session to the extension via
 * `sendToKnownExtension({ type: EXTENSION_MESSAGE.SYNC_AUTH, ... })` — the externally_connectable
 * channel the extension's background script listens on
 * (`chrome.runtime.onMessageExternal`). Fires on every `onAuthStateChange` event
 * that carries a session (sign-in, token refresh, initial load if already signed
 * in), so the extension stays in sync without needing its own content script or
 * host permissions.
 *
 * SYNC_AUTH carries live session tokens, so it is sent ONLY to a transport that
 * has already shown itself — an extension ID that answered PING, or (Firefox)
 * the postMessage relay after a PING reply or `READY` announcement — via
 * `sendToKnownExtension`'s session cache. It is never sprayed across every
 * known store ID or speculatively over postMessage. If nothing has responded
 * yet (e.g. this hook mounts before `useExtensionInstalled` gets a response),
 * we send one PING first (which itself falls back through every ID and then
 * postMessage) to establish which transport is real, then forward the session
 * to that one specifically.
 *
 * Mirrors useExtensionInstalled's defensive style: no-op when neither
 * `chrome.runtime` nor the postMessage relay ever answers.
 */
export function useSyncExtensionAuth(): void {
  useEffect(() => {
    const supabase = createClient()

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) return

      void (async () => {
        const known = await sendToKnownExtension({
          type: EXTENSION_MESSAGE.SYNC_AUTH,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        })
        if (known) return

        // No confirmed responder yet — probe with PING first so SYNC_AUTH only ever
        // reaches an ID we've verified is a real, reachable TabMerger extension.
        const pinged = await sendToExtension<{ type?: string }>({ type: EXTENSION_MESSAGE.PING })
        if (pinged?.response?.type !== EXTENSION_MESSAGE.PONG) return

        await sendToKnownExtension({
          type: EXTENSION_MESSAGE.SYNC_AUTH,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        })
      })()
    })

    return () => subscription.subscription.unsubscribe()
  }, [])
}
