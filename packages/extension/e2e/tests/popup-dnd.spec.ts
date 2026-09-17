import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedIdb } from '../helpers';
import { RawCdp } from '../rawCdp';

/**
 * Regression: drag-and-drop must actually START and PERSIST inside the REAL MV3
 * toolbar action popup — not merely when popup.html is opened as a browser tab.
 *
 * Root cause of the original failure: `useDndSensors` used `PointerSensor` with a
 * `{ distance: 5 }` activation constraint. The action popup is a borderless
 * always-on-top widget with no implicit pointer capture, and Chrome coalesces /
 * drops its `pointermove` samples after `pointerdown`, so the 5px threshold was
 * never crossed and the drag never activated ("it doesn't even drag"). The exact
 * same build worked in a tab because a tab gets the full pointer stream. Fix:
 * switch to `MouseSensor` (+ `TouchSensor`), which key off `mousedown`/`mousemove`.
 *
 * Playwright cannot attach a `Page` to the action-popup target (tried
 * `context.pages()`, `waitForEvent('page')`, `connectOverCDP` — none surface it),
 * so this spec launches its own persistent context with `--remote-debugging-port`,
 * opens the genuine popup via `chrome.action.openPopup()`, then drives it over raw
 * CDP against the popup's own per-page debugger endpoint. Stays fully headless
 * (`--headless=new`), matching `e2e/fixtures.ts`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = fs.existsSync(path.resolve(__dirname, '../../.output/chrome-mv3-dev'))
  ? path.resolve(__dirname, '../../.output/chrome-mv3-dev')
  : path.resolve(__dirname, '../../.output/chrome-mv3');
const CDP_PORT = 9411;

const NOW_OPEN = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const WORK = {
  id: 'work',
  name: 'Work',
  windows: [
    {
      id: 1,
      incognito: false,
      focused: false,
      tabs: [
        { id: 0, title: 'Alpha', url: 'https://example.com/alpha' },
        { id: 0, title: 'Bravo', url: 'https://example.com/bravo' },
        { id: 0, title: 'Charlie', url: 'https://example.com/charlie' },
      ],
    },
  ],
};

test.describe('DnD inside the real MV3 action popup', () => {
  let context: BrowserContext;
  let extensionId: string;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        '--headless=new',
        `--load-extension=${EXT}`,
        `--disable-extensions-except=${EXT}`,
        '--no-first-run',
        '--no-default-browser-check',
        `--remote-debugging-port=${CDP_PORT}`,
      ],
    });
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    extensionId = new URL(sw.url()).hostname;
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('a tab drag starts (cursor + overlay) and the reorder persists to IndexedDB', async () => {
    // Seed the shared-origin IndexedDB via popup.html-as-a-tab (Playwright CAN drive that).
    const seedPage: Page = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
    await seedIdb(seedPage, [NOW_OPEN, WORK]);
    await seedPage.close();

    // A focused normal window is required for chrome.action.openPopup() to have a target.
    const host = await context.newPage();
    await host.goto('about:blank');
    await host.bringToFront();
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await sw.evaluate(async () => {
      await chrome.action.openPopup();
    });

    const cdp = await RawCdp.attach(CDP_PORT, '/popup.html');
    try {
      await cdp.send('Runtime.enable');
      await cdp.send('DOM.enable');

      // Open the "Work" group (the sidebar row's name <span>; the click bubbles to
      // the row's onWrapperClick handler).
      await expect
        .poll(
          () =>
            cdp.evaluate<boolean>(
              `!![...document.querySelectorAll('span')].find(s => s.textContent === 'Work')`,
            ),
          { timeout: 5_000 },
        )
        .toBe(true);
      await cdp.evaluate(
        `[...document.querySelectorAll('span')].find(s => s.textContent === 'Work').click()`,
      );

      // Measure the 1st and 3rd tab drag handles.
      await expect
        .poll(
          () =>
            cdp.evaluate<number>(
              `document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`,
            ),
          { timeout: 5_000 },
        )
        .toBe(3);
      const rects = await cdp.evaluate<{ x: number; y: number; w: number; h: number }[]>(
        `[...document.querySelectorAll('[aria-label^="Drag to reorder tab"]')].map(e => {
           const r = e.getBoundingClientRect();
           return { x: r.x, y: r.y, w: r.width, h: r.height };
         })`,
      );
      const from = { x: rects[0].x + rects[0].w / 2, y: rects[0].y + rects[0].h / 2 };
      const to = { x: rects[2].x + rects[2].w / 2, y: rects[2].y + rects[2].h - 2 };

      await cdp.drag(from, to, async () => {
        // The drag activated ONLY if the sensor fired: onDragStart forces
        // document.body.style.cursor='grabbing' and dnd-kit mounts the overlay
        // card, which duplicates the dragged tab's title in the DOM.
        await expect
          .poll(() => cdp.evaluate<string>(`document.body.style.cursor`), { timeout: 1_500 })
          .toBe('grabbing');
        const alphaSpans = await cdp.evaluate<number>(
          `[...document.querySelectorAll('span')].filter(s => s.textContent === 'Alpha').length`,
        );
        expect(alphaSpans).toBeGreaterThan(1); // original row + DragOverlay ghost
      });

      // The reorder persisted to the IndexedDB every context shares.
      await expect
        .poll(
          () =>
            cdp.evaluate<string[]>(
              `new Promise(resolve => {
                 const req = indexedDB.open('tabmerger', 1);
                 req.onsuccess = () => {
                   const tx = req.result.transaction('groups', 'readonly');
                   tx.objectStore('groups').get('work').onsuccess = (e) => {
                     const g = e.target.result;
                     resolve((g?.windows?.[0]?.tabs ?? []).map(t => t.title));
                   };
                 };
               })`,
            ),
          { timeout: 5_000 },
        )
        .toEqual(['Bravo', 'Charlie', 'Alpha']);
    } finally {
      cdp.close();
    }
  });
});
