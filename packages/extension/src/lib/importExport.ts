import { isScriptUrl } from '@tabmerger/shared'
import { nanoid } from 'nanoid'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import { DEFAULT_GROUP_COLOR } from '@/lib/types'
import { createGroup, createWindow, createTab, getGroupInfo } from '@/lib/utils'

/**
 * What an import produced: the groups that passed validation and how many entries of the file
 * (groups, windows or tabs) were left out. An entry inside a left-out parent is not counted again.
 */
export interface ImportResult {
  groups: Group[]
  skipped: number
}

/** A full-state import (the Import / Export dialog's JSON file): the validated state and the left-out count. */
export interface ImportStateResult {
  state: GroupsState
  skipped: number
}

/** Name given to an imported group whose file entry has no usable name. */
export const IMPORTED_GROUP_FALLBACK_NAME = 'Imported group'

/** The colours `chrome.tabGroups` accepts; any other value makes `tabGroups.update` reject. */
const CHROME_GROUP_COLORS: readonly string[] = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']

/** The two colour notations the app writes or has written: `rgb()/rgba()` and hex. */
const GROUP_COLOR_RE = /^(?:rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:\d(?:\.\d+)?|\.\d+)\s*)?\)|#[0-9a-f]{3,8})$/i

type Counter = { skipped: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** An absolute URL (it parses on its own) that does not use a script-running scheme. */
function isAbsoluteNonScriptUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url || isScriptUrl(url)) return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/** An image address safe to keep: any non-script URL, or an inline `data:image/...` picture (how browsers report many favicons). */
function isImageUrl(url: unknown): url is string {
  return typeof url === 'string' && url !== '' && (!isScriptUrl(url) || /^data:image\//i.test(url))
}

/** `" (3 skipped)"`-style suffix for the import success toast; empty when nothing was left out. */
export function skippedSuffix(skipped: number): string {
  return skipped > 0 ? `, ${skipped} skipped` : ''
}

/**
 * One tab from a JSON file, rebuilt field by field (unknown keys are not copied). Returns `null`
 * when the entry is not a tab the app could have saved: no string `url`, a script-running URL,
 * or a non-empty URL that is not absolute. The tab is a saved tab, so its id is always 0.
 */
function sanitizeTab(raw: unknown): Tab | null {
  if (!isRecord(raw)) return null
  const url = raw.url
  if (typeof url !== 'string') return null
  if (url !== '' && !isAbsoluteNonScriptUrl(url)) return null

  const tab: Tab = { id: 0, title: typeof raw.title === 'string' ? raw.title : url, url }
  if (typeof raw.customTitle === 'string') tab.customTitle = raw.customTitle
  if (isImageUrl(raw.favIconUrl)) tab.favIconUrl = raw.favIconUrl
  if (isImageUrl(raw.ogImage)) tab.ogImage = raw.ogImage
  if (typeof raw.pinned === 'boolean') tab.pinned = raw.pinned
  if (typeof raw.note === 'string') tab.note = raw.note
  if (isFiniteNumber(raw.savedAt) && raw.savedAt > 0) tab.savedAt = raw.savedAt

  const cg = raw.chromeGroup
  if (isRecord(cg) && isFiniteNumber(cg.id) && typeof cg.name === 'string' && typeof cg.color === 'string' && CHROME_GROUP_COLORS.includes(cg.color)) {
    tab.chromeGroup = { id: cg.id, name: cg.name, color: cg.color }
  }

  const reminder = raw.reminder
  if (isRecord(reminder) && isFiniteNumber(reminder.fireAt)) {
    tab.reminder = typeof reminder.note === 'string' ? { fireAt: reminder.fireAt, note: reminder.note } : { fireAt: reminder.fireAt }
  }
  return tab
}

/**
 * One window from a JSON file. `null` when it is not an object with a `tabs` array. A saved window
 * never addresses a real browser window, so its id is 0 and it is never focused.
 */
function sanitizeWindow(raw: unknown, counter: Counter): ExtWindow | null {
  if (!isRecord(raw) || !Array.isArray(raw.tabs)) return null
  const tabs: Tab[] = []
  for (const rawTab of raw.tabs) {
    const tab = sanitizeTab(rawTab)
    if (tab) tabs.push(tab)
    else counter.skipped++
  }
  const win: ExtWindow = { id: 0, tabs, incognito: raw.incognito === true, focused: false }
  if (raw.starred === true) win.starred = true
  if (typeof raw.name === 'string') win.name = raw.name
  if (typeof raw.note === 'string') win.note = raw.note
  return win
}

/**
 * One group from a JSON file. `null` when it is not an object with a `windows` array. Sync
 * bookkeeping (`remoteUpdatedAt`, `positionDirty`) is never taken from a file and `info` is
 * recomputed from the windows that were kept. `permanent` is only true for the literal `true`.
 */
function sanitizeGroup(raw: unknown, counter: Counter): Group | null {
  if (!isRecord(raw) || !Array.isArray(raw.windows)) return null
  const windows: ExtWindow[] = []
  for (const rawWindow of raw.windows) {
    const win = sanitizeWindow(rawWindow, counter)
    if (win) windows.push(win)
    else counter.skipped++
  }
  const group: Group = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nanoid(10),
    name: typeof raw.name === 'string' && raw.name ? raw.name : IMPORTED_GROUP_FALLBACK_NAME,
    color: typeof raw.color === 'string' && GROUP_COLOR_RE.test(raw.color) ? raw.color : DEFAULT_GROUP_COLOR,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : Date.now(),
    windows,
    permanent: raw.permanent === true,
    pendingSync: true
  }
  if (raw.starred === true) group.starred = true
  if (raw.archived === true) group.archived = true
  if (typeof raw.note === 'string') group.note = raw.note
  group.info = getGroupInfo(group)
  return group
}

/**
 * Validates a list of file entries as groups. The file's own "Now Open" group (`permanent: true`,
 * the exporting browser's live tabs) is returned apart from the saved groups, so no caller can
 * store it as a second "Now Open"; only the first one is kept, any further one counts as skipped.
 */
function sanitizeGroups(items: unknown[]): { groups: Group[]; nowOpen: Group | undefined; skipped: number } {
  const counter: Counter = { skipped: 0 }
  const groups: Group[] = []
  let nowOpen: Group | undefined
  for (const item of items) {
    const group = sanitizeGroup(item, counter)
    if (!group) counter.skipped++
    else if (!group.permanent) groups.push(group)
    else if (!nowOpen) nowOpen = group
    else counter.skipped++
  }
  return { groups, nowOpen, skipped: counter.skipped }
}

export function exportGroups(groups: Group[]): string {
  return JSON.stringify(groups)
}

/**
 * Reads a JSON array of groups (the Settings backup format) for an APPENDING import. Every entry
 * is validated and rebuilt; entries that are not groups, windows or tabs are left out and counted.
 * The file's "Now Open" group is not returned: its tabs were the exporting browser's open tabs.
 * Throws on invalid JSON and when the top level is not an array.
 */
export function importGroups(json: string): ImportResult {
  const parsed: unknown = JSON.parse(json) // throws on invalid JSON
  if (!Array.isArray(parsed)) throw new Error('Expected an array')
  const { groups, skipped } = sanitizeGroups(parsed)
  return { groups, skipped }
}

/**
 * Reads a full exported state (`{ active, available }`, the Import / Export dialog's format) for a
 * REPLACING import. Only `active` and `available` are taken; `available` goes through the same
 * validation as {@link importGroups}, with the file's "Now Open" group (if any) kept first.
 * Throws on invalid JSON, when `available` is not an array, and when the file had entries but
 * none of them is a usable group.
 */
export function importGroupsState(json: string): ImportStateResult {
  const parsed: unknown = JSON.parse(json) // throws on invalid JSON
  if (!isRecord(parsed) || !Array.isArray(parsed.available)) throw new Error('Invalid format')
  const { groups, nowOpen, skipped } = sanitizeGroups(parsed.available)
  if (groups.length === 0 && skipped > 0) throw new Error('No groups found')
  const active = isRecord(parsed.active) ? parsed.active : {}
  return {
    state: {
      active: { id: typeof active.id === 'string' ? active.id : '', index: isFiniteNumber(active.index) ? active.index : 0 },
      available: nowOpen ? [nowOpen, ...groups] : groups
    },
    skipped
  }
}

/** A saved tab built from an imported link: id 0 like every saved tab. */
function importedTab(title: string, url: string): Tab {
  return { ...createTab(title, url), id: 0 }
}

/** A saved group holding `tabs` in one window (id 0, like every saved window). */
function importedGroup(name: string, tabs: Tab[]): Group {
  const g = createGroup(undefined, name)
  g.windows = [{ ...createWindow(tabs), id: 0 }]
  g.info = getGroupInfo(g)
  return g
}

/**
 * Reads a browser bookmarks HTML export: each top-level folder becomes a group, nested folders are
 * flattened into it. A link is left out (and counted) when its address is not an absolute URL or
 * uses a script-running scheme, as bookmarklets do. A folder left with no links makes no group.
 */
export function parseBookmarksHtml(html: string): ImportResult {
  // Parse with DOMParser — available in extension popup context; in tests uses jsdom
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const groups: Group[] = []
  let skipped = 0

  function collectTabs(dl: Element): Tab[] {
    const tabs: Tab[] = []
    for (const dt of Array.from(dl.children)) {
      if (dt.tagName !== 'DT') continue
      const a = dt.querySelector(':scope > a')
      const h3 = dt.querySelector(':scope > h3')
      if (a) {
        const url = (a.getAttribute('href') ?? '').trim()
        if (!isAbsoluteNonScriptUrl(url)) {
          skipped++
          continue
        }
        tabs.push(importedTab(a.textContent?.trim() || url, url))
      } else if (h3) {
        // nested folder — flatten its tabs into this level
        const nestedDl = dt.querySelector(':scope > dl')
        if (nestedDl) tabs.push(...collectTabs(nestedDl))
      }
    }
    return tabs
  }

  // Top-level DL
  const topDl = doc.querySelector('dl')
  if (!topDl) return { groups, skipped }

  for (const dt of Array.from(topDl.children)) {
    if (dt.tagName !== 'DT') continue
    const h3 = dt.querySelector(':scope > h3')
    if (!h3) continue
    const name = h3.textContent?.trim() || 'Imported'
    const dl = dt.querySelector(':scope > dl')
    const tabs = dl ? collectTabs(dl) : []
    if (tabs.length === 0) continue
    groups.push(importedGroup(name, tabs))
  }

  return { groups, skipped }
}

/**
 * Reads a OneTab plain-text export (`url | title` per line, blank line between groups). A line is
 * left out (and counted) when its address is not an absolute URL or uses a script-running scheme.
 * A block left with no lines makes no group.
 */
export function parseOneTabs(text: string): ImportResult {
  const groups: Group[] = []
  let skipped = 0
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const tabs: Tab[] = []
    for (const line of lines) {
      const sep = line.indexOf(' | ')
      const url = sep === -1 ? line : line.slice(0, sep).trim()
      const title = sep === -1 ? line : line.slice(sep + 3).trim()
      if (!isAbsoluteNonScriptUrl(url)) {
        skipped++
        continue
      }
      tabs.push(importedTab(title || url, url))
    }
    if (tabs.length === 0) continue
    groups.push(importedGroup(`Imported ${groups.length + 1}`, tabs))
  }
  return { groups, skipped }
}
