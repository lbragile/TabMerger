import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrganizePromptGroup, PromptTab } from '@/lib/ai'
import { cleanUntrustedText, cleanUrl } from '@/lib/ai-prompt-safety'
import {
  AI_MAX_GROUPS,
  AI_MAX_GROUP_NAME_LENGTH,
  AI_MAX_TABS_PER_LIST,
  AI_MAX_TITLE_LENGTH,
  AI_MAX_TOTAL_TABS,
  AI_MAX_URL_LENGTH,
  type OrganizeGroup,
} from '@/lib/ai-validation'

/**
 * The groups `/api/ai/organize` sends to the model.
 *
 * Two sources:
 * - The client payload (`groups` in the POST body), already validated and cleaned by
 *   `parseOrganizeBody`. Required for end-to-end encrypted accounts: `groups.windows` in
 *   Supabase is ciphertext the server can never decrypt, so the only plaintext is the
 *   client's decrypted in-memory state. Array order is the client's group order, which starts
 *   with the local-only Now Open group.
 * - Otherwise the user's stored `groups` rows (older extension builds, accounts without
 *   encryption). Now Open is never synced, so no stored row is permanent, not even a legacy
 *   row at the default position 0.
 */

/**
 * Message of the error returned when the stored rows are end-to-end encrypted and the request
 * carried no tab data. Written to be shown to the user.
 */
export const ORGANIZE_NEEDS_CLIENT_DATA_ERROR =
  'Your groups are end-to-end encrypted, so they can only be organized from the ' +
  'TabMerger extension, which sends the tab data with the request. Start Organize ' +
  'from the extension.'

/** Thrown by {@link loadOrganizeGroups} when a stored row is not readable plaintext. */
export class OrganizeNeedsClientDataError extends Error {
  constructor() {
    super(ORGANIZE_NEEDS_CLIENT_DATA_ERROR)
    this.name = 'OrganizeNeedsClientDataError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The tabs of a stored plaintext `windows` tree, cleaned like client-sent tabs. */
function tabsOfWindows(windows: unknown[], budget: number): PromptTab[] {
  const tabs: PromptTab[] = []
  for (const win of windows) {
    const list = isRecord(win) && Array.isArray(win.tabs) ? win.tabs : []
    for (const tab of list) {
      if (tabs.length >= budget) return tabs
      if (!isRecord(tab) || typeof tab.url !== 'string') continue
      tabs.push({
        title: typeof tab.title === 'string' ? cleanUntrustedText(tab.title, AI_MAX_TITLE_LENGTH) : '',
        url: cleanUrl(tab.url, AI_MAX_URL_LENGTH),
      })
    }
  }
  return tabs
}

/**
 * Reads the user's stored groups for the prompt, ordered like the extension shows them.
 *
 * The server holds no decryption key, so an encrypted row is unreadable and must never reach
 * the prompt: a plan built from ciphertext would be meaningless, and the extension would then
 * apply it to real groups. The check is on the readable shape, not the blob format: plaintext `windows` is
 * always an array, so anything else (an encrypted blob of any version, or any other object)
 * throws {@link OrganizeNeedsClientDataError} before the model is called. `null` is read as no
 * windows; the column is `not null`, so a stored row never holds it.
 *
 * Group, per-group tab and total tab counts are capped at the request limits.
 */
export async function loadStoredOrganizeGroups(
  supabase: SupabaseClient,
  userId: string
): Promise<OrganizePromptGroup[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, windows')
    .eq('user_id', userId)
    // Legacy rows all tie at position 0 (the column default), so add stable tie-breakers:
    // most recently edited first, then id.
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })

  if (error) throw new Error(`loadStoredOrganizeGroups: ${error.message}`)

  const rows = (data ?? []) as { id: string; name: unknown; windows: unknown }[]
  if (rows.some((g) => g.windows != null && !Array.isArray(g.windows))) {
    throw new OrganizeNeedsClientDataError()
  }

  let tabBudget = AI_MAX_TOTAL_TABS
  return rows.slice(0, AI_MAX_GROUPS).map((g) => {
    const tabs = tabsOfWindows((g.windows as unknown[] | null) ?? [], Math.min(AI_MAX_TABS_PER_LIST, tabBudget))
    tabBudget -= tabs.length
    return {
      id: g.id,
      name: typeof g.name === 'string' ? cleanUntrustedText(g.name, AI_MAX_GROUP_NAME_LENGTH) : '',
      permanent: false,
      tabs,
    }
  })
}

/**
 * The groups for the organize prompt: the client payload when one was sent (used as is, never
 * replaced by the stored rows), else the stored rows.
 */
export async function loadOrganizeGroups(
  supabase: SupabaseClient,
  userId: string,
  clientGroups: OrganizeGroup[] | null
): Promise<OrganizePromptGroup[]> {
  if (clientGroups) {
    return clientGroups.map((g) => ({ id: g.id, name: g.name, permanent: g.permanent, tabs: g.tabs }))
  }
  return loadStoredOrganizeGroups(supabase, userId)
}
