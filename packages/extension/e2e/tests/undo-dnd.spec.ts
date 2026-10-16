import { test, expect, chromium, type Page } from '@playwright/test';
import { dismissTour, seedIdb } from '../helpers';
import { EXTENSION_PATH } from '../extensionPath';
import { RawCdp } from '../rawCdp';

/**
 * Regression (user-reported): a cross-group drag of a tab into another group's "new window"
 * drop zone left no undo step: after the drop, Undo was unavailable (or undid something
 * older). Every mutating action must leave exactly one undo step, and one Undo must revert
 * the whole drop (both groups and the created window); Redo re-applies it.
 *
 * Real MV3 toolbar popup, headless, raw CDP (see popup-dnd.spec.ts for why).
 */

const EXT = EXTENSION_PATH;

const NOW_OPEN = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const tab = (title: string) => ({ id: 0, title, url: `https://example.com/${title.toLowerCase()}` });
const win = (id: number, titles: string[]) => ({ id, incognito: false, focused: false, tabs: titles.map(tab) });
const WORK = { id: 'work', name: 'Work', windows: [win(1, ['Alpha', 'Bravo', 'Charlie'])] };
const PLAY = { id: 'play', name: 'Play', windows: [win(3, ['Foxtrot', 'Golf'])] };

type Pt = { x: number; y: number };

async function openPopup(port: number, groups: Parameters<typeof seedIdb>[1], opts: { busyTab?: boolean; secondPage?: boolean } = {}) {
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
  await dismissTour(context);
  const seedPage: Page = await context.newPage();
  await seedPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
  await seedIdb(seedPage, groups);
  await seedPage.close();
  if (opts.busyTab) {
    // a live tab whose title keeps changing: chrome.tabs.onUpdated fires all through the drag, so
    // Now Open is rewritten while it runs (what a real browser with loading pages does)
    const busy = await context.newPage();
    await busy.goto('data:text/html,<title>busy</title><script>let n=0;setInterval(()=>{document.title="busy "+(n++)},300)</script>');
  }
  if (opts.secondPage) {
    // popup.html open in a tab too: a second TabMerger page, whose Now Open mirror writes (and
    // broadcasts) on every tab event
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
  }
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

const centerOf = (cdp: RawCdp, sel: string) =>
  cdp.evaluate<Pt>(
    `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );

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

const buttonEnabled = (cdp: RawCdp, label: string) =>
  cdp.evaluate<boolean>(`(() => { const b = document.querySelector('button[aria-label="${label}"]'); return !!b && !b.disabled; })()`);

const clickButton = (cdp: RawCdp, label: string) => cdp.evaluate(`document.querySelector('button[aria-label="${label}"]').click()`);

test.describe('undo / redo of a drag and drop (real popup)', () => {
  test.describe.configure({ mode: 'parallel' });
  test.setTimeout(90_000);

  /**
   * Picks up the first tab of Work (after Ctrl+clicking `select` rows), dwells on Play's sidebar
   * row until the panel springs open to Play, then releases on Play's "new window" zone.
   */
  async function dragWorkTabToPlayNewWindow(cdp: RawCdp, select: number[] = []) {
    await expect
      .poll(() => cdp.evaluate<boolean>(`!![...document.querySelectorAll('span')].find(s => s.textContent === 'Work')`), { timeout: 5_000 })
      .toBe(true);
    await cdp.evaluate(`[...document.querySelectorAll('span')].find(s => s.textContent === 'Work').click()`);
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBe(3);
    expect(await buttonEnabled(cdp, 'Undo')).toBe(false);
    for (const i of select) {
      await cdp.evaluate(
        `document.querySelector('[role="listitem"][data-tab-index="${i}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))`,
      );
    }
    if (select.length > 0) {
      await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[role="checkbox"][aria-checked="true"]').length`), { timeout: 3_000 }).toBe(select.length);
    }

    const from = await centerOf(cdp, '[aria-label^="Drag to reorder tab"]');
    const row = await cdp.evaluate<Pt>(
      `(() => {
         const s = [...document.querySelectorAll('span')].find(n => n.textContent === 'Play');
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
    await expect
      .poll(() => cdp.evaluate<string[]>(`[...document.querySelectorAll('main [role="listitem"]')].map(e => (e.getAttribute('aria-label') || '').split(' ')[0])`), { timeout: 3_000 })
      .toEqual(['Foxtrot', 'Golf']);

    const zone = await centerOf(cdp, '[data-testid="new-window-dropzone"]');
    await glide(cdp, row, zone, 10, 30);
    await new Promise((r) => setTimeout(r, 300));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: zone.x, y: zone.y, button: 'left', buttons: 0, clickCount: 1 });
  }

  /** One undo step; one Undo reverts the whole drop (both groups, the new window gone); Redo re-applies. */
  async function expectOneStepUndoRedo(cdp: RawCdp, after: { work: string[][]; play: string[][] }) {
    const before = { work: [['Alpha', 'Bravo', 'Charlie']], play: [['Foxtrot', 'Golf']] };
    await expect.poll(() => tabsOf(cdp, 'play'), { timeout: 5_000 }).toEqual(after.play);
    expect(await tabsOf(cdp, 'work')).toEqual(after.work);

    await expect.poll(() => buttonEnabled(cdp, 'Undo'), { timeout: 3_000 }).toBe(true);
    await clickButton(cdp, 'Undo');
    await expect.poll(() => tabsOf(cdp, 'play'), { timeout: 5_000 }).toEqual(before.play);
    expect(await tabsOf(cdp, 'work')).toEqual(before.work);
    await expect.poll(() => buttonEnabled(cdp, 'Undo'), { timeout: 3_000 }).toBe(false);

    await expect.poll(() => buttonEnabled(cdp, 'Redo'), { timeout: 3_000 }).toBe(true);
    await clickButton(cdp, 'Redo');
    await expect.poll(() => tabsOf(cdp, 'play'), { timeout: 5_000 }).toEqual(after.play);
    expect(await tabsOf(cdp, 'work')).toEqual(after.work);
    await expect.poll(() => buttonEnabled(cdp, 'Undo'), { timeout: 3_000 }).toBe(true);
    await expect.poll(() => buttonEnabled(cdp, 'Redo'), { timeout: 3_000 }).toBe(false);
  }

  /**
   * Picks up the first tab of Work and releases it ON Play's sidebar row: right away (`dwell`
   * false: no spring-open), or after dwelling until the panel sprang open to Play.
   */
  async function dragWorkTabOntoPlayRow(cdp: RawCdp, dwell: boolean, target = 'Play') {
    await expect
      .poll(() => cdp.evaluate<boolean>(`!![...document.querySelectorAll('span')].find(s => s.textContent === 'Work')`), { timeout: 5_000 })
      .toBe(true);
    await cdp.evaluate(`[...document.querySelectorAll('span')].find(s => s.textContent === 'Work').click()`);
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBe(3);
    expect(await buttonEnabled(cdp, 'Undo')).toBe(false);
    const from = await centerOf(cdp, '[aria-label^="Drag to reorder tab"]');
    const row = await cdp.evaluate<Pt>(
      `(() => {
         const s = [...document.querySelectorAll('aside span, span')].find(n => n.textContent === '${target}');
         const el = s.closest('[data-sidebar-group-index]') || s.closest('div');
         const r = el.getBoundingClientRect();
         return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
       })()`,
    );
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 3; i++) await move(cdp, { x: from.x, y: from.y + i * 4 });
    await glide(cdp, { x: from.x, y: from.y + 12 }, row, 8, 20);
    const dwellMoves = dwell ? 15 : 3;
    for (let i = 0; i < dwellMoves; i++) {
      await move(cdp, { x: row.x + (i % 2 ? 1 : 0), y: row.y });
      await new Promise((r) => setTimeout(r, dwell ? 80 : 30));
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: row.x, y: row.y, button: 'left', buttons: 0, clickCount: 1 });
  }

  for (const [dwell, busyTab, port] of [[false, false, 9453], [true, false, 9454], [false, true, 9455], [true, true, 9456]] as const) {
    test(`a tab dropped ON another group's sidebar row (${dwell ? 'after spring-open' : 'no spring-open'}${busyTab ? ', Now Open changing during the drag' : ''}) is one undo step`, async () => {
      const { context, cdp } = await openPopup(port, [NOW_OPEN, WORK, PLAY], { busyTab });
      try {
        await dragWorkTabOntoPlayRow(cdp, dwell);
        await expectOneStepUndoRedo(cdp, { work: [['Bravo', 'Charlie']], play: [['Foxtrot', 'Golf'], ['Alpha']] });
      } finally {
        cdp.close();
        await context.close();
      }
    });
  }

  test('with popup.html also open in a tab and live tabs changing, the drop keeps its undo step (a Now Open-only write elsewhere is no clear)', async () => {
    const { context, cdp } = await openPopup(9458, [NOW_OPEN, WORK, PLAY], { busyTab: true, secondPage: true });
    try {
      await dragWorkTabOntoPlayRow(cdp, false);
      // the other page keeps rewriting Now Open (the busy tab) and broadcasting it
      await new Promise((r) => setTimeout(r, 1_000));
      await expectOneStepUndoRedo(cdp, { work: [['Bravo', 'Charlie']], play: [['Foxtrot', 'Golf'], ['Alpha']] });
    } finally {
      cdp.close();
      await context.close();
    }
  });

  test('a saved tab dropped ON the Now Open sidebar row (a new real window opens) is one undo step; Undo closes that window again', async () => {
    const { context, cdp } = await openPopup(9457, [NOW_OPEN, WORK, PLAY]);
    try {
      const pagesBefore = context.pages().length;
      await dragWorkTabOntoPlayRow(cdp, false, 'Now Open');
      await expect.poll(() => tabsOf(cdp, 'work'), { timeout: 5_000 }).toEqual([['Bravo', 'Charlie']]);
      await expect.poll(() => context.pages().some((p) => p.url().includes('example.com/alpha')), { timeout: 5_000 }).toBe(true);
      await expect.poll(() => buttonEnabled(cdp, 'Undo'), { timeout: 3_000 }).toBe(true);
      await clickButton(cdp, 'Undo');
      await expect.poll(() => tabsOf(cdp, 'work'), { timeout: 5_000 }).toEqual([['Alpha', 'Bravo', 'Charlie']]);
      await expect.poll(() => context.pages().some((p) => p.url().includes('example.com/alpha')), { timeout: 5_000 }).toBe(false);
      expect(context.pages().length).toBeGreaterThanOrEqual(pagesBefore - 1);
      await expect.poll(() => buttonEnabled(cdp, 'Redo'), { timeout: 3_000 }).toBe(true);
    } finally {
      cdp.close();
      await context.close();
    }
  });

  test("a tab dragged into another group's new-window zone is one undo step; Undo restores it, Redo re-applies it", async () => {
    const { context, cdp } = await openPopup(9451, [NOW_OPEN, WORK, PLAY]);
    try {
      await dragWorkTabToPlayNewWindow(cdp);
      await expectOneStepUndoRedo(cdp, { work: [['Bravo', 'Charlie']], play: [['Foxtrot', 'Golf'], ['Alpha']] });
    } finally {
      cdp.close();
      await context.close();
    }
  });

  test("two selected tabs dragged into another group's new-window zone are one undo step", async () => {
    const { context, cdp } = await openPopup(9452, [NOW_OPEN, WORK, PLAY]);
    try {
      await dragWorkTabToPlayNewWindow(cdp, [0, 1]);
      await expectOneStepUndoRedo(cdp, { work: [['Charlie']], play: [['Foxtrot', 'Golf'], ['Alpha', 'Bravo']] });
    } finally {
      cdp.close();
      await context.close();
    }
  });
});
