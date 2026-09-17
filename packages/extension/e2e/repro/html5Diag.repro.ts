/**
 * html5Diag.repro.ts — DIAGNOSTIC for the Html5DragSensor (the shipped sensor).
 *
 * Opens popup.html AS A NORMAL TAB, seeds a NON-permanent group with 2 tabs,
 * makes it active, then drags tab-grip-0 onto tab-grip-1 using REAL `DragEvent`s
 * dispatched via `page.evaluate` (Playwright's synthetic mouse drag does NOT
 * fire native `dragstart`).
 *
 * Two scenarios, each PACED (real waits between events so React re-renders in
 * between — mirrors the real-popup timing):
 *   A. dragstart → (wait) → dragover@target → (wait) → drop → dragend
 *   B. dragstart → (wait) → dragend@target   (popup throttled every dragover away;
 *      the release coords must still come off `dragend` and the move must commit)
 *
 * Both must end with `[tm-dnd] committed {... undoable:true}` and a reordered IDB.
 *
 * Run: pnpm --filter @tabmerger/extension exec playwright test --config e2e/repro/playwright.repro.config.ts html5Diag
 */
import { test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { seedIdb } from '../helpers';
import { NOW_OPEN, SAVED_GROUP } from '../seed';
import { EXTENSION_PATH } from './settings';

async function bootPopupTab(context: BrowserContext): Promise<{ page: Page; log: string[] }> {
  const sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const extensionId = new URL(sw.url()).hostname;
  const page = await context.newPage();
  const log: string[] = [];
  page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => log.push(`PAGEERROR: ${e.message}`));

  // Let the app boot fully first so ITS object stores exist — a bare
  // `indexedDB.open('tabmerger',1)` before that creates a store-less DB and the
  // seed write silently fails (then only "Now Open" shows).
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await seedIdb(page, [NOW_OPEN, SAVED_GROUP] as never);
  await page.evaluate(() => localStorage.setItem('tm_dnd_debug', '1'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate((name) => {
    const el = Array.from(document.querySelectorAll('span, div')).find(
      (n) => n.textContent?.trim() === name
    ) as HTMLElement | undefined;
    el?.click();
  }, SAVED_GROUP.name);
  await page.waitForTimeout(500);
  return { page, log };
}

function readWork() {
  return new Promise((resolve) => {
    const req = indexedDB.open('tabmerger', 1);
    req.onsuccess = () => {
      const tx = req.result.transaction('groups', 'readonly');
      tx.objectStore('groups').getAll().onsuccess = (e) => {
        const rows = (e.target as IDBRequest).result as {
          id: string;
          windows: { tabs: { title: string }[] }[];
        }[];
        const w = rows.find((r) => r.id === 'savedgroup01');
        resolve(w?.windows.map((win) => win.tabs.map((t) => t.title)));
      };
    };
  });
}

async function primeGrips(page: Page) {
  return page.evaluate(() => {
    const grips = Array.from(
      document.querySelectorAll('[aria-label^="Drag to reorder tab"]')
    ) as HTMLElement[];
    const from = grips[0];
    const to = grips[1] ?? grips[grips.length - 1];
    const rF = from.getBoundingClientRect();
    const rT = to.getBoundingClientRect();
    const w = window as unknown as Record<string, unknown>;
    w.__from = from;
    w.__dt = new DataTransfer();
    w.__mk = (type: string, x: number, y: number) =>
      new DragEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, dataTransfer: w.__dt as DataTransfer
      });
    return {
      fx: rF.x + 4, fy: rF.y + rF.height / 2,
      tx: rT.x + 4, ty: rT.y + rT.height - 2,
      grips: grips.length
    };
  });
}

const fire = (page: Page, type: string, x: number, y: number) =>
  page.evaluate(
    ({ type, x, y }) => {
      const w = window as unknown as {
        __from: HTMLElement;
        __mk: (t: string, x: number, y: number) => Event;
      };
      const target = type === 'dragstart' || type === 'dragend' ? w.__from : document;
      target.dispatchEvent(w.__mk(type, x, y));
    },
    { type, x, y }
  );

function stages(log: string[]) {
  return log.filter((l) => l.includes('[tm-dnd]')).map((l) => l.slice(l.indexOf('[tm-dnd]')));
}

test.describe('Html5DragSensor — tab context, real paced DragEvents', () => {
  test('A. dragstart → dragover → drop → dragend commits the reorder', async () => {
    test.setTimeout(90_000);
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        '--headless=new',
        `--load-extension=${EXTENSION_PATH}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });
    try {
      const { page, log } = await bootPopupTab(context);
      const g = await primeGrips(page);
      const before = await page.evaluate(readWork);

      await fire(page, 'dragstart', g.fx, g.fy);
      await page.waitForTimeout(150); // React flush
      await fire(page, 'dragover', g.tx, g.ty);
      await page.waitForTimeout(150);
      await fire(page, 'drop', g.tx, g.ty);
      await page.waitForTimeout(150);
      await fire(page, 'dragend', g.tx, g.ty);
      await page.waitForTimeout(700);

      const after = await page.evaluate(readWork);
      console.log('\n[A] grips:', g.grips, '| BEFORE:', JSON.stringify(before), '| AFTER:', JSON.stringify(after));
      console.log('[A] committed?', JSON.stringify(before) !== JSON.stringify(after));
      console.log('[A] stages:');
      for (const s of stages(log)) console.log('   ', s);
    } finally {
      await context.close().catch(() => {});
    }
  });

  test('B. dragstart → dragend only (every dragover throttled away) still commits via dragend coords', async () => {
    test.setTimeout(90_000);
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        '--headless=new',
        `--load-extension=${EXTENSION_PATH}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });
    try {
      const { page, log } = await bootPopupTab(context);
      const g = await primeGrips(page);
      const before = await page.evaluate(readWork);

      await fire(page, 'dragstart', g.fx, g.fy);
      await page.waitForTimeout(200);
      // no dragover, no drop — just the release, carrying the true target coords
      await fire(page, 'dragend', g.tx, g.ty);
      await page.waitForTimeout(700);

      const after = await page.evaluate(readWork);
      console.log('\n[B] grips:', g.grips, '| BEFORE:', JSON.stringify(before), '| AFTER:', JSON.stringify(after));
      console.log('[B] committed?', JSON.stringify(before) !== JSON.stringify(after));
      console.log('[B] stages:');
      for (const s of stages(log)) console.log('   ', s);
    } finally {
      await context.close().catch(() => {});
    }
  });
});
