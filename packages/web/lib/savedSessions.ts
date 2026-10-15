import {
  AUTO_BACKUP_DOWNLOAD_LIMITS,
  BACKUP_FILE_EXTENSION,
  DEFAULT_BACKUP_FILE_PATTERN,
  GROUP_COLOR_RE,
  LOCAL_ONLY_SYNC_KEYS,
  buildBackupFilePath,
  withoutLocalOnlySyncKeys,
} from '@tabmerger/shared'

/**
 * The dashboard's reading of a `sessions` row AFTER it was decrypted in the browser. A row is
 * either a session the user saved or an automatic backup; which one is only known from the
 * decrypted content (`auto === true`), never from a column. Decrypted content is user data that
 * came over the network, so nothing here trusts its shape: everything shown is rebuilt from
 * checked values and bounded by {@link AUTO_BACKUP_DOWNLOAD_LIMITS}.
 */

export interface SavedTab {
  url: string
  title: string
}

export interface SavedWindow {
  tabs: SavedTab[]
}

export interface SavedGroup {
  name?: string
  /** Only an `rgb()/rgba()` or hex colour: it is written into a `style`, where `url(...)` would make a request. */
  color?: string
  windows: SavedWindow[]
}

export interface SavedItem {
  id: string
  name: string
  description?: string | null
  groups: SavedGroup[]
  created_at: string
  /** The row's ciphertext could not be decrypted with the current key. Its kind is unknown. */
  locked?: boolean
  /** The row decrypted (or was never encrypted) but its content is not a list of groups. */
  damaged?: boolean
  /** An automatic backup: the decrypted content carries the literal `auto: true`. */
  auto?: boolean
  /**
   * The group entries exactly as they were stored, for the file download. Only entries that are
   * objects are kept; the extension's importer validates every field when the file is read.
   */
  exportable: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const cut = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value)

function readTab(raw: unknown): SavedTab | null {
  if (!isRecord(raw) || typeof raw.url !== 'string' || raw.url.length > AUTO_BACKUP_DOWNLOAD_LIMITS.urlLength) return null
  const title = typeof raw.customTitle === 'string' && raw.customTitle ? raw.customTitle : typeof raw.title === 'string' ? raw.title : ''
  return { url: raw.url, title: cut(title, AUTO_BACKUP_DOWNLOAD_LIMITS.titleLength) }
}

function readWindow(raw: unknown): SavedWindow | null {
  if (!isRecord(raw) || !Array.isArray(raw.tabs)) return null
  const tabs: SavedTab[] = []
  for (const rawTab of raw.tabs) {
    if (tabs.length >= AUTO_BACKUP_DOWNLOAD_LIMITS.tabsPerWindow) break
    const tab = readTab(rawTab)
    if (tab) tabs.push(tab)
  }
  return { tabs }
}

function readGroup(raw: unknown): SavedGroup | null {
  if (!isRecord(raw)) return null
  const windows: SavedWindow[] = []
  for (const rawWindow of Array.isArray(raw.windows) ? raw.windows : []) {
    if (windows.length >= AUTO_BACKUP_DOWNLOAD_LIMITS.windowsPerGroup) break
    const win = readWindow(rawWindow)
    if (win) windows.push(win)
  }
  const group: SavedGroup = { windows }
  if (typeof raw.name === 'string' && raw.name) group.name = cut(raw.name, AUTO_BACKUP_DOWNLOAD_LIMITS.nameLength)
  if (typeof raw.color === 'string' && GROUP_COLOR_RE.test(raw.color)) group.color = raw.color
  return group
}

/**
 * Reads a list of groups from untrusted content. `null` when it is not an array or holds more
 * entries than a backup may ({@link AUTO_BACKUP_DOWNLOAD_LIMITS.groupsPerBackup}); entries that
 * are not groups, windows or tabs are left out.
 */
export function readSavedGroups(raw: unknown): { groups: SavedGroup[]; exportable: unknown[] } | null {
  if (!Array.isArray(raw) || raw.length > AUTO_BACKUP_DOWNLOAD_LIMITS.groupsPerBackup) return null
  const groups: SavedGroup[] = []
  const exportable: unknown[] = []
  for (const entry of raw) {
    const group = readGroup(entry)
    if (!group) continue
    groups.push(group)
    exportable.push(entry)
  }
  return { groups, exportable }
}

/** The row fields every item keeps, whatever its content turned out to be. */
export interface SavedRowBase {
  id: string
  created_at: string
}

/**
 * Builds the item for a row from its content: the decrypted payload of an encrypted row, or the
 * row's own plaintext columns for a row stored before encryption. Only the literal `auto: true`
 * marks a backup. Content that is not an object, or whose `groups` is not a usable list, gives a
 * `damaged` item with no groups (and no kind, unless the object itself says `auto: true`).
 */
export function toSavedItem(row: SavedRowBase, content: unknown): SavedItem {
  const base = { id: row.id, created_at: row.created_at }
  if (!isRecord(content)) return { ...base, name: '', groups: [], exportable: [], damaged: true }

  const name = typeof content.name === 'string' ? cut(content.name, AUTO_BACKUP_DOWNLOAD_LIMITS.nameLength) : ''
  const description = typeof content.description === 'string' ? cut(content.description, AUTO_BACKUP_DOWNLOAD_LIMITS.noteLength) : undefined
  const auto = content.auto === true
  const read = readSavedGroups(content.groups)
  if (!read) return { ...base, name, description, auto, groups: [], exportable: [], damaged: true }
  return { ...base, name, description, auto, groups: read.groups, exportable: read.exportable }
}

/** The placeholder for a row whose ciphertext would not decrypt. */
export function lockedSavedItem(row: SavedRowBase): SavedItem {
  return { ...row, name: '(locked)', groups: [], exportable: [], locked: true }
}

/** Under the Saved Sessions of an account without cloud sync. Pairs with `AUTO_BACKUP_COPY.readOnlyNote`. */
export const SAVED_SESSIONS_READ_ONLY_NOTE =
  'Saving new sessions to your account needs Pro. Your existing sessions can still be opened or deleted.'

export function countWindows(groups: SavedGroup[]): number {
  return groups.reduce((sum, g) => sum + g.windows.length, 0)
}

export function countTabs(groups: SavedGroup[]): number {
  return groups.reduce((sum, g) => sum + g.windows.reduce((ws, w) => ws + w.tabs.length, 0), 0)
}

/** Milliseconds of a row's `created_at`, or `null` when it is not a date. */
export function createdAtMs(item: Pick<SavedItem, 'created_at'>): number | null {
  const ms = Date.parse(item.created_at)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Splits the items into what each dashboard section lists. Backups are the items known to be
 * automatic, newest first. Everything else stays under sessions, in the order given, including
 * the items whose kind is unknown (locked, or content that is not an object): they are counted in
 * `unknownKind` so the Backups section can say where they are.
 */
export function splitSavedItems(items: SavedItem[]): { sessions: SavedItem[]; backups: SavedItem[]; unknownKind: number } {
  const sessions: SavedItem[] = []
  const backups: SavedItem[] = []
  let unknownKind = 0
  for (const item of items) {
    if (item.auto === true && !item.locked) backups.push(item)
    else {
      sessions.push(item)
      // `auto` is a boolean whenever the content was an object, so `undefined` means "nothing to read it from".
      if (item.locked || (item.damaged && item.auto === undefined)) unknownKind++
    }
  }
  backups.sort((a, b) => (createdAtMs(b) ?? -Infinity) - (createdAtMs(a) ?? -Infinity))
  return { sessions, backups, unknownKind }
}

/**
 * A device's own sync bookkeeping, left out of a downloaded file. The list and the walk that
 * removes it are shared with the extension, which writes the same file format
 * (`@tabmerger/shared`, `localOnlySyncKeys.ts`); re-exported for this module's importers.
 */
export { LOCAL_ONLY_SYNC_KEYS }

/**
 * The text of a backup's downloadable file: a JSON array of groups, the format the extension's
 * Settings import reads (its `importGroups`). The entries are written as they were stored, minus
 * the sync bookkeeping of the device that made the backup ({@link LOCAL_ONLY_SYNC_KEYS}), wherever
 * it is (group, window, tab or below).
 */
export function backupFileContent(item: Pick<SavedItem, 'exportable'>): string {
  return JSON.stringify(withoutLocalOnlySyncKeys(item.exportable))
}

/** "October 11, 2026 at 2:00 PM" in the viewer's locale and time zone (`locale` is for tests). */
export function formatAbsoluteTime(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(ms))
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
]

/** "3 hours ago", "yesterday", "in 2 minutes" (a clock that is behind), or "now" under a minute. */
export function formatRelativeTime(ms: number, now: number, locale?: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diff = ms - now
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit)
  }
  return rtf.format(0, 'second')
}

/**
 * `TabMerger backup 2026-10-12 14-05-09.json`: the name the extension gives the file copy of a
 * backup by default (shared pattern and builder), in the viewer's local time, from the row's
 * `created_at`. File name only, no folder. A row with no usable date gets the name without one.
 */
export function backupFileName(item: Pick<SavedItem, 'created_at' | 'groups'>): string {
  const ms = createdAtMs(item)
  if (ms === null) return `TabMerger backup${BACKUP_FILE_EXTENSION}`
  return buildBackupFilePath('', DEFAULT_BACKUP_FILE_PATTERN, { createdAt: ms, groups: item.groups.length, tabs: countTabs(item.groups) })
}
