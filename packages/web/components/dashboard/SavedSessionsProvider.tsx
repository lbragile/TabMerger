'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { isEncryptedBlob, decryptBlob, type EncryptedBlob } from '@tabmerger/shared'
import { useEncryptionKey, unreadableRowKey } from '@/lib/encryption/context'
import { lockedSavedItem, splitSavedItems, toSavedItem, type SavedItem } from '@/lib/savedSessions'

/** Raw row shape from Supabase: `groups` is ciphertext (`{v:1,iv,ct}`) until decrypted here, in the browser. */
export interface RawSessionRow {
  id: string
  name: string
  description?: string | null
  groups: unknown
  created_at: string
}

/**
 * - `error`: the rows could not be loaded from the server;
 * - `checking`: the page is still finding out whether this tab holds the data key;
 * - `locked`: the rows are encrypted and the passphrase has not been entered;
 * - `loading`: the rows are being decrypted;
 * - `ready`: `sessions` and `backups` are final.
 */
export type SavedSessionsStatus = 'error' | 'checking' | 'locked' | 'loading' | 'ready'

export interface SavedSessionsValue {
  status: SavedSessionsStatus
  /** Sessions the user saved, plus every row whose kind is unknown (so no row is ever in neither list). */
  sessions: SavedItem[]
  /** Automatic backups, newest first. */
  backups: SavedItem[]
  /** How many of `sessions` could not be read, so might be backups. */
  unknownKind: number
  /** Rows received from the server, whatever they are. */
  totalRows: number
}

const SavedSessionsContext = createContext<SavedSessionsValue | null>(null)

const NO_ROWS: RawSessionRow[] = []

/** A row stored before encryption existed: its content is the row's own columns. It cannot be a backup. */
function fromPlainRow(row: RawSessionRow): SavedItem {
  return toSavedItem(row, { name: row.name, description: row.description ?? undefined, groups: row.groups })
}

/**
 * Decrypts the account's `sessions` rows once and splits them into saved sessions and automatic
 * backups for everything on the dashboard that lists or counts them (`SessionList`, `BackupList`,
 * the sessions stat). The split needs the decrypted content, so it cannot be made on the server.
 * A row that fails to decrypt is reported to the key provider (`recheck`) and stays a session.
 */
export function SavedSessionsProvider({
  sessions,
  loadError = false,
  children,
}: {
  sessions: RawSessionRow[] | null | undefined
  /** The server could not read the rows (as opposed to reading none). */
  loadError?: boolean
  children: React.ReactNode
}) {
  const rows = sessions ?? NO_ROWS
  const { dataKey, recheck, status: keyStatus } = useEncryptionKey()
  const hasEncrypted = useMemo(() => rows.some((s) => isEncryptedBlob(s.groups)), [rows])
  // Only the async decrypt result needs state; the "nothing encrypted" case is derived from props.
  const [decrypted, setDecrypted] = useState<{ key: CryptoKey; items: SavedItem[] } | null>(null)

  useEffect(() => {
    if (!hasEncrypted || !dataKey) return
    let cancelled = false
    ;(async () => {
      const unreadable: string[] = []
      const items = await Promise.all(
        rows.map(async (s) => {
          if (!isEncryptedBlob(s.groups)) return fromPlainRow(s)
          const blob: EncryptedBlob = s.groups
          try {
            return toSavedItem(s, await decryptBlob<unknown>(dataKey, blob))
          } catch {
            unreadable.push(unreadableRowKey('sessions', s.id, blob))
            return lockedSavedItem(s)
          }
        })
      )
      if (cancelled) return
      // A stale key is dropped by the provider (the prompt returns); see GroupGrid's useDecryptedGroups.
      if (unreadable.length > 0) void recheck(unreadable)
      setDecrypted({ key: dataKey, items })
    })()
    return () => {
      cancelled = true
    }
  }, [rows, hasEncrypted, dataKey, recheck])

  const value = useMemo<SavedSessionsValue>(() => {
    const none = { sessions: [], backups: [], unknownKind: 0, totalRows: rows.length }
    if (loadError) return { status: 'error', ...none }
    if (!hasEncrypted) return { status: 'ready', ...splitSavedItems(rows.map(fromPlainRow)), totalRows: rows.length }
    if (!dataKey) return { status: keyStatus === 'checking' ? 'checking' : 'locked', ...none }
    // A result made with another key is not shown. One made from the previous rows is, until the
    // pass for the new rows finishes, so a refresh after a delete does not flash the loading state.
    if (!decrypted || decrypted.key !== dataKey) return { status: 'loading', ...none }
    return { status: 'ready', ...splitSavedItems(decrypted.items), totalRows: rows.length }
  }, [rows, loadError, hasEncrypted, dataKey, keyStatus, decrypted])

  return <SavedSessionsContext.Provider value={value}>{children}</SavedSessionsContext.Provider>
}

/** The split rows, or `null` outside a {@link SavedSessionsProvider}. */
export function useSavedSessionsOptional(): SavedSessionsValue | null {
  return useContext(SavedSessionsContext)
}

export function useSavedSessions(): SavedSessionsValue {
  const value = useContext(SavedSessionsContext)
  if (!value) throw new Error('useSavedSessions must be used inside <SavedSessionsProvider>')
  return value
}
