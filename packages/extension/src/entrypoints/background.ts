import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import type { Tab as TmTab, Window as TmWindow } from '@/lib/types';

type Scope = 'current' | 'left' | 'right' | 'excluding';

// Mirrors PRESET_COLORS from @tabmerger/shared → circle emoji
const COLOR_EMOJI: Record<string, string> = {
  'rgba(239, 68, 68, 1)':   '🔴', // red
  'rgba(249, 115, 22, 1)':  '🟠', // orange
  'rgba(234, 179, 8, 1)':   '🟡', // yellow
  'rgba(34, 197, 94, 1)':   '🟢', // green
  'rgba(6, 182, 212, 1)':   '🔵', // cyan
  'rgba(59, 130, 246, 1)':  '🔵', // blue
  'rgba(99, 102, 241, 1)':  '🟣', // indigo
  'rgba(168, 85, 247, 1)':  '🟣', // purple
  'rgba(236, 72, 153, 1)':  '🔴', // pink → closest circle
  'rgba(20, 184, 166, 1)':  '🟢', // teal
  'rgba(107, 114, 128, 1)': '⚫', // gray
  'rgba(15, 23, 42, 1)':    '⚫', // slate
};
const colorEmoji = (rgba: string) => COLOR_EMOJI[rgba] ?? '⚪';

const SCOPE_LABELS: Record<Scope, string> = {
  current:   'Save this tab',
  left:      'Save tabs to the left',
  right:     'Save tabs to the right',
  excluding: 'Save all other tabs',
};

let _building = false;
async function buildMenus() {
  if (_building) return;
  _building = true;
  try { await _buildMenus(); } finally { _building = false; }
}

async function _buildMenus() {
  // Fetch groups before touching contextMenus — no async gap after removeAll
  let groups: Awaited<ReturnType<typeof getGroupsState>>['available'] = [];
  try {
    const state = await getGroupsState();
    groups = state.available.filter((g) => !g.permanent);
  } catch {
    // IDB not ready — leave empty
  }

  await chrome.contextMenus.removeAll();

  // 'tab' context (tab-strip right-click) exists at runtime but is absent from @types/chrome stubs
  const TAB_CTX = 'tab' as chrome.contextMenus.ContextType;
  chrome.contextMenus.create({ id: 'tm-add', title: 'Save to TabMerger', contexts: [TAB_CTX] });

  for (const scope of Object.keys(SCOPE_LABELS) as Scope[]) {
    chrome.contextMenus.create({ id: `tm-scope-${scope}`, parentId: 'tm-add', title: SCOPE_LABELS[scope], contexts: [TAB_CTX] });
    if (groups.length === 0) {
      chrome.contextMenus.create({ id: `tm-scope-${scope}-none`, parentId: `tm-scope-${scope}`, title: 'No saved groups yet', contexts: [TAB_CTX], enabled: false });
    } else {
      for (const group of groups) {
        const tabCount = group.windows.reduce((n, w) => n + w.tabs.length, 0);
        chrome.contextMenus.create({
          id: `tm-scope-${scope}-${group.id}`,
          parentId: `tm-scope-${scope}`,
          title: `${colorEmoji(group.color)} ${group.name} (${group.windows.length}w · ${tabCount}t)`,
          contexts: [TAB_CTX],
        });
      }
    }
  }
}

// Re-register any persisted reminders that lost their alarm (e.g. after browser restart)
async function reRegisterReminders() {
  if (!chrome.alarms) return; // guard: alarms permission not yet active (pre-reload)
  const all = await chrome.storage.local.get(null);
  const existingAlarms = await chrome.alarms.getAll();
  const alarmNames = new Set(existingAlarms.map((a) => a.name));
  for (const key of Object.keys(all)) {
    if (!key.startsWith('reminder-')) continue;
    if (alarmNames.has(key)) continue;
    // Alarm was lost — re-fire immediately (1-min min delay)
    chrome.alarms.create(key, { delayInMinutes: 1 });
  }
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => void buildMenus());
  chrome.runtime.onStartup.addListener(() => { void buildMenus(); void reRegisterReminders(); });
  void buildMenus();
  void reRegisterReminders();

  // Auth bridge: content script forwards the web-app Supabase session here so
  // we can call setSession() which writes to chrome.storage.local — the popup's
  // supabase client picks it up via chrome.storage.onChanged.
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as { type?: string; accessToken?: string; refreshToken?: string; name?: string; delayInMinutes?: number };
    if (m?.type === 'SYNC_AUTH' && m.accessToken && m.refreshToken) {
      void supabase.auth.setSession({ access_token: m.accessToken, refresh_token: m.refreshToken });
    }
    // Alarm helpers — chrome.alarms only available in background, not popup
    if (m?.type === 'CREATE_ALARM' && m.name && m.delayInMinutes) {
      chrome.alarms.create(m.name, { delayInMinutes: m.delayInMinutes });
    }
    if (m?.type === 'CLEAR_ALARM' && m.name) {
      void chrome.alarms.clear(m.name);
    }
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const menuId = String(info.menuItemId);
    const scopeMatch = menuId.match(/^tm-scope-(current|left|right|excluding)-(.+)$/);
    if (!scopeMatch || !tab?.windowId || tab.index === undefined) return;
    const scope = scopeMatch[1] as Scope;
    const groupId = scopeMatch[2];

    const allChromeTabs = await chrome.tabs.query({ windowId: tab.windowId });
    allChromeTabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    let selected: typeof allChromeTabs;
    switch (scope) {
      case 'current':   selected = [tab]; break;
      case 'left':      selected = allChromeTabs.filter((t) => t.index < tab.index); break;
      case 'right':     selected = allChromeTabs.filter((t) => t.index > tab.index); break;
      case 'excluding': selected = allChromeTabs.filter((t) => t.id !== tab.id); break;
    }

    const tmTabs: TmTab[] = selected
      .filter((t) => t.url && !t.url.startsWith('chrome://'))
      .map((t, i) => ({
        id: t.id ?? Date.now() + i,
        title: t.title ?? t.url ?? '',
        url: t.url ?? '',
        favIconUrl: t.favIconUrl,
        pinned: t.pinned,
      }));

    if (tmTabs.length === 0) return;

    const state = await getGroupsState();
    const available = [...state.available];
    const targetIndex = available.findIndex((g) => g.id === groupId && !g.permanent);
    if (targetIndex < 0) return;

    const group = { ...available[targetIndex] };
    const newWindow: TmWindow = { id: Date.now(), tabs: tmTabs, incognito: false, focused: false };
    group.windows = [...group.windows, newWindow];
    group.updatedAt = Date.now();
    group.pendingSync = true;
    available[targetIndex] = group;

    await saveGroupsState({ ...state, available });
  });

  // Badge: live tab count
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

  chrome.tabs.onCreated.addListener((tab) => {
    void updateBadge();
    if (!tab.url || tab.url.startsWith('chrome://')) return;
    void (async () => {
      try {
        const { getAllUrlRules, matchUrlToRule, applyUrlRule } = await import('@/lib/urlRuleEngine');
        const rules = await getAllUrlRules();
        const groupId = matchUrlToRule(tab.url!, rules);
        if (groupId) await applyUrlRule(tab, groupId);
      } catch (err) {
        console.error('[urlRules] onCreated error:', err);
      }
    })();
  });
  chrome.tabs.onRemoved.addListener(() => void updateBadge());
  chrome.tabs.onUpdated.addListener((_, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      void updateBadge();
      if (!tab.url || tab.url.startsWith('chrome://')) return;
      void (async () => {
        try {
          const { getAllUrlRules, matchUrlToRule, applyUrlRule } = await import('@/lib/urlRuleEngine');
          const rules = await getAllUrlRules();
          const groupId = matchUrlToRule(tab.url!, rules);
          if (groupId) await applyUrlRule(tab, groupId);
        } catch (err) {
          console.error('[urlRules] onUpdated error:', err);
        }
      })();
    }
  });

  void updateBadge();

  // Reminder alarms — guarded: alarms/notifications not available until extension reloaded with new permissions
  if (chrome.alarms && chrome.notifications) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (!alarm.name.startsWith('reminder-')) return;
      const data = (await chrome.storage.local.get(alarm.name))[alarm.name] as
        | { url: string; title: string; note: string }
        | undefined;
      if (!data) return;
      const notifId = alarm.name;
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title: 'TabMerger Reminder',
        message: data.title + (data.note ? `\n${data.note}` : ''),
        requireInteraction: true
      });
    });

    chrome.notifications.onClicked.addListener(async (notifId) => {
      if (!notifId.startsWith('reminder-')) return;
      const data = (await chrome.storage.local.get(notifId))[notifId] as
        | { url: string; title: string; note: string }
        | undefined;
      if (data?.url) chrome.tabs.create({ url: data.url, active: true });
      chrome.notifications.clear(notifId);
      chrome.storage.local.remove(notifId);
      // The tab's reminder field will be stale in IDB but harmless — it won't re-alarm
    });
  }
});
