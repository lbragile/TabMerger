import type { Tab as TabType } from '@/lib/types';

/**
 * Opens a tab and places it into the appropriate Chrome tab group.
 * Finds an existing group matching the tab's chromeGroup.name; creates one if not found.
 * No-ops the grouping step on Firefox (no chrome.tabGroups API).
 *
 * @param tab      - The saved tab to restore
 * @param windowId - Target window (omit to use the current window)
 * @param active   - Whether the new tab should be focused (default: false)
 */
export async function openTabInChromeGroup(
  tab: TabType,
  windowId?: number,
  active = false
): Promise<void> {
  const newTab = await chrome.tabs.create({ url: tab.url, windowId, active });

  if (!tab.chromeGroup || !chrome.tabGroups) return;

  // Find an existing group with the same title in the target window
  const groups = await chrome.tabGroups.query({
    windowId: newTab.windowId,
    title: tab.chromeGroup.name,
  });

  if (groups.length > 0) {
    // Reuse existing group
    await chrome.tabs.group({ tabIds: [newTab.id!], groupId: groups[0].id });
  } else {
    // Create a new group, then set its title + color
    const groupId = await chrome.tabs.group({
      tabIds: [newTab.id!],
      createProperties: { windowId: newTab.windowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: tab.chromeGroup.name,
      color: tab.chromeGroup.color as chrome.tabGroups.Color,
    });
  }
}
