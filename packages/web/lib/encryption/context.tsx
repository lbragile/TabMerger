'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  deriveWrappingKey,
  unwrapDataKey,
  exportKeyToBase64,
  importKeyFromBase64,
  KDF_ITERATIONS,
  type EncryptedBlob,
} from '@tabmerger/shared'
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
  /**
   * True once `dataKey` has been compared with the account's current `encryption_keys` row and
   * belongs to it. Only then is a row that fails to decrypt known to be an old row rather than a
   * sign of a stale key, so readers gate their "can't be read" note on it.
   */
  keyVerified: boolean
  unlock: (passphrase: string) => Promise<boolean>
  /**
   * Readers call this with the rows they could not decrypt (see {@link unreadableRowKey}). It
   * compares the cached key with the server's current key row and drops the key if the row was
   * replaced or removed, which brings the passphrase prompt back. Safe to call on every pass: rows
   * already examined under the current key, and rows that fail right after a check, start no lookup.
   */
  recheck: (unreadableRows: readonly string[]) => Promise<void>
}

// ponytail: default (no-op unlock, 'no-key' status) rather than throw-if-missing — lets
// components/tests that don't touch encrypted content render without wrapping in the provider.
const defaultValue: EncryptionKeyContextValue = {
  status: 'no-key',
  dataKey: null,
  keyVerified: false,
  unlock: async () => false,
  recheck: async () => {},
}

const EncryptionKeyContext = createContext<EncryptionKeyContextValue>(defaultValue)

const SESSION_KEY_PREFIX = 'tabmerger:dataKey:'

/** Columns that identify one `encryption_keys` row (see {@link keyRowFingerprint}). */
const KEY_ROW_COLUMNS = 'user_id, salt, wrap_iv'

/**
 * How long after a successful check a decrypt failure is attributed to the row rather than the
 * key: the rows a reader is decrypting were fetched before that check, so asking again would
 * return the same answer.
 */
const VERIFIED_KEY_GRACE_MS = 5_000

/**
 * Per-account sessionStorage key. Scoping by user id mirrors the extension's
 * `hasEncryptionKey()` fix (see extension-dev learnings on cross-account cache
 * bugs) — without it, a second account signing into the same tab could read
 * the first account's cached key.
 */
function sessionKeyFor(userId: string): string {
  return `${SESSION_KEY_PREFIX}${userId}`
}

/** What one sessionStorage entry holds: the raw data key and the key row it was unwrapped from. */
interface CachedKeyEntry {
  /** Raw data key, base64. */
  key: string
  /** {@link keyRowFingerprint} of the row this key came from. Absent in entries written before the binding existed. */
  fingerprint?: string
}

/**
 * Identifies one `encryption_keys` row: salt and wrap IV are random per setup, so a reset followed
 * by a new setup always changes it. Same rule as the extension's `keyRowFingerprint`. Undefined if
 * the row lacks either value.
 */
function keyRowFingerprint(row: { salt?: unknown; wrap_iv?: unknown } | null | undefined): string | undefined {
  return typeof row?.salt === 'string' && typeof row?.wrap_iv === 'string' ? `${row.salt}.${row.wrap_iv}` : undefined
}

/**
 * Identifies one stored ciphertext for {@link EncryptionKeyContextValue.recheck}. The IV is part
 * of it because a row that is uploaded again gets a new IV: if that one fails too, it is news.
 */
export function unreadableRowKey(table: string, id: string, blob: EncryptedBlob): string {
  return `${table}:${id}:${blob.iv}`
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
 *
 * The entry is a small JSON object ({@link CachedKeyEntry}): the key plus the fingerprint of the
 * key row it was unwrapped from. The fingerprint is the row's salt and wrap IV, which are not
 * secret (they are stored beside the wrapped key and are useless without the passphrase), so
 * keeping it here exposes nothing beyond the key itself.
 */
async function cacheDataKey(userId: string, key: CryptoKey, fingerprint: string | undefined): Promise<void> {
  const entry: CachedKeyEntry = { key: await exportKeyToBase64(key), fingerprint }
  sessionStorage.setItem(sessionKeyFor(userId), JSON.stringify(entry))
}

/** Reads an entry in the current format, or in the previous one (the bare base64 key, no fingerprint). */
function parseCachedEntry(raw: string): CachedKeyEntry {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof (parsed as CachedKeyEntry).key === 'string') {
      const { key, fingerprint } = parsed as CachedKeyEntry
      return { key, fingerprint: typeof fingerprint === 'string' ? fingerprint : undefined }
    }
  } catch {
    // not JSON: the previous format
  }
  return { key: raw }
}

async function readCachedDataKey(userId: string): Promise<{ key: CryptoKey; fingerprint: string | undefined } | null> {
  const raw = sessionStorage.getItem(sessionKeyFor(userId))
  if (!raw) return null
  try {
    const entry = parseCachedEntry(raw)
    return { key: await importKeyFromBase64(entry.key), fingerprint: entry.fingerprint }
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

/** The server's answer about the account's key row. `answered: false` means the lookup itself failed. */
type KeyRowLookup = { answered: true; row: { salt?: unknown; wrap_iv?: unknown } | null } | { answered: false }

async function lookUpKeyRow(supabase: ReturnType<typeof createClient>, userId: string): Promise<KeyRowLookup> {
  try {
    const { data, error } = await supabase
      .from('encryption_keys')
      .select(KEY_ROW_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return { answered: false }
    return { answered: true, row: data ?? null }
  } catch {
    return { answered: false }
  }
}

/**
 * Whether a cached key still belongs to the account:
 *  - `current`: the row it was unwrapped from is the one the server has now;
 *  - `replaced`: the server has a different row (reset and new setup elsewhere), or the cached key
 *    carries no fingerprint to compare (written by the previous version);
 *  - `removed`: the server ANSWERED that there is no row (reset, no new setup yet);
 *  - `unknown`: the lookup failed, or the row has nothing to compare with.
 * Only `replaced` and `removed` drop the key: a key is never dropped on missing information.
 */
type KeyVerdict = 'current' | 'replaced' | 'removed' | 'unknown'

function judgeCachedKey(lookup: KeyRowLookup, boundTo: string | undefined): KeyVerdict {
  if (!lookup.answered) return 'unknown'
  if (!lookup.row) return 'removed'
  const current = keyRowFingerprint(lookup.row)
  if (!current) return 'unknown'
  return boundTo === current ? 'current' : 'replaced'
}

/**
 * Web equivalent of the extension's `encryptionKey.ts` unlock flow. The
 * unwrapped data key is cached in `sessionStorage` (base64, per-account) so it
 * survives page navigation/refresh within the tab without re-prompting for
 * the passphrase, and is gone when the tab/browser closes. See {@link cacheDataKey}
 * for the security tradeoff this implies.
 *
 * A cached key is only valid for the `encryption_keys` row it was unwrapped from (the extension's
 * rule, see its `KeyBinding`): resetting the passphrase deletes that row and a new setup creates a
 * new data key. So the cache stores the row's fingerprint beside the key, and the key row is read
 * on every load and again when a reader meets a row it cannot decrypt ({@link recheck}). A cached
 * key is used straight away so a refresh does not flash the passphrase prompt, then dropped if the
 * server answers that its row was replaced or removed.
 */
export function EncryptionKeyProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
  const [dataKey, setDataKey] = useState<CryptoKey | null>(null)
  const [keyVerified, setKeyVerified] = useState(false)
  /** The key row fingerprint the key in state is bound to; `null` when there is no key. */
  const boundKeyRef = useRef<{ fingerprint: string | undefined } | null>(null)
  /** When the key in state was last confirmed against the server's row. */
  const verifiedAtRef = useRef<number | null>(null)
  /** Rows already known to be unreadable under the current, verified key. */
  const examinedRef = useRef(new Set<string>())
  /** Rows reported while a check is running; they become examined if it confirms the key. */
  const pendingRef = useRef(new Set<string>())
  /** At most one key row lookup runs at a time; later callers share it. */
  const inFlightRef = useRef<Promise<void> | null>(null)

  const adoptKey = useCallback((key: CryptoKey, fingerprint: string | undefined, verified: boolean) => {
    boundKeyRef.current = { fingerprint }
    verifiedAtRef.current = verified ? Date.now() : null
    examinedRef.current.clear()
    pendingRef.current.clear()
    setDataKey(key)
    setKeyVerified(verified)
    setStatus('unlocked')
  }, [])

  const dropKey = useCallback((userId: string, next: 'locked' | 'no-key') => {
    clearCachedDataKey(userId)
    boundKeyRef.current = null
    verifiedAtRef.current = null
    examinedRef.current.clear()
    pendingRef.current.clear()
    setDataKey(null)
    setKeyVerified(false)
    setStatus(next)
  }, [])

  /** Reads the account's key row and applies the result to the key in state (see {@link judgeCachedKey}). */
  const checkKeyRow = useCallback(
    (knownUserId?: string): Promise<void> => {
      if (inFlightRef.current) return inFlightRef.current
      const run = (async () => {
        try {
          const supabase = createClient()
          const userId = knownUserId ?? (await supabase.auth?.getUser?.())?.data?.user?.id
          if (!userId) return
          const lookup = await lookUpKeyRow(supabase, userId)

          const bound = boundKeyRef.current
          if (!bound) {
            // No key in this tab: only report whether there is one to unlock.
            setStatus(lookup.answered && lookup.row ? 'locked' : 'no-key')
            return
          }
          const verdict = judgeCachedKey(lookup, bound.fingerprint)
          if (verdict === 'removed') dropKey(userId, 'no-key')
          else if (verdict === 'replaced') dropKey(userId, 'locked')
          else if (verdict === 'current') {
            verifiedAtRef.current = Date.now()
            pendingRef.current.forEach((row) => examinedRef.current.add(row))
            setKeyVerified(true)
          }
          // 'unknown': keep the key and claim nothing about it.
        } finally {
          pendingRef.current.clear()
          inFlightRef.current = null
        }
      })()
      inFlightRef.current = run
      return run
    },
    [dropKey],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const user = (await supabase.auth?.getUser?.())?.data?.user
      if (!user) return

      const cached = await readCachedDataKey(user.id)
      if (cancelled) return
      if (cached) adoptKey(cached.key, cached.fingerprint, false)
      await checkKeyRow(user.id)
    })()
    return () => {
      cancelled = true
    }
  }, [adoptKey, checkKeyRow])

  const recheck = useCallback(
    (unreadableRows: readonly string[]): Promise<void> => {
      if (!boundKeyRef.current) return Promise.resolve()
      const fresh = unreadableRows.filter((row) => !examinedRef.current.has(row))
      if (fresh.length === 0) return Promise.resolve()

      if (inFlightRef.current) {
        fresh.forEach((row) => pendingRef.current.add(row))
        return inFlightRef.current
      }
      const verifiedAt = verifiedAtRef.current
      if (verifiedAt !== null && Date.now() - verifiedAt < VERIFIED_KEY_GRACE_MS) {
        fresh.forEach((row) => examinedRef.current.add(row))
        return Promise.resolve()
      }
      fresh.forEach((row) => pendingRef.current.add(row))
      // Until the server answers, these failures may be the key's fault.
      setKeyVerified(false)
      return checkKeyRow()
    },
    [checkKeyRow],
  )

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
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
        const fingerprint = keyRowFingerprint(row)
        await cacheDataKey(user.id, unwrapped, fingerprint)
        // Unwrapped from the row just read, so it is verified by construction.
        adoptKey(unwrapped, fingerprint, true)
        return true
      } catch {
        // wrong passphrase — GCM auth tag check on the wrapped key fails
        return false
      }
    },
    [adoptKey],
  )

  const value = useMemo(
    () => ({ status, dataKey, keyVerified, unlock, recheck }),
    [status, dataKey, keyVerified, unlock, recheck],
  )

  return <EncryptionKeyContext.Provider value={value}>{children}</EncryptionKeyContext.Provider>
}

export function useEncryptionKey(): EncryptionKeyContextValue {
  return useContext(EncryptionKeyContext)
}
