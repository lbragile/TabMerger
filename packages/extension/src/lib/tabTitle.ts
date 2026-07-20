import type { Tab } from './types'
import { getGroupsState, saveGroupsState } from './localDb'

export async function saveCustomTitle(tabId: number, title: string): Promise<void> {
  const state = await getGroupsState()
  for (const group of state.available) {
    for (const win of group.windows) {
      const tab = win.tabs.find((t) => t.id === tabId)
      if (tab) {
        if (title === '') {
          delete tab.customTitle
        } else {
          tab.customTitle = title
        }
        await saveGroupsState(state)
        return
      }
    }
  }
}

export function getDisplayTitle(tab: Tab): string {
  return tab.customTitle?.trim() || tab.title
}

export async function notifySavedTabTitle(opts: {
  browserTabId: number
  customTitle: string
  tabId: number
}): Promise<void> {
  try {
    await chrome.tabs.sendMessage(opts.browserTabId, {
      type: 'SET_TAB_TITLE',
      title: opts.customTitle,
      tabId: opts.tabId,
    })
  } catch (err) {
    console.error('notifySavedTabTitle: sendMessage failed', err)
  }
}
