import type { Window as ExtWindow } from '@/lib/types';
import { openTabInChromeGroup } from '@/lib/chromeGroups';
import { resolveIncognito } from '@/lib/incognito';

export function useOpenWindow() {
  const openWindow = async (window: ExtWindow) => {
    const urlTabs = window.tabs.filter((t) => !!t.url);
    if (urlTabs.length === 0) return;

    const openTabs = await chrome.tabs.query({});
    const openUrls = new Set(openTabs.map((t) => t.url));

    const matchedTab = openTabs.find((t) => t.url && urlTabs.some((saved) => saved.url === t.url));
    const matchedWindowId = matchedTab?.windowId;

    const notYetOpen = urlTabs.filter((t) => !openUrls.has(t.url!));

    if (matchedWindowId !== undefined) {
      // Some saved tabs are already open — add missing ones to the same window, preserving groups
      for (const tab of notYetOpen) {
        if (tab.chromeGroup && chrome.tabGroups) {
          await openTabInChromeGroup(tab, matchedWindowId);
        } else {
          await chrome.tabs.create({ windowId: matchedWindowId, url: tab.url });
        }
      }
      await chrome.windows.update(matchedWindowId, { focused: true });
    } else {
      // Nothing open yet — create a new window, populate it, then remove the initial blank tab
      const incognito = await resolveIncognito(window.incognito);
      const newWin = await chrome.windows.create(incognito ? { focused: true, incognito: true } : { focused: true });
      if (!newWin) return;
      const targetWindowId = newWin.id!;
      const blankTabId = newWin.tabs?.[0]?.id;

      for (const tab of urlTabs) {
        if (tab.chromeGroup && chrome.tabGroups) {
          await openTabInChromeGroup(tab, targetWindowId);
        } else {
          await chrome.tabs.create({ windowId: targetWindowId, url: tab.url });
        }
      }

      // Remove the blank tab Chrome creates automatically with a new window
      if (blankTabId !== undefined) {
        await chrome.tabs.remove(blankTabId);
      }
    }
  };

  return openWindow;
}
