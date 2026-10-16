import type { GroupsState, Tab } from './types'
import { updateGroupsState } from './localDb'

/** Sets (or, for an empty / unchanged title, clears) `customTitle` on a tab in place. */
function applyCustomTitle(tab: Tab, title: string): void {
  if (title === '' || title === tab.title) {
    delete tab.customTitle
  } else {
    tab.customTitle = title
  }
}

/**
 * Edits a saved tab's custom title as one atomic read-modify-write, addressing the group by
 * ID (a positional group index can point at a different group by the time the write runs) and
 * the tab by its position inside that group (saved tabs all have `id: 0`). The edited group is
 * marked `pendingSync` with a fresh `updatedAt`: without that the edit was never pushed and the
 * next pull reverted it. Now Open (permanent, never synced) is edited without a sync mark.
 * Resolves with the stored state (unchanged when the group/tab no longer exists).
 */
export function setTabCustomTitle(groupId: string, windowIndex: number, tabIndex: number, title: string): Promise<GroupsState> {
  return updateGroupsState((state) => withTabCustomTitle(state, groupId, windowIndex, tabIndex, title))
}

/**
 * The pure edit behind {@link setTabCustomTitle} (and the undoable `useRenameTab`): `state` with the
 * tab's custom title set, or `null` when the group/tab no longer exists. Only the edited group and
 * window are copied, so nothing else changes identity.
 */
export function withTabCustomTitle(state: GroupsState, groupId: string, windowIndex: number, tabIndex: number, title: string): GroupsState | null {
  const gi = state.available.findIndex((g) => g.id === groupId)
  const tab = state.available[gi]?.windows[windowIndex]?.tabs[tabIndex]
  if (!tab) return null
  const group = state.available[gi]
  const windows = group.windows.map((w, wi) =>
    wi !== windowIndex ? w : { ...w, tabs: w.tabs.map((t, ti) => (ti === tabIndex ? { ...t } : t)) }
  )
  applyCustomTitle(windows[windowIndex].tabs[tabIndex], title.trim())
  // the same title as before: nothing to write (no re-stamp, no sync push, no undo step)
  if (windows[windowIndex].tabs[tabIndex].customTitle === tab.customTitle) return null
  const edited = group.permanent ? { ...group, windows } : { ...group, windows, updatedAt: Date.now(), pendingSync: true }
  return { ...state, available: state.available.map((g, i) => (i === gi ? edited : g)) }
}

/** Same edit, for a tab found by its (live) tab id: the first group holding it. */
export async function saveCustomTitle(tabId: number, title: string): Promise<void> {
  // A copy, never an in-place edit of the state it is given (updateGroupsState decides from the
  // objects it handed over whether the saved data changed)
  await updateGroupsState((state) => {
    for (const [gi, group] of state.available.entries()) {
      for (const [wi, win] of group.windows.entries()) {
        const ti = win.tabs.findIndex((t) => t.id === tabId)
        if (ti === -1) continue
        const tab = { ...win.tabs[ti] }
        applyCustomTitle(tab, title)
        const windows = group.windows.map((w, i) => (i === wi ? { ...w, tabs: w.tabs.map((t, j) => (j === ti ? tab : t)) } : w))
        const edited = group.permanent ? { ...group, windows } : { ...group, windows, updatedAt: Date.now(), pendingSync: true }
        return { ...state, available: state.available.map((g, i) => (i === gi ? edited : g)) }
      }
    }
    return null
  })
}

export function getDisplayTitle(tab: Tab): string {
  return tab.customTitle?.trim() || tab.title
}
