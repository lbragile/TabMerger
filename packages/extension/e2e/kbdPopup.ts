import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import http from 'http';
import { seedIdb } from './helpers';
import { EXTENSION_PATH } from './extensionPath';
import { CDP_TARGET_CLOSED, RawCdp } from './rawCdp';

/**
 * Harness for driving the keyboard-move feature in the REAL MV3 toolbar popup the way a
 * user does: `chrome.action.openPopup()` + raw CDP `Input.dispatchKeyEvent`, focus reached
 * with the Tab key (never by focusing a grip directly). Headless (`--headless=new`).
 */

// One resolver for the whole suite (honours TM_E2E_EXT_DIR), see extensionPath.ts.
const EXT = EXTENSION_PATH;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mkTab = (title: string) => ({ id: 0, title, url: `https://example.com/${title.toLowerCase()}` });
export type SeedGroup = Parameters<typeof seedIdb>[1][number];
export const win = (id: number, ...titles: string[]) => ({ id, incognito: false, focused: false, tabs: titles.map(mkTab) });
export const grp = (id: string, name: string, ...windows: ReturnType<typeof win>[]): SeedGroup => ({ id, name, color: 'rgba(59,130,246,1)', windows });
export const NOW_OPEN: SeedGroup = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };

/** The standard fixture: Work (2 windows), Play (1 window / 1 tab), Extra, Quad. */
export const STANDARD_GROUPS = (): SeedGroup[] => [
  NOW_OPEN,
  grp('work', 'Work', win(1, 'Alpha', 'Bravo', 'Charlie'), win(2, 'Delta', 'Echo')),
  grp('play', 'Play', win(3, 'Foxtrot')),
  grp('extra', 'Extra', win(4, 'Golf')),
  grp('quad', 'Quad', win(5, 'Hotel')),
];

const KEYS = {
  Space: { key: ' ', vk: 32, text: ' ' },
  Enter: { key: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', vk: 9 },
  ArrowDown: { key: 'ArrowDown', vk: 40 },
  ArrowUp: { key: 'ArrowUp', vk: 38 },
  ArrowLeft: { key: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', vk: 39 },
  Escape: { key: 'Escape', vk: 27 },
} as const;
export type KeyName = keyof typeof KEYS;

export interface PopupSession {
  context: BrowserContext;
  sw: Worker;
  cdp: RawCdp;
  /** loopback base URL serving `<title>` = capitalised last path segment */
  liveBase: string;
  press(key: KeyName, opts?: { shift?: boolean; ctrl?: boolean; ms?: number }): Promise<void>;
  /** Press Tab (Shift+Tab when `back`) until `document.activeElement` matches `matcherJs` (an expression over `el`). */
  tabTo(matcherJs: string, opts?: { back?: boolean; max?: number }): Promise<void>;
  /** Latest announcement text (app-owned region if written, else dnd-kit's). */
  live(): Promise<string>;
  /** Everything currently focused, for diagnostics. */
  focused(): Promise<string>;
  /** groupId -> windows -> titles (from IndexedDB) plus the group order. */
  snapshot(): Promise<{ order: string[]; groups: Record<string, string[][]> }>;
  eval<T>(expr: string): Promise<T>;
  /** URLs (committed or pending) of every real browser tab, read in the service worker. No page load needed. */
  tabUrls(): Promise<string[]>;
  close(): Promise<void>;
}

// Offset by Playwright's worker index so parallel workers never share a debugging port.
let portCounter = 9460 + Number(process.env.TEST_PARALLEL_INDEX ?? 0) * 100;

/** Open the real popup on `groups` with `liveTabs` open as real browser tabs (Now Open). */
export async function openRealPopup(
  groups: SeedGroup[],
  opts: { liveWindows?: string[][]; dndDebug?: boolean } = {}
): Promise<PopupSession> {
  const port = portCounter++;
  const server = http.createServer((req, res) => {
    const seg = (req.url ?? '/x').split('/').pop() || 'x';
    res.setHeader('Connection', 'close');
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>${seg.charAt(0).toUpperCase() + seg.slice(1)}</title><body>${seg}</body>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const liveBase = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      '--headless=new',
      `--load-extension=${EXT}`,
      `--disable-extensions-except=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(sw.url()).hostname;

  const seedPage = await context.newPage();
  await seedPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
  await seedIdb(seedPage, groups);
  // The move/drag stage log (`__tmDndLog`) and the groups query client (`__tmQueryClient`) are exposed to the page only when this flag is set.
  if (opts.dndDebug) await seedPage.evaluate(() => localStorage.setItem('tm_dnd_debug', '1'));
  await seedPage.close();

  // Real browser tabs (Now Open). First list goes in the existing window, others in new windows.
  const liveWindows = opts.liveWindows ?? [];
  for (let wi = 0; wi < liveWindows.length; wi++) {
    for (let ti = 0; ti < liveWindows[wi].length; ti++) {
      const url = `${liveBase}/${liveWindows[wi][ti]}`;
      if (wi === 0) {
        const p = await context.newPage();
        await p.goto(url);
      } else if (ti === 0) {
        await sw.evaluate(async (u) => {
          await chrome.windows.create({ url: u, focused: false });
        }, url);
      } else {
        await sw.evaluate(async (u) => {
          const w = (await chrome.windows.getAll()).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
          await chrome.tabs.create({ url: u, windowId: w.id, active: false });
        }, url);
      }
    }
  }

  const hostPage = await context.newPage();
  if (process.env.KBD_AS_TAB) {
    // Headless popups are capped below 800x600 (the 800px body then scrolls sideways): render
    // popup.html in a tab with an exact 800x600 viewport instead (layout checks only).
    await hostPage.setViewportSize({ width: 800, height: Number(process.env.KBD_H ?? 600) });
    await hostPage.goto(`chrome-extension://${extensionId}/popup.html`);
  } else {
    await hostPage.goto('about:blank');
    await hostPage.bringToFront();
    await sw.evaluate(async () => {
      await chrome.action.openPopup();
    });
  }
  const cdp = await RawCdp.attach(port, '/popup.html');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Page.enable').catch(() => {});

  const evalX = <T,>(expr: string) => cdp.evaluate<T>(expr);
  const session: PopupSession = {
    context,
    sw,
    cdp,
    liveBase,
    eval: evalX,
    async press(key, o = {}) {
      const ctrlMod = o.ctrl ? 2 : 0;
      const k = KEYS[key] as { key: string; vk: number; text?: string };
      const modifiers = (o.shift ? 8 : 0) | ctrlMod;
      // A key can legitimately dismiss the popup (Enter on a tab opens it, which closes the
      // toolbar popup and its CDP socket). That is not a failure: swallow only the
      // "target closed" rejection, and only for the key events; anything else still throws.
      const dispatch = async (params: Record<string, unknown>) => {
        try {
          await cdp.send('Input.dispatchKeyEvent', params);
        } catch (e) {
          if (!(e instanceof Error) || e.message !== CDP_TARGET_CLOSED) throw e;
        }
      };
      await dispatch({
        type: 'keyDown', code: key === 'Space' ? 'Space' : key, key: k.key,
        windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers,
        ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}),
      });
      await dispatch({
        type: 'keyUp', code: key, key: k.key, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers,
      });
      await sleep(o.ms ?? 180);
    },
    async tabTo(matcherJs, o = {}) {
      const max = o.max ?? 150;
      for (let i = 0; i < max; i++) {
        const ok = await evalX<boolean>(`(() => { const el = document.activeElement; return !!el && el !== document.body && (${matcherJs}); })()`);
        if (ok) return;
        await session.press('Tab', { shift: o.back, ms: 30 });
      }
      throw new Error(`tabTo(${matcherJs}) not reached in ${max} Tab presses; focused=${await session.focused()}`);
    },
    live: () =>
      evalX<string>(
        `(() => { const a = document.getElementById('tm-dnd-live-region')?.textContent ?? ''; const k = document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? ''; return (a || k).trim(); })()`
      ),
    focused: () =>
      evalX<string>(
        `(() => { const e = document.activeElement; return e ? (e.tagName + ' ' + (e.getAttribute('aria-label') ?? '') + ' ' + (e.getAttribute('data-tm-dnd-id') ?? '')) : 'none'; })()`
      ),
    snapshot: () =>
      evalX(
        `new Promise(resolve => { const req = indexedDB.open('tabmerger', 1); req.onsuccess = () => { const db = req.result; const tx = db.transaction(['groups','groupsState'], 'readonly'); const out = { order: [], groups: {} }; tx.objectStore('groups').getAll().onsuccess = (e) => { for (const g of e.target.result) out.groups[g.id] = (g.windows || []).map(w => (w.tabs || []).map(t => t.title)); }; tx.objectStore('groupsState').get('state').onsuccess = (e) => { out.order = (e.target.result && e.target.result.order) || []; }; tx.oncomplete = () => resolve(out); }; })`
      ),
    tabUrls: () =>
      sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl || '')),
    async close() {
      cdp.close();
      await context.close().catch(() => {});
      await new Promise((r) => server.close(r));
    },
  };

  // Wait for the sidebar to render.
  for (let i = 0; i < 50; i++) {
    if (await evalX<boolean>(`!!document.querySelector('[data-sidebar-group-index]')`)) break;
    await sleep(100);
  }
  return session;
}

/** Row matcher (over `el`) for a tab/window/group by aria-label. */
export const rowLabel = (label: string) => `el.getAttribute('aria-label') === ${JSON.stringify(label)}`;
export const groupRow = (name: string) => `el.hasAttribute('data-sidebar-group-index') && el.getAttribute('aria-label') === ${JSON.stringify(name)}`;

/** Keyboard-open a saved group: Tab to its sidebar row and press Enter. */
export async function openGroup(s: PopupSession, name: string) {
  await s.tabTo(groupRow(name));
  await s.press('Enter');
  await sleep(200);
}

/** Ctrl+click rows to build a selection (setup only — the move under test is keyboard). */
export async function ctrlSelect(s: PopupSession, labels: string[], attr = 'role="listitem"') {
  for (const l of labels) {
    await s.eval(
      `(() => { const el = [...document.querySelectorAll('[${attr}]')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(l)}); el.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true })); })()`
    );
    await sleep(120);
  }
}

/** Press ArrowDown/Up up to `max` times until the live text matches; returns the announcements seen. */
export async function walkUntil(s: PopupSession, key: 'ArrowDown' | 'ArrowUp', re: RegExp, max = 12): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    await s.press(key);
    const t = await s.live();
    seen.push(t);
    if (re.test(t)) return seen;
  }
  return seen;
}

/** A starred window (pinned above the unstarred ones); `seedIdb` stores the window object as given. */
export const starredWin = (id: number, ...titles: string[]) => ({ ...win(id, ...titles), starred: true }) as ReturnType<typeof win>;

/** Named scroll containers / zones the keyboard-move copy must stay inside. */
export type Within = 'panel' | 'sidebar' | 'zone:new-window' | 'zone:new-group' | `list:${string}`;

const WITHIN_JS = (w: Within) => {
  if (w === 'panel') return `document.querySelector('[data-testid="windows-panel-scroll"]')`;
  if (w === 'sidebar') return `document.querySelector('[data-sidebar-group-index]')?.closest('[data-radix-scroll-area-viewport]')`;
  if (w === 'zone:new-window') return `document.querySelector('[data-testid="new-window-dropzone"]')`;
  if (w === 'zone:new-group') return `document.querySelector('[data-testid="new-group-dropzone"]')`;
  return `document.querySelector('[data-tm-dnd-list="${w.slice(5)}"]')`;
};

/**
 * Is the docked copy (the `drag-ghost` in the aux host) fully inside the visible rect of every
 * named container? Returns the failures (empty = visible) so a failing cell says which edge.
 */
export async function ghostOutside(s: PopupSession, within: Within[]): Promise<string[]> {
  const probes = within.map((w) => `{ name: ${JSON.stringify(w)}, el: ${WITHIN_JS(w)} }`).join(',');
  return s.eval<string[]>(`(() => {
    const g = document.querySelector('#tm-dnd-aux-host [data-testid="drag-ghost"]');
    if (!g) return ['no ghost'];
    const r = g.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return ['ghost has no size'];
    const out = [];
    for (const p of [${probes}]) {
      if (!p.el) { out.push(p.name + ' missing'); continue; }
      const b = p.el.getBoundingClientRect();
      const t = 2;
      if (r.top < b.top - t || r.bottom > b.bottom + t || r.left < b.left - t || r.right > b.right + t)
        out.push(p.name + ' box=' + [b.top, b.bottom].map(Math.round) + ' ghost=' + [r.top, r.bottom].map(Math.round));
    }
    return out;
  })()`);
}
