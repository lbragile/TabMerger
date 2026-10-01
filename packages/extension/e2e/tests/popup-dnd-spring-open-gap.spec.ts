import { test, expect, chromium, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedIdb } from '../helpers';
import { RawCdp } from '../rawCdp';

/**
 * Regression (user-reported): "mouse based DnD, cross-group: once inside the new group
 * (after hover-to-spring-open), re-ordering doesn't show anything." The live insertion
 * gap (rows shifted by translate3d, the holding list grown by padding-bottom) must show
 * in the SPRING-OPENED group exactly as it does in the source group, and the drop must
 * land where the gap was shown.
 *
 * Real MV3 toolbar popup, headless, raw CDP (see popup-dnd.spec.ts for why).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = fs.existsSync(path.resolve(__dirname, '../../.output/chrome-mv3-dev'))
  ? path.resolve(__dirname, '../../.output/chrome-mv3-dev')
  : path.resolve(__dirname, '../../.output/chrome-mv3');

const NOW_OPEN = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const tab = (title: string) => ({ id: 0, title, url: `https://example.com/${title.toLowerCase()}` });
const win = (id: number, titles: string[]) => ({ id, incognito: false, focused: false, tabs: titles.map(tab) });

const WORK = { id: 'work', name: 'Work', windows: [win(1, ['Alpha', 'Bravo', 'Charlie'])] };
const PLAY = { id: 'play', name: 'Play', windows: [win(3, ['Foxtrot', 'Golf', 'Hotel', 'India'])] };
const PLAY_TWO_WINDOWS = {
  id: 'play',
  name: 'Play',
  windows: [win(3, ['Foxtrot', 'Golf']), win(4, ['Hotel', 'India'])],
};

type Pt = { x: number; y: number };

async function openPopup(port: number, groups: unknown[]) {
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
  const seedPage: Page = await context.newPage();
  await seedPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
  await seedIdb(seedPage, groups);
  await seedPage.close();
  const host = await context.newPage();
  await host.goto('about:blank');
  await host.bringToFront();
  await sw.evaluate(async () => {
    await chrome.action.openPopup();
  });
  const cdp = await RawCdp.attach(port, '/popup.html');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  return { context, cdp };
}

const move = (cdp: RawCdp, p: Pt) =>
  cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 1 });

async function glide(cdp: RawCdp, a: Pt, b: Pt, steps: number, waitMs = 0) {
  for (let i = 1; i <= steps; i++) {
    await move(cdp, { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
  }
}

/** Dwell on the sidebar row of `name` past SPRING_OPEN_MS (600ms). */
async function pickUpAndSpringOpen(cdp: RawCdp, grip: string, name: string): Promise<{ from: Pt; row: Pt }> {
  await expect
    .poll(() => cdp.evaluate<boolean>(`!![...document.querySelectorAll('span')].find(s => s.textContent === 'Work')`), {
      timeout: 5_000,
    })
    .toBe(true);
  await cdp.evaluate(`[...document.querySelectorAll('span')].find(s => s.textContent === 'Work').click()`);
  await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${grip}').length`), { timeout: 5_000 }).toBeGreaterThan(0);
  const from = await cdp.evaluate<Pt>(
    `(() => { const e = document.querySelector('${grip}'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  const row = await cdp.evaluate<Pt>(
    `(() => {
       const s = [...document.querySelectorAll('span')].find(n => n.textContent === '${name}');
       const el = s.closest('[data-sidebar-group-index]') || s.closest('div');
       const r = el.getBoundingClientRect();
       return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
     })()`,
  );
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 3; i++) await move(cdp, { x: from.x, y: from.y + i * 4 });
  await glide(cdp, { x: from.x, y: from.y + 12 }, row, 8);
  for (let i = 0; i < 15; i++) {
    await move(cdp, { x: row.x + (i % 2 ? 1 : 0), y: row.y });
    await new Promise((r) => setTimeout(r, 80));
  }
  return { from, row };
}

/** What the live preview currently shows. */
const gapProbe = (cdp: RawCdp) =>
  cdp.evaluate<{ shifted: string[]; grown: string[] }>(`(() => {
    const shifted = [...document.querySelectorAll('main [role="listitem"], main [data-window-index]')]
      .filter(e => /translate3d\\(0(px)?, *[1-9]/.test(e.style.transform))
      .map(e => (e.getAttribute('aria-label') || e.getAttribute('data-window-index') || '').split(' ')[0]);
    const grown = [...document.querySelectorAll('[data-tm-dnd-list]')]
      .filter(e => /calc/.test(e.style.paddingBottom))
      .map(e => e.getAttribute('data-tm-dnd-list'));
    return { shifted, grown };
  })()`);

const tabsOf = (cdp: RawCdp, id: string) =>
  cdp.evaluate<string[][]>(
    `new Promise(resolve => {
       const req = indexedDB.open('tabmerger', 1);
       req.onsuccess = () => {
         const tx = req.result.transaction('groups', 'readonly');
         tx.objectStore('groups').get('${id}').onsuccess = (e) => {
           resolve((e.target.result?.windows ?? []).map(w => w.tabs.map(t => t.title)));
         };
       };
     })`,
  );

const rectOf = (cdp: RawCdp, sel: string) =>
  cdp.evaluate<{ x: number; y: number; w: number; h: number }>(
    `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
  );

test.describe('spring-open: the insertion gap shows in the destination group (pointer DnD)', () => {
  // Independent tests (own browser, own debugging port): lets CI shards (--shard=i/N) split them.
  test.describe.configure({ mode: 'parallel' });
  test.setTimeout(90_000);

  test('control: a same-group tab drag shows the gap', async () => {
    const { context, cdp } = await openPopup(9441, [NOW_OPEN, { ...WORK, windows: [win(1, ['Alpha', 'Bravo', 'Charlie', 'Delta'])] }]);
    try {
      await expect
        .poll(() => cdp.evaluate<boolean>(`!![...document.querySelectorAll('span')].find(s => s.textContent === 'Work')`), { timeout: 5_000 })
        .toBe(true);
      await cdp.evaluate(`[...document.querySelectorAll('span')].find(s => s.textContent === 'Work').click()`);
      await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`)).toBe(4);
      const g = await cdp.evaluate<Pt[]>(
        `[...document.querySelectorAll('[aria-label^="Drag to reorder tab"]')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })`,
      );
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g[0].x, y: g[0].y, button: 'none', buttons: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g[0].x, y: g[0].y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 3; i++) await move(cdp, { x: g[0].x, y: g[0].y + i * 4 });
      await glide(cdp, { x: g[0].x, y: g[0].y + 12 }, { x: g[2].x, y: g[2].y }, 8, 30);
      const probe = await gapProbe(cdp);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g[2].x, y: g[2].y, button: 'left', buttons: 0, clickCount: 1 });
      expect(probe.shifted.length).toBeGreaterThan(0);
    } finally {
      cdp.close();
      await context.close();
    }
  });

  test('a TAB dragged into a spring-opened group shows the gap and drops where it is shown', async () => {
    const { context, cdp } = await openPopup(9442, [NOW_OPEN, WORK, PLAY]);
    try {
      const { row } = await pickUpAndSpringOpen(cdp, '[aria-label^="Drag to reorder tab"]', 'Play');
      await expect
        .poll(() => cdp.evaluate<string[]>(`[...document.querySelectorAll('main [role="listitem"]')].map(e => (e.getAttribute('aria-label') || '').split(' ')[0])`), { timeout: 3_000 })
        .toEqual(['Foxtrot', 'Golf', 'Hotel', 'India']);

      // Into the panel, onto Golf's upper half (gap opens between Foxtrot and Golf).
      const golf = await rectOf(cdp, '[role="listitem"][data-tab-index="1"]');
      const target = { x: golf.x + golf.w / 2, y: golf.y + 2 };
      await glide(cdp, row, target, 10, 30);
      await new Promise((r) => setTimeout(r, 300));
      const probe = await gapProbe(cdp);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 });

      expect(probe.grown.length, 'destination list grows by the gap height').toBe(1);
      expect(probe.shifted.length, 'rows at/after the gap are displaced').toBeGreaterThan(0);
      await expect
        .poll(() => tabsOf(cdp, 'play'), { timeout: 5_000 })
        .toEqual([['Foxtrot', 'Alpha', 'Golf', 'Hotel', 'India']]);
    } finally {
      cdp.close();
      await context.close();
    }
  });

  test('a WINDOW dragged into a spring-opened group shows the gap and drops where it is shown', async () => {
    const { context, cdp } = await openPopup(9443, [NOW_OPEN, WORK, PLAY_TWO_WINDOWS]);
    try {
      const { row } = await pickUpAndSpringOpen(cdp, '[aria-label^="Drag to reorder window"]', 'Play');
      await expect
        .poll(() => cdp.evaluate<string[]>(`[...document.querySelectorAll('main [role="listitem"]')].map(e => (e.getAttribute('aria-label') || '').split(' ')[0])`), { timeout: 3_000 })
        .toEqual(['Foxtrot', 'Golf', 'Hotel', 'India']);

      // Onto the SECOND window card's top edge: the gap opens before it.
      const w2 = await rectOf(cdp, '[data-window-index="1"].bg-card');
      const target = { x: w2.x + w2.w / 2, y: w2.y + 4 };
      await glide(cdp, row, target, 10, 30);
      await new Promise((r) => setTimeout(r, 300));
      const probe = await gapProbe(cdp);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 });

      expect(probe.grown.length, 'destination list grows by the gap height').toBe(1);
      expect(probe.shifted.length, 'windows at/after the gap are displaced').toBeGreaterThan(0);
      await expect
        .poll(() => tabsOf(cdp, 'play'), { timeout: 5_000 })
        .toEqual([['Foxtrot', 'Golf'], ['Alpha', 'Bravo', 'Charlie'], ['Hotel', 'India']]);
    } finally {
      cdp.close();
      await context.close();
    }
  });
});
