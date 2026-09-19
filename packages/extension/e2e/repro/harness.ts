/**
 * Shared plumbing for the MV3-action-popup DnD repro runners.
 *
 * Playwright never surfaces the real toolbar action popup through its normal
 * `context` — so the harness launches its own persistent context with a remote
 * debugging port, opens the genuine popup via `chrome.action.openPopup()`, then
 * reconnects with a SECOND `connectOverCDP` client (that one DOES see the popup
 * target) to get a full `Page` handle for it.
 */
import {
  chromium,
  type BrowserContext,
  type Page,
  type Locator,
  type Worker
} from '@playwright/test';
import { seedIdb } from '../helpers';
import { EXTENSION_PATH, settings, type SeedGroup } from './settings';

export interface ReproSession {
  /** The launched persistent context (owns the browser process). */
  context: BrowserContext;
  /** Full Page handle for the REAL toolbar action popup. */
  popup: Page;
  extensionId: string;
  /** Console lines the popup emitted, newest last (includes `[tm-dnd]` stages). */
  consoleLog: string[];
  /** Close the CDP client + the browser; honours `settings.keepOpenMs`. */
  teardown(): Promise<void>;
}

async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  return existing ?? context.waitForEvent('serviceworker', { timeout: 15_000 });
}

/**
 * Launch Chromium with the extension, seed `groups` into the shared-origin IDB
 * via a throwaway popup.html tab, then open + attach to the real action popup.
 */
export async function startPopupSession(groups: SeedGroup[]): Promise<ReproSession> {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      ...(settings.headed ? [] : ['--headless=new']),
      `--load-extension=${EXTENSION_PATH}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${settings.cdpPort}`
    ]
  });

  const sw = await getServiceWorker(context);
  const extensionId = new URL(sw.url()).hostname;

  // 1. Seed IDB through popup.html-as-a-tab (Playwright can drive that fine).
  const seedTab = await context.newPage();
  await seedTab.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
  // Let the popup's own boot finish FIRST. On a fresh profile the DB is empty, and
  // `localDb`'s shared empty-DB init + the first `useCurrentTabs` sync both write
  // `groupsState`; seeding into that race silently lost every seeded group and left the
  // popup showing only "Now Open" (which then hangs every locator in this file).
  // `popupRealDnd.repro.ts`'s own launcher has always waited here — this one did not.
  await seedTab.waitForTimeout(1500);
  await seedIdb(seedTab, groups);
  if (settings.dndDebug) {
    await seedTab.evaluate(() => localStorage.setItem('tm_dnd_debug', '1'));
  }
  // 2. Park that tab on a neutral focused page so openPopup() has a target window.
  await seedTab.goto('data:text/html,<title>repro host</title><h1>repro host</h1>', {
    waitUntil: 'load'
  });
  await seedTab.bringToFront();

  // 3. Open the genuine toolbar popup.
  const opened = await sw.evaluate(async () => {
    try {
      await chrome.action.openPopup();
      return 'ok';
    } catch (e) {
      return `err: ${(e as Error).message}`;
    }
  });
  if (opened !== 'ok') throw new Error(`chrome.action.openPopup() failed: ${opened}`);

  // 4. Reconnect over CDP — this fresh client surfaces the popup page target.
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${settings.cdpPort}`);
  let popup: Page | undefined;
  for (let i = 0; i < 40 && !popup; i++) {
    popup = cdp
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().endsWith('/popup.html'));
    if (!popup) await seedTab.waitForTimeout(150);
  }
  if (!popup) {
    await context.close();
    throw new Error('real action popup page never appeared over CDP');
  }

  const consoleLog: string[] = [];
  popup.on('console', (m) => consoleLog.push(`${m.type()}: ${m.text()}`));
  popup.on('pageerror', (e) => consoleLog.push(`pageerror: ${e.message}`));

  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(600);

  return {
    context,
    popup,
    extensionId,
    consoleLog,
    async teardown() {
      if (settings.keepOpenMs > 0) await popup!.waitForTimeout(settings.keepOpenMs);
      await cdp.close().catch(() => {});
      await context.close().catch(() => {});
    }
  };
}

/** Read every group from the shared IndexedDB (titles only, for assertions/logging). */
export async function readAllGroups(page: Page): Promise<
  { id: string; name: string; windows: number; tabs: string[][] }[]
> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('tabmerger', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('groups', 'readonly');
          tx.objectStore('groups').getAll().onsuccess = (e) => {
            const rows = (e.target as IDBRequest).result as {
              id: string;
              name: string;
              windows: { tabs: { title: string }[] }[];
            }[];
            resolve(
              rows.map((g) => ({
                id: g.id,
                name: g.name,
                windows: g.windows.length,
                tabs: g.windows.map((w) => w.tabs.map((t) => t.title))
              }))
            );
          };
        };
      })
  );
}

/**
 * Human-ish drag: press the `from` handle, nudge past the 5px sensor activation
 * threshold, travel to `to`, settle, release. `to` may be another drag handle or
 * a sidebar group row.
 */
export async function dragBetween(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error(`dragBetween: missing bounding box (from=${!!a} to=${!!b})`);

  const { activationNudgePx, travelSteps, settleMs } = settings.drag;
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;

  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(ax, ay + activationNudgePx, { steps: 5 });
  await page.mouse.move(bx, by, { steps: travelSteps });
  await page.mouse.move(bx, by + 2, { steps: 4 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(settleMs);
}

/** Pull just the `[tm-dnd]` instrumentation stages out of the captured console. */
export function tmDndStages(consoleLog: string[]): string[] {
  return consoleLog
    .filter((l) => l.includes('[tm-dnd]'))
    .map((l) => l.slice(l.indexOf('[tm-dnd]')));
}
