export default defineBackground(() => {
  // Alarm for periodic sync
  chrome.alarms.create('tabmerger-sync', { periodInMinutes: 5 });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'tabmerger-sync') {
      // Signal the popup to sync (if open) via storage event
      chrome.storage.local.set({ lastSyncTrigger: Date.now() });
    }
  });

  // Context menu: "Save tab to TabMerger"
  chrome.contextMenus.create({
    id: 'tabmerger-save-tab',
    title: 'Save tab to TabMerger',
    contexts: ['page', 'link']
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'tabmerger-save-tab') return;
    const url = info.linkUrl ?? info.pageUrl ?? tab?.url ?? '';
    const title = tab?.title ?? url;

    // Open popup and pass tab data via storage
    await chrome.storage.local.set({ pendingTab: { url, title, favIconUrl: tab?.favIconUrl } });
    await chrome.action.openPopup();
  });

  // Tab update listener — keep badge count current
  const updateBadge = async () => {
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      const tabCount = windows.reduce(
        (acc, w) => acc + (w.tabs?.filter((t) => !t.url?.startsWith('chrome://'))?.length ?? 0),
        0
      );
      await chrome.action.setBadgeText({ text: tabCount > 0 ? String(tabCount) : '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    } catch {
      // Silently ignore — can happen when browser is closing
    }
  };

  chrome.tabs.onCreated.addListener(() => void updateBadge());
  chrome.tabs.onRemoved.addListener(() => void updateBadge());
  chrome.tabs.onUpdated.addListener((_, changeInfo) => {
    if (changeInfo.status === 'complete') void updateBadge();
  });

  void updateBadge();
});
