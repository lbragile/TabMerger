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

/**
 * Regression (user-reported): "dropping a window cross-group after entering it
 * (hover-to-spring-open) causes the drop to not register." Picking up a window,
 * dwelling on another group's SIDEBAR row until spring-open swaps the windows
 * panel to it, then releasing on one of that group's WINDOW rows (not the
 * sidebar row itself) used to silently do nothing: the raw drop target could
 * resolve to a TAB nested inside the destination window rather than the window
 * container, and a window can never legally target a tab — `canDrop` rejected
 * it. Fixed by redirecting such a target to the tab's own window, both in the
 * collision layer and (decisively) in `onDragEnd`'s model-based resolution.
 * See `docs/drag-and-drop-spec.md` C15 and
 * `.claude/agent-memory/extension-dev/learnings_dnd_spring_open_window_drop.md`.
 *
 * Runs its OWN persistent context (not the shared `describe` above) — the
 * toolbar popup can linger open across tests within one context, and a second
 * `chrome.action.openPopup()` can then attach `RawCdp` to the STALE target.
 */
test('spring-open: a WINDOW dropped onto another group\'s window row (after dwelling on its sidebar row) persists the move', async () => {
  test.setTimeout(60_000);
  const SPRING_CDP_PORT = 9430;
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      '--headless=new',
      `--load-extension=${EXT}`,
      `--disable-extensions-except=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${SPRING_CDP_PORT}`,
    ],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const extensionId = new URL(sw.url()).hostname;

    const PLAY = {
      id: 'play',
      name: 'Play',
      windows: [
        {
          id: 3,
          incognito: false,
          focused: false,
          tabs: [
            { id: 0, title: 'Foxtrot', url: 'https://example.com/foxtrot' },
            { id: 0, title: 'Golf', url: 'https://example.com/golf' },
          ],
        },
      ],
    };

    const seedPage: Page = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
    await seedIdb(seedPage, [NOW_OPEN, WORK, PLAY]);
    await seedPage.close();

    const host = await context.newPage();
    await host.goto('about:blank');
    await host.bringToFront();
    await sw.evaluate(async () => {
      await chrome.action.openPopup();
    });

    const cdp = await RawCdp.attach(SPRING_CDP_PORT, '/popup.html');
    try {
      await cdp.send('Runtime.enable');
      await cdp.send('DOM.enable');

      await expect
        .poll(
          () => cdp.evaluate<boolean>(`!![...document.querySelectorAll('span')].find(s => s.textContent === 'Work')`),
          { timeout: 5_000 },
        )
        .toBe(true);
      await cdp.evaluate(`[...document.querySelectorAll('span')].find(s => s.textContent === 'Work').click()`);

      await expect
        .poll(
          () => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder window"]').length`),
          { timeout: 5_000 },
        )
        .toBe(1);

      const windowGrip = await cdp.evaluate<{ x: number; y: number; w: number; h: number }>(
        `(() => { const e = document.querySelector('[aria-label^="Drag to reorder window"]'); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
      );
      const playRow = await cdp.evaluate<{ x: number; y: number; w: number; h: number } | null>(
        `(() => {
           const s = [...document.querySelectorAll('span')].find(n => n.textContent === 'Play');
           const row = s && (s.closest('[data-sidebar-group-index]') || s.closest('div'));
           if (!row) return null;
           const r = row.getBoundingClientRect();
           return { x: r.x, y: r.y, w: r.width, h: r.height };
         })()`,
      );
      expect(playRow).not.toBeNull();

      const from = { x: windowGrip.x + windowGrip.w / 2, y: windowGrip.y + windowGrip.h / 2 };
      const rowTarget = { x: playRow!.x + playRow!.w / 2, y: playRow!.y + playRow!.h / 2 };

      // Press, nudge past the activation threshold, glide onto Play's sidebar row and
      // dwell there past SPRING_OPEN_MS (600ms) so the panel swaps to Play.
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 3; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + i * 4, button: 'left', buttons: 1 });
      }
      const glideSteps = 8;
      for (let i = 1; i <= glideSteps; i++) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(from.x + ((rowTarget.x - from.x) * i) / glideSteps),
          y: Math.round(from.y + ((rowTarget.y - from.y) * i) / glideSteps),
          button: 'left',
          buttons: 1,
        });
      }
      for (let i = 0; i < 15; i++) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: rowTarget.x + (i % 2 ? 1 : 0),
          y: rowTarget.y,
          button: 'left',
          buttons: 1,
        });
        await new Promise((r) => setTimeout(r, 80)); // ~1.2s total > SPRING_OPEN_MS
      }

      await expect
        .poll(
          () =>
            cdp.evaluate<string[]>(
              `[...document.querySelectorAll('main [role="listitem"]')].map(e => (e.getAttribute('aria-label') || '').split(' ')[0])`,
            ),
          { timeout: 3_000 },
        )
        .toEqual(['Foxtrot', 'Golf']); // spring-open swapped the panel to Play

      // Now move OFF the sidebar row and INTO the panel, onto Play's window card,
      // landing over one of its TAB rows — the exact shape of the bug.
      const winCard = await cdp.evaluate<{ x: number; y: number; w: number; h: number }>(
        `(() => { const e = document.querySelector('[data-window-index="0"].bg-card'); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
      );
      const winTarget = { x: winCard.x + winCard.w / 2, y: winCard.y + winCard.h / 2 };
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(rowTarget.x + ((winTarget.x - rowTarget.x) * i) / 8),
          y: Math.round(rowTarget.y + ((winTarget.y - rowTarget.y) * i) / 8),
          button: 'left',
          buttons: 1,
        });
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: winTarget.x, y: winTarget.y, button: 'left', buttons: 0, clickCount: 1 });

      // The move persisted: Play now holds BOTH its original window and the moved one;
      // Work lost the window it started with.
      await expect
        .poll(
          () =>
            cdp.evaluate<string[][]>(
              `new Promise(resolve => {
                 const req = indexedDB.open('tabmerger', 1);
                 req.onsuccess = () => {
                   const tx = req.result.transaction('groups', 'readonly');
                   tx.objectStore('groups').get('play').onsuccess = (e) => {
                     const g = e.target.result;
                     resolve((g?.windows ?? []).map(w => w.tabs.map(t => t.title)));
                   };
                 };
               })`,
            ),
          { timeout: 5_000 },
        )
        .toEqual([['Alpha', 'Bravo', 'Charlie'], ['Foxtrot', 'Golf']]);

      const workAfter = await cdp.evaluate<string[][]>(
        `new Promise(resolve => {
           const req = indexedDB.open('tabmerger', 1);
           req.onsuccess = () => {
             const tx = req.result.transaction('groups', 'readonly');
             tx.objectStore('groups').get('work').onsuccess = (e) => {
               const g = e.target.result;
               resolve((g?.windows ?? []).map(w => w.tabs.map(t => t.title)));
             };
           };
         })`,
      );
      expect(workAfter).toEqual([]);
    } finally {
      cdp.close();
    }
  } finally {
    await context.close();
  }
});
