import * as Sentry from '@sentry/browser';
import { isOpenableUrl } from '@/lib/safeOpen';
import { parseBridgeMessage, type BridgeMessage } from '@/lib/bridgeMessage';
import { getGroupsState, updateGroupsState, registerGroupsChangeListener } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { runGoogleOAuthFlow } from '@/lib/googleOAuthFlow';
import { performSyncCycle, type SyncCycleStatus } from '@/lib/syncEngine';
import { GROUPS_CHANGED_MESSAGE } from '@/lib/groupsChangedMessage';
import { getEncryptionKeyState, getDataKey } from '@/lib/encryptionKey';
import { trackEvent } from '@/lib/analytics';
import { releaseChannel } from '@/lib/releaseChannel';
import { createGroup } from '@/lib/utils';
import { isTourDemoGroup } from '@tabmerger/shared';
import { copyLiveTab } from '@/lib/dndMove';
import { isTourPracticeUrl } from '@/lib/tourPracticeTab';
import type { Tab as TmTab, Window as TmWindow } from '@/lib/types';
import { DEFERRED_CLOSE_PORT, type DeferredCloseMessage } from '@/lib/deferredTabClose';
import {
  ANALYTICS_EVENTS,
  EXTENSION_MESSAGE,
  SIGN_IN_DATA_CONSENT_CATEGORIES,
  SYNC_AUTH_CONSENT_REQUIRED_REASON,
} from '@tabmerger/shared';
import { hasDataConsent, isFirefoxBuild } from '@/lib/dataConsent';
import { markTourPendingOnInstall } from '@/lib/tour';
import { registerAutoBackup } from '@/lib/autoBackupAlarm';
import { registerUninstallSurvey } from '@/lib/uninstallSurvey';
import { registerUpdateAvailable } from '@/lib/extensionUpdate';
import { recordInstallDate, registerHeartbeat } from '@/lib/heartbeat';
import { isOwnExtensionPage, isReminderAlarmName, isAlarmDelayMinutes } from '@/lib/messageSender';
import { resolveTrustedWebAppOrigins } from '@/lib/webAppOrigins';
import { followLocalePreference, initI18n, t } from '@/lib/i18n';

/**
 * `skipped: true` = another sync cycle (the popup's, or an earlier request) held the sync lock, so
 * THIS request ran nothing. That cycle may already be past its push step: an edit made just before
 * the request is not guaranteed to be on the server yet when the reply arrives.
 */
type SyncNowResult = { ok: true; skipped: boolean } | { ok: false; reason: 'no-session' | 'locked' | 'error'; message?: string };

// Triggered by the web dashboard's "Re-sync now" button via externally_connectable — runs a
// real push+pull sync from the background context instead of just re-reading Supabase, so the
// dashboard reflects changes the extension hasn't pushed yet. The background worker's in-memory
// data key resets on every SW restart same as the popup's does (see chrome.storage.session fix),
// so an account whose encryption was never unlocked THIS worker lifetime reports 'locked' rather
// than silently no-op'ing — the web UI surfaces that as "open the extension and unlock".
/** What the dashboard is told when a cycle ran but did not complete (nothing was merged or lost). */
const SYNC_NOW_FAILURE_MESSAGE: Record<Exclude<SyncCycleStatus, 'synced' | 'busy'>, () => string> = {
  'pull-failed': () => t('background.syncNow.pullFailed'),
  // The worker never switches (wipes) the local store itself: that is destructive and belongs to
  // the popup's sign-in flow, where the user is present. Until then nothing is pushed or merged.
  'account-mismatch': () => t('background.syncNow.accountMismatch'),
  'identity-changed': () => t('background.syncNow.identityChanged')
};

// Settles once the Settings language choice is applied (see followLocalePreference)
let localeReady: Promise<void> = Promise.resolve();

async function handleSyncNow(): Promise<SyncNowResult> {
  // Its messages are shown on the dashboard: in the language chosen in Settings
  await localeReady;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false, reason: 'no-session' };
    const keyState = await getEncryptionKeyState();
    // The check failed (offline, 401, 5xx): not "setup unfinished", and nothing may be uploaded.
    if (keyState === 'unknown') {
      return { ok: false, reason: 'error', message: t('background.syncNow.keyCheckFailed') };
    }
    if (keyState === 'absent') {
      return { ok: false, reason: 'locked', message: t('background.syncNow.setupUnfinished') };
    }
    if (!(await getDataKey())) {
      return { ok: false, reason: 'locked', message: t('background.syncNow.locked') };
    }
    const { status } = await performSyncCycle(session);
    if (status === 'synced' || status === 'busy') return { ok: true, skipped: status === 'busy' };
    return { ok: false, reason: 'error', message: SYNC_NOW_FAILURE_MESSAGE[status]() };
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

const SCOPE_LABELS: Record<Scope, () => string> = {
  current:   () => t('background.menu.scopeCurrent'),
  left:      () => t('background.menu.scopeLeft'),
  right:     () => t('background.menu.scopeRight'),
  excluding: () => t('background.menu.scopeExcluding'),
};

// Shared by the context-menu handler and the global keyboard shortcuts: picks the
// subset of tabs in a window for a given scope, filtering out chrome:// urls. The result
// is what gets saved, so each tab is a detached saved copy (id 0, savedAt — see copyLiveTab).
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
    // (never the guided tour's spare practice tab: it is not one of the user's tabs)
    .filter((t) => t.url && !t.url.startsWith('chrome://') && !isTourPracticeUrl(t.url))
    .map((t) =>
      copyLiveTab({
        id: t.id ?? 0,
        title: t.title ?? t.url ?? '',
        url: t.url ?? '',
        favIconUrl: t.favIconUrl,
      })
    );
}

let _building = false;
// Set when a rebuild is requested WHILE one is already in flight — the in-flight build may
// have already fetched groups before the change that triggered the new request landed in
// IDB, so its result could be stale by the time it resolves. Rather than drop the request
// (the old `_building` guard did exactly that), queue exactly one more rebuild to run right
// after, which re-reads groups fresh and picks up whatever changed.
let _rebuildPending = false;
async function buildMenus() {
  if (_building) {
    _rebuildPending = true;
    return;
  }
  _building = true;
  try { await _buildMenus(); } finally { _building = false; }
  if (_rebuildPending) {
    _rebuildPending = false;
    void buildMenus();
  }
}

// Debounce window for coalescing bursts of groups-changed notifications (bulk actions, DnD
// reorders, and sync all fire several writes in quick succession) into a single menu rebuild.
const REBUILD_DEBOUNCE_MS = 150;
let _rebuildTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMenuRebuild() {
  if (_rebuildTimer) return; // a rebuild is already scheduled for this burst
  _rebuildTimer = setTimeout(() => {
    _rebuildTimer = null;
    void buildMenus();
  }, REBUILD_DEBOUNCE_MS);
}

async function _buildMenus() {
  // Fetch groups before touching contextMenus — no async gap after removeAll
  let groups: Awaited<ReturnType<typeof getGroupsState>>['available'] = [];
  try {
    const state = await getGroupsState();
    // Never the guided tour's practice groups: the menu only offers the user's own groups
    groups = state.available.filter((g) => !g.permanent && !g.archived && !isTourDemoGroup(g));
  } catch {
    // IDB not ready — leave empty
  }

  await chrome.contextMenus.removeAll();

  // 'page' is included alongside 'tab' — right-clicking the page body is the far more common
  // gesture than right-clicking the tab strip itself, and omitting it made the menu appear
  // "missing" to users.
  const CONTEXTS: chrome.contextMenus.CreateProperties['contexts'] = ['tab', 'page'];
  chrome.contextMenus.create({ id: 'tm-add', title: t('background.menu.saveTo'), contexts: CONTEXTS });

  for (const scope of Object.keys(SCOPE_LABELS) as Scope[]) {
    chrome.contextMenus.create({ id: `tm-scope-${scope}`, parentId: 'tm-add', title: SCOPE_LABELS[scope](), contexts: CONTEXTS });
    if (groups.length === 0) {
      chrome.contextMenus.create({ id: `tm-scope-${scope}-none`, parentId: `tm-scope-${scope}`, title: t('background.menu.noGroups'), contexts: CONTEXTS, enabled: false });
    } else {
      for (const group of groups) {
        const tabCount = group.windows.reduce((n, w) => n + w.tabs.length, 0);
        chrome.contextMenus.create({
          id: `tm-scope-${scope}-${group.id}`,
          parentId: `tm-scope-${scope}`,
          title: t('background.menu.groupItem', { color: colorEmoji(group.color), name: group.name, windows: group.windows.length, tabs: tabCount }),
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
  // First: menus, notifications and sync-now replies all read the catalog
  initI18n();
  // ...in the language chosen in Settings, once read (the worker has no synchronous storage):
  // a change rebuilds the right-click menu, notifications read the catalog when shown
  localeReady = followLocalePreference(scheduleMenuRebuild).ready;
  // MV3 background is a service worker (`self`, no `window`/DOM) — placed inside
  // this callback (not module scope) because WXT statically imports entrypoint
  // files during dev-server startup to detect manifest metadata, and `self` isn't
  // a full service-worker global in that analysis pass. defaultIntegrations assume
  // a window, so they're disabled and errors are reported via self's error events.
  // Skipped during e2e/dev builds (VITE_E2E_TEST, see analytics.ts) — same reason as the popup.
  if (import.meta.env.VITE_SENTRY_DSN && !import.meta.env.VITE_E2E_TEST) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      defaultIntegrations: false,
    });
    self.addEventListener('error', (event) => Sentry.captureException(event.error ?? event.message));
    self.addEventListener('unhandledrejection', (event) => Sentry.captureException(event.reason));
  }

  // In-SW writes (syncEngine, urlRuleEngine, command handlers below) can't reach this
  // worker's own onMessage listener via sendMessage — see notifyGroupsChanged's doc
  // comment in localDb.ts. This direct callback is the in-SW half of that mechanism.
  registerGroupsChangeListener(scheduleMenuRebuild);

  chrome.runtime.onInstalled.addListener((details) => {
    void buildMenus();
    // Guided tour: pending on a first install only, never on an update (see lib/tour.ts)
    void markTourPendingOnInstall(details.reason);
    // Same param keys as the web's extension_uninstalled event so GA4 can join installs and uninstalls
    const browserName = import.meta.env.BROWSER as unknown as string | undefined;
    trackEvent(details.reason === 'install' ? ANALYTICS_EVENTS.extensionInstalled : ANALYTICS_EVENTS.extensionUpdated, {
      reason: details.reason,
      extension_version: chrome.runtime.getManifest().version,
      channel: releaseChannel(),
      ...(browserName ? { browser: browserName } : {}),
    });
    // Install date for the heartbeat's "days since install" (first install only)
    void recordInstallDate(details.reason).catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => { void buildMenus(); void reRegisterReminders(); });
  void buildMenus();
  void reRegisterReminders();
  // On every worker start, not only onInstalled: an update changes the version in the URL
  registerUninstallSurvey();

  // Tabs the popup dragged OUT of "Now Open" that it must not close itself: closing the
  // ACTIVE tab of the popup's anchor window dismisses the popup instantly (spec C7), which
  // used to kill the drop commit. That is the only tab it holds back; every other dragged
  // tab the popup closes itself at the drop. The popup posts the ids down a long-lived
  // port and we close them when that port disconnects — i.e. the moment the popup goes
  // away, whatever made it go away. The open port also keeps this worker alive until then,
  // so the close can't be lost to worker eviction.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== DEFERRED_CLOSE_PORT) return;
    const pending = new Set<number>();
    port.onMessage.addListener((msg: unknown) => {
      const m = msg as DeferredCloseMessage | undefined;
      if (Array.isArray(m?.tabIds)) m.tabIds.forEach((id) => { if (typeof id === 'number' && id > 0) pending.add(id); });
      // An Undo of the drop put the tab back: it must stay open after all
      if (Array.isArray(m?.keepTabIds)) m.keepTabIds.forEach((id) => pending.delete(id));
    });
    port.onDisconnect.addListener(() => {
      if (pending.size === 0) return;
      // Best effort: a tab the user already closed makes `remove` reject, which must not
      // take the rest of the batch down.
      void chrome.tabs.remove([...pending]).catch(() => {
        pending.forEach((id) => void chrome.tabs.remove(id).catch(() => {}));
      });
    });
  });

  chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
    const m = msg as { type?: unknown; name?: unknown; delayInMinutes?: unknown } | null | undefined;
    // Alarm helpers — chrome.alarms only available in background, not popup. Accepted only from
    // this extension's own pages (never a content script, see isOwnExtensionPage) and only for
    // reminder alarms with a real delay: no other alarm can be created or cleared this way.
    if (m?.type === 'CREATE_ALARM' && isOwnExtensionPage(sender) && isReminderAlarmName(m.name) && isAlarmDelayMinutes(m.delayInMinutes)) {
      chrome.alarms.create(m.name, { delayInMinutes: m.delayInMinutes });
    }
    if (m?.type === 'CLEAR_ALARM' && isOwnExtensionPage(sender) && isReminderAlarmName(m.name)) {
      void chrome.alarms.clear(m.name);
    }
    // Popup-side (and other extension-page) half of the mechanism described in
    // localDb.ts's notifyGroupsChanged — a groups-changing write in the popup wakes this
    // SW via sendMessage delivery and lands here.
    if (m?.type === GROUPS_CHANGED_MESSAGE) {
      scheduleMenuRebuild();
    }
  });

  // Google sign-in must run here, not in the popup: MV3 popups close the instant
  // they lose focus, and launchWebAuthFlow opens a window that steals it — see
  // runGoogleOAuthFlow's doc comment. The popup awaits this response but doesn't
  // need it to succeed (if the popup already closed, sendResponse just no-ops) —
  // the session lands via chrome.storage.onChanged the next time it opens either way.
  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    // Only the popup may start a sign-in window (never a content script, see isOwnExtensionPage).
    if ((msg as { type?: string } | null | undefined)?.type === 'SIGN_IN_WITH_GOOGLE' && isOwnExtensionPage(sender)) {
      runGoogleOAuthFlow()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true; // keep the message channel open for the async sendResponse above
    }
  });

  // Shared by externally_connectable (Chrome/Edge) and the Firefox web-bridge content script
  // (see web-bridge.content.ts) below — same three message types, same handling, so neither
  // path can drift from the other.
  function handleBridgeMessage(
    m: BridgeMessage,
    sendResponse: (response?: unknown) => void
  ): boolean | void {
    // On-demand install probe: web app checks the response vs. chrome.runtime.lastError.
    if (m.type === EXTENSION_MESSAGE.PING) {
      sendResponse({ type: EXTENSION_MESSAGE.PONG, version: chrome.runtime.getManifest().version });
      return;
    }
    if (m.type === EXTENSION_MESSAGE.SYNC_NOW) {
      void handleSyncNow().then(sendResponse);
      return true; // keep the message channel open for the async sendResponse above
    }
    // Auth bridge: the web app forwards the Supabase session it just signed in with here so
    // we can call setSession(), which writes to chrome.storage.local — the popup's supabase
    // client picks it up via chrome.storage.onChanged. Replaces the old content-script scrape
    // of the web app's localStorage.
    if (m.type === EXTENSION_MESSAGE.SYNC_AUTH && m.accessToken && m.refreshToken) {
      const accessToken = m.accessToken;
      const refreshToken = m.refreshToken;
      // Firefox-only: this message has no user gesture behind it in THIS context (it arrives
      // from a background message listener, not a click), so there's nowhere here to hang a
      // permissions.request() prompt — Firefox requires that call be synchronous inside a
      // user-activated event. Accept the session only if sign-in's consent categories were
      // already granted (e.g. via the Auth modal's own sign-in flow on this device); otherwise
      // tell the web app plainly instead of silently handing over a session with no permission
      // to actually use it for sync. No-op check on Chrome/Edge (always true there).
      if (isFirefoxBuild()) {
        void hasDataConsent(SIGN_IN_DATA_CONSENT_CATEGORIES).then((granted) => {
          if (!granted) {
            sendResponse({ ok: false, reason: SYNC_AUTH_CONSENT_REQUIRED_REASON });
            return;
          }
          void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          sendResponse({ ok: true });
        });
        return true; // keep the message channel open for the async sendResponse above
      }
      void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      return;
    }
  }

  // externally_connectable (see wxt.config.ts) — the web app talks to this listener via
  // chrome.runtime.sendMessage(extensionId, ...), which requires no host permission at all
  // (unlike the content script this used to be routed through). Chrome/Edge only — Firefox
  // doesn't support externally_connectable for web pages, see the onMessage listener below.
  chrome.runtime.onMessageExternal.addListener((msg: unknown, _sender, sendResponse) => {
    // Runtime check first: the sender is a web page, so the shape is not trusted (see parseBridgeMessage)
    const m = parseBridgeMessage(msg);
    if (!m) return;
    return handleBridgeMessage(m, sendResponse);
  });

  // Firefox-only counterpart of the listener above (relayed by web-bridge.content.ts, which
  // is excluded from Chrome/Edge builds — see that file's `include: ['firefox']`). A content
  // script's sendMessage always looks internal to onMessage, so this must independently prove
  // the message actually came from that content script and not some other extension code path:
  // `sender.id === runtime.id` (true for any of our own extension pages/scripts) AND
  // `sender.url`'s origin is one of this build's trusted web app origins (only the bridge script
  // runs there — nothing else in this extension has a content script on those pages). The list
  // is the bridge's own `matches` list: VITE_WEB_APP_URL plus VITE_EXTRA_WEB_APP_URLS. A value
  // the parser rejects already failed the build, so the catch only fails closed (trust nothing).
  const WEB_APP_ORIGINS: readonly string[] = (() => {
    try {
      return resolveTrustedWebAppOrigins(import.meta.env.VITE_WEB_APP_URL, import.meta.env.VITE_EXTRA_WEB_APP_URLS, {
        allowLocalhostHttp: import.meta.env.MODE === 'development',
      });
    } catch {
      return [];
    }
  })();
  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    const m = parseBridgeMessage(msg);
    if (!m) return;
    if (sender.id !== chrome.runtime.id) return;
    if (WEB_APP_ORIGINS.length === 0 || !sender.url) return;
    let senderOrigin: string;
    try {
      senderOrigin = new URL(sender.url).origin;
    } catch {
      return;
    }
    if (!WEB_APP_ORIGINS.includes(senderOrigin)) return;
    return handleBridgeMessage(m, sendResponse);
  });

  // Appends tabs as a new window to an existing (non-permanent) group. If groupId is
  // omitted, targets the first non-permanent group, creating a "Quick Save" group if
  // none exist yet — used by the global keyboard shortcut, which has no menu selection.
  async function appendTabsToGroup(tmTabs: TmTab[], groupId?: string) {
    if (tmTabs.length === 0) return;
    // A new "Quick Save" group is named in the language chosen in Settings
    await localeReady;

    // One atomic read-modify-write: the popup may be saving/editing at the same time, and it
    // has its own write queue, so a plain get-then-save here could drop its write (or ours).
    await updateGroupsState((state) => {
      const available = [...state.available];
      let targetIndex = groupId
        ? available.findIndex((g) => g.id === groupId && !g.permanent && !isTourDemoGroup(g))
        : available.findIndex((g) => !g.permanent && !isTourDemoGroup(g));

      if (targetIndex < 0 && !groupId) {
        available.push(createGroup(undefined, t('common.quickSaveGroup')));
        targetIndex = available.length - 1;
      }
      if (targetIndex < 0) return null;

      const group = { ...available[targetIndex] };
      const newWindow: TmWindow = { id: Date.now(), tabs: tmTabs, incognito: false, focused: false };
      group.windows = [...group.windows, newWindow];
      group.updatedAt = Date.now();
      group.pendingSync = true;
      available[targetIndex] = group;

      return { ...state, available };
    });
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
      // The alarm may be what woke the worker: its title must not beat the stored language
      await localeReady;
      const notifId = alarm.name;
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title: t('background.reminder.title'),
        message: data.title + (data.note ? `\n${data.note}` : ''),
        requireInteraction: true
      });
    });

    chrome.notifications.onClicked.addListener(async (notifId) => {
      if (!notifId.startsWith('reminder-')) return;
      const data = (await chrome.storage.local.get(notifId))[notifId] as
        | { url: string; title: string; note: string }
        | undefined;
      const url: unknown = data?.url;
      if (isOpenableUrl(url)) chrome.tabs.create({ url, active: true });
      chrome.notifications.clear(notifId);
      chrome.storage.local.remove(notifId);
      // The tab's reminder field will be stale in IDB but harmless — it won't re-alarm
    });
  }

  // Automatic backups (Pro): own alarm, own listeners (registered after the reminder ones, which
  // they never touch), see lib/autoBackupAlarm.ts. Only creates and uploads a backup session; it
  // never runs a groups sync cycle.
  registerAutoBackup();

  // "Update available" prompt: records a downloaded update the popup offers to apply, and drops
  // the record once applied (see lib/extensionUpdate.ts). Registered after the listeners above.
  registerUpdateAvailable();

  // Daily extension_heartbeat (own alarm, own onAlarm listener, see lib/heartbeat.ts)
  registerHeartbeat();
});
