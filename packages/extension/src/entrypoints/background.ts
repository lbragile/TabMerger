import * as Sentry from '@sentry/browser';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { runGoogleOAuthFlow } from '@/lib/googleOAuthFlow';
import { performSync } from '@/lib/syncEngine';
import { hasEncryptionKey, getDataKey } from '@/lib/encryptionKey';
import { trackEvent } from '@/lib/analytics';
import { createGroup } from '@/lib/utils';
import type { Tab as TmTab, Window as TmWindow } from '@/lib/types';

type SyncNowResult = { ok: true } | { ok: false; reason: 'no-session' | 'locked' | 'error'; message?: string };

// Triggered by the web dashboard's "Re-sync now" button via externally_connectable — runs a
// real push+pull sync from the background context instead of just re-reading Supabase, so the
// dashboard reflects changes the extension hasn't pushed yet. The background worker's in-memory
// data key resets on every SW restart same as the popup's does (see chrome.storage.session fix),
// so an account whose encryption was never unlocked THIS worker lifetime reports 'locked' rather
// than silently no-op'ing — the web UI surfaces that as "open the extension and unlock".
async function handleSyncNow(): Promise<SyncNowResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false, reason: 'no-session' };
    if (!(await hasEncryptionKey())) {
      return { ok: false, reason: 'locked', message: 'Open the extension to finish encryption setup.' };
    }
    if (!(await getDataKey())) {
      return { ok: false, reason: 'locked', message: 'Open the extension and unlock encryption to sync.' };
    }
    await performSync(session);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

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

// Shared by the context-menu handler and the global keyboard shortcuts: picks the
// subset of tabs in a window for a given scope, filtering out chrome:// urls.
export function tabsForScope(
  scope: Scope,
  contextTab: chrome.tabs.Tab,
  allTabs: chrome.tabs.Tab[]
): TmTab[] {
  const sorted = [...allTabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  let selected: chrome.tabs.Tab[];
  switch (scope) {
    case 'current':   selected = [contextTab]; break;
    case 'left':      selected = sorted.filter((t) => t.index < contextTab.index); break;
    case 'right':     selected = sorted.filter((t) => t.index > contextTab.index); break;
    case 'excluding': selected = sorted.filter((t) => t.id !== contextTab.id); break;
  }

  return selected
    .filter((t) => t.url && !t.url.startsWith('chrome://'))
    .map((t, i) => ({
      id: t.id ?? Date.now() + i,
      title: t.title ?? t.url ?? '',
      url: t.url ?? '',
      favIconUrl: t.favIconUrl,
      pinned: t.pinned,
    }));
}

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
    groups = state.available.filter((g) => !g.permanent && !g.archived);
  } catch {
    // IDB not ready — leave empty
  }

  await chrome.contextMenus.removeAll();

  // 'page' is included alongside 'tab' — right-clicking the page body is the far more common
  // gesture than right-clicking the tab strip itself, and omitting it made the menu appear
  // "missing" to users.
  const CONTEXTS: chrome.contextMenus.CreateProperties['contexts'] = ['tab', 'page'];
  chrome.contextMenus.create({ id: 'tm-add', title: 'Save to TabMerger', contexts: CONTEXTS });

  for (const scope of Object.keys(SCOPE_LABELS) as Scope[]) {
    chrome.contextMenus.create({ id: `tm-scope-${scope}`, parentId: 'tm-add', title: SCOPE_LABELS[scope], contexts: CONTEXTS });
    if (groups.length === 0) {
      chrome.contextMenus.create({ id: `tm-scope-${scope}-none`, parentId: `tm-scope-${scope}`, title: 'No saved groups yet', contexts: CONTEXTS, enabled: false });
    } else {
      for (const group of groups) {
        const tabCount = group.windows.reduce((n, w) => n + w.tabs.length, 0);
        chrome.contextMenus.create({
          id: `tm-scope-${scope}-${group.id}`,
          parentId: `tm-scope-${scope}`,
          title: `${colorEmoji(group.color)} ${group.name} (${group.windows.length}w · ${tabCount}t)`,
          contexts: CONTEXTS,
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
  // MV3 background is a service worker (`self`, no `window`/DOM) — placed inside
  // this callback (not module scope) because WXT statically imports entrypoint
  // files during dev-server startup to detect manifest metadata, and `self` isn't
  // a full service-worker global in that analysis pass. defaultIntegrations assume
  // a window, so they're disabled and errors are reported via self's error events.
  if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      defaultIntegrations: false,
    });
    self.addEventListener('error', (event) => Sentry.captureException(event.error ?? event.message));
    self.addEventListener('unhandledrejection', (event) => Sentry.captureException(event.reason));
  }

  chrome.runtime.onInstalled.addListener((details) => {
    void buildMenus();
    trackEvent(details.reason === 'install' ? 'extension_installed' : 'extension_updated', {
      reason: details.reason,
    });
  });
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

  // Google sign-in must run here, not in the popup: MV3 popups close the instant
  // they lose focus, and launchWebAuthFlow opens a window that steals it — see
  // runGoogleOAuthFlow's doc comment. The popup awaits this response but doesn't
  // need it to succeed (if the popup already closed, sendResponse just no-ops) —
  // the session lands via chrome.storage.onChanged the next time it opens either way.
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if ((msg as { type?: string })?.type === 'SIGN_IN_WITH_GOOGLE') {
      runGoogleOAuthFlow()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true; // keep the message channel open for the async sendResponse above
    }
  });

  // On-demand install probe for externally_connectable (see wxt.config.ts) — the web app
  // sends { type: 'PING' } via chrome.runtime.sendMessage(extensionId, ...) and checks the
  // response vs. chrome.runtime.lastError, avoiding the content script's page-load race.
  chrome.runtime.onMessageExternal.addListener((msg: unknown, _sender, sendResponse) => {
    const type = (msg as { type?: string })?.type;
    if (type === 'PING') {
      sendResponse({ type: 'PONG', version: chrome.runtime.getManifest().version });
      return;
    }
    if (type === 'SYNC_NOW') {
      void handleSyncNow().then(sendResponse);
      return true; // keep the message channel open for the async sendResponse above
    }
  });

  // Appends tabs as a new window to an existing (non-permanent) group. If groupId is
  // omitted, targets the first non-permanent group, creating a "Quick Save" group if
  // none exist yet — used by the global keyboard shortcut, which has no menu selection.
  async function appendTabsToGroup(tmTabs: TmTab[], groupId?: string) {
    if (tmTabs.length === 0) return;

    const state = await getGroupsState();
    const available = [...state.available];
    let targetIndex = groupId
      ? available.findIndex((g) => g.id === groupId && !g.permanent)
      : available.findIndex((g) => !g.permanent);

    if (targetIndex < 0 && !groupId) {
      available.push(createGroup(undefined, 'Quick Save'));
      targetIndex = available.length - 1;
    }
    if (targetIndex < 0) return;

    const group = { ...available[targetIndex] };
    const newWindow: TmWindow = { id: Date.now(), tabs: tmTabs, incognito: false, focused: false };
    group.windows = [...group.windows, newWindow];
    group.updatedAt = Date.now();
    group.pendingSync = true;
    available[targetIndex] = group;

    await saveGroupsState({ ...state, available });
  }

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const menuId = String(info.menuItemId);
    const scopeMatch = menuId.match(/^tm-scope-(current|left|right|excluding)-(.+)$/);
    if (!scopeMatch || !tab?.windowId || tab.index === undefined) return;
    const scope = scopeMatch[1] as Scope;
    const groupId = scopeMatch[2];

    const allChromeTabs = await chrome.tabs.query({ windowId: tab.windowId });
    const tmTabs = tabsForScope(scope, tab, allChromeTabs);

    await appendTabsToGroup(tmTabs, groupId);
  });

  // Global OS-level shortcuts (chrome://extensions/shortcuts) — work even when the
  // popup isn't open. Reuse the same scope-filtering logic as the context menu, but
  // always target the first non-permanent group (no menu selection to pick from).
  const COMMAND_SCOPES: Record<string, Scope> = {
    'save-current-tab': 'current',
    'save-tabs-left': 'left',
    'save-tabs-right': 'right',
    'save-other-tabs': 'excluding',
  };

  chrome.commands.onCommand.addListener(async (command) => {
    const scope = COMMAND_SCOPES[command];
    if (!scope) return;

    // chrome.action.openPopup() must be the very first thing this listener does —
    // Chrome only permits it within a short recency window of the triggering user
    // gesture. Querying tabs first (as this used to do, even just once) crosses an
    // await boundary before ever reaching openPopup(), which can push past that
    // window and cause a silent rejection — indistinguishable from "the shortcut
    // does nothing" once it falls through to the invisible immediate-save fallback.
    // Firefox MV2 / older Chrome don't have chrome.action.openPopup at all.
    let popupOpened = false;
    if (typeof chrome.action.openPopup === 'function') {
      try {
        await chrome.action.openPopup();
        popupOpened = true;
      } catch {
        popupOpened = false;
      }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || tab.url.startsWith('chrome://')) return;

    const allTabs = await chrome.tabs.query({ windowId: tab.windowId });
    const tmTabs = tabsForScope(scope, tab, allTabs);
    if (tmTabs.length === 0) return;

    if (popupOpened) {
      await chrome.storage.session.set({
        pendingShortcutSave: { tabs: tmTabs, scope, stashedAt: Date.now() }
      });
      return;
    }

    await appendTabsToGroup(tmTabs);
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
