'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { deriveWrappingKey, unwrapDataKey, exportKeyToBase64, importKeyFromBase64, KDF_ITERATIONS } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/client'

function base64ToBuf(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

type Status = 'checking' | 'no-key' | 'locked' | 'unlocked'

interface EncryptionKeyContextValue {
  status: Status
  /** In-memory, backed by a sessionStorage cache (see module doc). Cleared on tab/browser close. */
  dataKey: CryptoKey | null
  unlock: (passphrase: string) => Promise<boolean>
}

// ponytail: default (no-op unlock, 'no-key' status) rather than throw-if-missing — lets
// components/tests that don't touch encrypted content render without wrapping in the provider.
const defaultValue: EncryptionKeyContextValue = {
  status: 'no-key',
  dataKey: null,
  unlock: async () => false,
}

const EncryptionKeyContext = createContext<EncryptionKeyContextValue>(defaultValue)

const SESSION_KEY_PREFIX = 'tabmerger:dataKey:'

/**
 * Per-account sessionStorage key. Scoping by user id mirrors the extension's
 * `hasEncryptionKey()` fix (see extension-dev learnings on cross-account cache
 * bugs) — without it, a second account signing into the same tab could read
 * the first account's cached key.
 */
function sessionKeyFor(userId: string): string {
  return `${SESSION_KEY_PREFIX}${userId}`
}

/**
 * ponytail: raw key material, base64-encoded, sits in sessionStorage for this
 * tab's lifetime so navigation/refresh don't re-prompt for the passphrase.
 * Tradeoff: any XSS elsewhere on the page can read it for as long as the tab
 * is open (sessionStorage isn't accessible cross-tab or after the tab closes,
 * unlike localStorage, but it's still page-readable). This is inherent to any
 * sessionStorage-based key cache, not fixable here — only mitigated by there
 * being no XSS elsewhere. Chose this over re-prompting every navigation
 * because the friction was worse than the (pre-existing, app-wide) XSS
 * blast-radius this adds to.
 */
async function cacheDataKey(userId: string, key: CryptoKey): Promise<void> {
  const raw = await exportKeyToBase64(key)
  sessionStorage.setItem(sessionKeyFor(userId), raw)
}

async function readCachedDataKey(userId: string): Promise<CryptoKey | null> {
  const raw = sessionStorage.getItem(sessionKeyFor(userId))
  if (!raw) return null
  try {
    return await importKeyFromBase64(raw)
  } catch {
    sessionStorage.removeItem(sessionKeyFor(userId))
    return null
  }
}

export function clearCachedDataKey(userId: string): void {
  sessionStorage.removeItem(sessionKeyFor(userId))
}

/**
 * Clears every cached data key in this tab, regardless of account. Used on
 * sign-out, where the signing-out user's id isn't worth threading through
 * just to look up one key — only one account is ever signed in per tab.
 */
export function clearAllCachedDataKeys(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(SESSION_KEY_PREFIX)) sessionStorage.removeItem(key)
  }
}

/**
 * Web equivalent of the extension's `encryptionKey.ts` unlock flow. The
 * unwrapped data key is cached in `sessionStorage` (base64, per-account) so it
 * survives page navigation/refresh within the tab without re-prompting for
 * the passphrase, and is gone when the tab/browser closes. See {@link cacheDataKey}
 * for the security tradeoff this implies.
 */
export function EncryptionKeyProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
  const [dataKey, setDataKey] = useState<CryptoKey | null>(null)
  // ponytail: row is re-fetched on unlock rather than cached here — this only runs once
  // per page load and isn't worth threading through state.

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const user = (await supabase.auth?.getUser?.())?.data?.user
      if (!user) return

      const cached = await readCachedDataKey(user.id)
      if (cached) {
        if (!cancelled) {
          setDataKey(cached)
          setStatus('unlocked')
        }
        return
      }

      const { data: row } = await supabase
        .from('encryption_keys')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!cancelled) setStatus(row ? 'locked' : 'no-key')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const unlock = useCallback(async (passphrase: string): Promise<boolean> => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data: row, error } = await supabase
      .from('encryption_keys')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !row) return false

    try {
      const salt = base64ToBuf(row.salt as string)
      const wrappingKey = await deriveWrappingKey(passphrase, salt, (row.kdf_iterations as number) ?? KDF_ITERATIONS)
      // extractable: true — only the web app needs to export this into sessionStorage.
      const unwrapped = await unwrapDataKey(row.wrapped_key as string, row.wrap_iv as string, wrappingKey, true)
      await cacheDataKey(user.id, unwrapped)
      setDataKey(unwrapped)
      setStatus('unlocked')
      return true
    } catch {
      // wrong passphrase — GCM auth tag check on the wrapped key fails
      return false
    }
  }, [])

  const value = useMemo(() => ({ status, dataKey, unlock }), [status, dataKey, unlock])

  return <EncryptionKeyContext.Provider value={value}>{children}</EncryptionKeyContext.Provider>
}

export function useEncryptionKey(): EncryptionKeyContextValue {
  return useContext(EncryptionKeyContext)
}
