/**
 * popupRealDnd.repro.ts — drive drags against the REAL MV3 toolbar action popup
 * over raw CDP (Playwright can't attach a Page to that target) and read the
 * popup's own `[tm-dnd]` instrumentation back.
 *
 * This is the ONLY harness that exercises the failure the user sees: the tab
 * context (even paced) does NOT reproduce "the native drag aborts ~immediately
 * in the toolbar popup". `Input.dispatchMouseEvent` press → paced moves →
 * release on a `draggable` element DOES reproduce it (and now verifies the fix).
 *
 * PASS per drag type = the real popup console shows
 *   html5:dragstart → onDragStart → html5:drop → onDragEnd → committed
 * AND the seeded group's structure actually changed in IndexedDB.
 *
 * Run: pnpm --filter @tabmerger/extension exec playwright test --config e2e/repro/playwright.repro.config.ts popupRealDnd
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedIdb } from '../helpers';
import { RawCdp } from '../rawCdp';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = fs.existsSync(path.resolve(here, '../../.output/chrome-mv3-dev'))
  ? path.resolve(here, '../../.output/chrome-mv3-dev')
  : path.resolve(here, '../../.output/chrome-mv3');

const NOW_OPEN = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const tab = (t: string) => ({ id: 0, title: t, url: `https://example.com/${t.toLowerCase()}` });
const WORK = {
  id: 'work',
  name: 'Work',
  windows: [
    { id: 1, incognito: false, focused: false, tabs: [tab('Alpha'), tab('Bravo'), tab('Charlie')] },
    { id: 2, incognito: false, focused: false, tabs: [tab('Delta'), tab('Echo')] }
  ]
};
const PLAY = {
  id: 'play',
  name: 'Play',
  windows: [{ id: 3, incognito: false, focused: false, tabs: [tab('Foxtrot')] }]
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readLog(cdp: RawCdp): Promise<[number, string, unknown][]> {
  return JSON.parse((await cdp.evaluate<string>(`JSON.stringify(globalThis.__tmDndLog ?? [])`)) || '[]');
}
function printLog(tag: string, log: [number, string, unknown][]) {
  console.log(`\n[repro] ${tag} — ${log.length} [tm-dnd] entries:`);
  const t0 = log[0]?.[0] ?? 0;
  for (const [t, s, d] of log) console.log(`   +${String(t - t0).padStart(4)}ms  ${s}  ${JSON.stringify(d)}`);
}
function stageNames(log: [number, string, unknown][]): string[] {
  return log.map(([, s]) => s);
}

/**
 * `hostUrl` — URL of the focused tab the popup anchors to (default `about:blank`).
 * `extraTabUrls` — more real browser tabs opened (same window) BEFORE the popup, so
 * they show up in the live "Now Open" group.
 * `extraWindowUrls` — one extra UNFOCUSED real browser window per URL (the Window
 * drag grip only renders when a group has >1 window).
 */
async function launch(
  opts: {
    hostUrl?: string;
    extraTabUrls?: string[];
    extraWindowUrls?: string[];
    /** seed groups (default: Now Open, Work, Play) */
    groups?: Parameters<typeof seedIdb>[1];
    /**
     * Pin the sensor's dual path (`tm_dnd_force_path`). Defaults to `'native'`:
     * every test in this file predates the pointer path and was written against the
     * native HTML5 drag, and whether a drag activates the pointer path depends on how
     * many `pointermove`s the harness happens to deliver under Chrome's ~4px native
     * drag threshold — i.e. on each helper's nudge step size. Pinning here keeps a
     * step-size tweak in one helper from silently re-routing unrelated tests.
     * Pass `null` to let the sensor decide from the real evidence.
     */
    forcePath?: 'native' | 'pointer' | null;
  } = {}
): Promise<{ context: BrowserContext; cdp: RawCdp; port: number }> {
  const port = 9412 + Math.floor(Math.random() * 400);
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      '--headless=new',
      `--load-extension=${EXT}`,
      `--disable-extensions-except=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`
    ]
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(sw.url()).hostname;

  const seedPage = await context.newPage();
  await seedPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
  await seedPage.waitForTimeout(1500);
  await seedIdb(seedPage, opts.groups ?? [NOW_OPEN, WORK, PLAY]);
  await seedPage.evaluate(() => localStorage.setItem('tm_dnd_debug', '1'));
  const forcePath = opts.forcePath === undefined ? 'native' : opts.forcePath;
  await seedPage.evaluate((p) => {
    if (p) localStorage.setItem('tm_dnd_force_path', p);
    else localStorage.removeItem('tm_dnd_force_path');
  }, forcePath);
  await seedPage.close();

  for (const url of opts.extraTabUrls ?? []) {
    const p = await context.newPage();
    await p.goto(url);
  }
  for (const url of opts.extraWindowUrls ?? []) {
    const [bgSw] = context.serviceWorkers();
    await bgSw.evaluate(async (u) => {
      await chrome.windows.create({ url: u, focused: false });
    }, url);
    await sleep(500);
  }
  const host = await context.newPage();
  await host.goto(opts.hostUrl ?? 'about:blank');
  await host.bringToFront();
  [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(async () => {
    await chrome.action.openPopup();
  });

  const cdp = await RawCdp.attach(port, '/popup.html');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await expect
    .poll(() => cdp.evaluate<number>(`document.getElementById('root')?.childElementCount ?? 0`), { timeout: 8_000 })
    .toBeGreaterThan(0);
  return { context, cdp, port };
}

async function selectGroup(cdp: RawCdp, name: string) {
  await expect
    .poll(() => cdp.evaluate<boolean>(`!![...document.querySelectorAll('span')].find(s => s.textContent === ${JSON.stringify(name)})`), {
      timeout: 5_000
    })
    .toBe(true);
  await cdp.evaluate(`[...document.querySelectorAll('span')].find(s => s.textContent === ${JSON.stringify(name)}).click()`);
  await sleep(400);
}

/** Measure the nth element matching `selector` (center-x, near-bottom-y). */
async function box(cdp: RawCdp, selector: string, n: number) {
  const rects = await cdp.evaluate<{ x: number; y: number; w: number; h: number }[]>(
    `[...document.querySelectorAll(${JSON.stringify(selector)})].map(e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height }; })`
  );
  return rects[n];
}

/** Synthetic mouse: press on `from`, paced moves to `to`, optional mid-drag hook, release. */
async function drive(
  cdp: RawCdp,
  from: { x: number; y: number },
  to: { x: number; y: number },
  onMid?: () => Promise<void>
) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 3; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + i * 4, button: 'left', buttons: 1 });
    await sleep(40);
  }
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      button: 'left',
      buttons: 1
    });
    await sleep(60);
    if (i === 5 && onMid) await onMid();
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(700);
}

/**
 * Press on `from`, then `stepMs`-spaced tiny mouseMoved samples along the path to
 * `to` over ~`durationMs`, then release. Used to measure native drag-event rate.
 */
async function driveSlow(
  cdp: RawCdp,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs = 1000,
  stepMs = 20,
  onSample?: (i: number, n: number) => Promise<void>
) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  // small nudge to start the native drag
  for (let i = 1; i <= 3; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + i, y: from.y + i * 3, button: 'left', buttons: 1 });
    await sleep(30);
  }
  const n = Math.max(1, Math.round(durationMs / stepMs));
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + (to.x - from.x) * f),
      y: Math.round(from.y + (to.y - from.y) * f),
      button: 'left',
      buttons: 1
    });
    await sleep(stepMs);
    if (onSample) await onSample(i, n);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
}

async function rowBoxByText(cdp: RawCdp, text: string) {
  return cdp.evaluate<{ x: number; y: number; w: number; h: number } | null>(
    `(() => {
       const s = [...document.querySelectorAll('span')].find(n => n.textContent === ${JSON.stringify(text)});
       const row = s && (s.closest('[data-sidebar-group-index]') || s.closest('div'));
       if (!row) return null;
       const r = row.getBoundingClientRect();
       return { x: r.x, y: r.y, w: r.width, h: r.height };
     })()`
  );
}

async function idbGroup(cdp: RawCdp, id: string) {
  return cdp.evaluate<{ windows: { tabs: string[] }[] }>(
    `new Promise(resolve => {
       const req = indexedDB.open('tabmerger', 1);
       req.onsuccess = () => {
         const tx = req.result.transaction('groups', 'readonly');
         tx.objectStore('groups').get(${JSON.stringify(id)}).onsuccess = (e) => {
           const g = e.target.result;
           resolve({ windows: (g?.windows ?? []).map(w => ({ tabs: w.tabs.map(t => t.title) })) });
         };
       };
     })`
  );
}
async function groupOrder(cdp: RawCdp) {
  // The authoritative sidebar order lives in groupsState.state.order (see localDb).
  return cdp.evaluate<string[]>(
    `new Promise(resolve => {
       const req = indexedDB.open('tabmerger', 1);
       req.onsuccess = () => {
         const tx = req.result.transaction('groupsState', 'readonly');
         tx.objectStore('groupsState').get('state').onsuccess = (e) =>
           resolve(e.target.result?.order ?? []);
       };
     })`
  );
}

test('real popup — MEASURE native drag-event rate (dragover / drag)', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0);

    await cdp.evaluate(`
      globalThis.__ev = [];
      globalThis.__ghost = [];
      const rec = (type) => (e) => globalThis.__ev.push([type, performance.now(), e.clientX, e.clientY]);
      document.addEventListener('dragover', rec('dragover'), true);
      document.addEventListener('drag', rec('drag'), true);
      // sample the ghost's transform every animation frame
      (function loop() {
        const g = document.querySelector('[data-testid="drag-ghost"]');
        if (g) {
          const m = /translate3d\\(([-0-9.]+)px,\\s*([-0-9.]+)px/.exec(g.style.transform || '');
          globalThis.__ghost.push([performance.now(), m ? +m[1] : null, m ? +m[2] : null]);
        }
        globalThis.__ghostRaf = requestAnimationFrame(loop);
      })();
    `);

    // ~1s drag straight down the tab list
    await driveSlow(
      cdp,
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + 260) },
      1000,
      20
    );

    const ghostDuringExists = await cdp.evaluate<number>(`(globalThis.__ghost||[]).length`);
    const ghostAfter = await cdp.evaluate<number>(`document.querySelectorAll('[data-testid="drag-ghost"]').length`);
    await cdp.evaluate(`cancelAnimationFrame(globalThis.__ghostRaf)`);
    const ghost = await cdp.evaluate<[number, number | null, number | null][]>(`JSON.stringify(globalThis.__ghost)`).then((s) => JSON.parse(s as unknown as string));
    const gPts = ghost.filter((g) => g[1] != null);
    const uniqY = new Set(gPts.map((g) => g[2])).size;
    console.log(`[ghost] samples=${ghostDuringExists} withTransform=${gPts.length} distinctY=${uniqY} removedAfterDrag=${ghostAfter === 0}`);
    if (gPts.length) {
      console.log(`[ghost] first=${JSON.stringify(gPts[0])} mid=${JSON.stringify(gPts[Math.floor(gPts.length / 2)])} last=${JSON.stringify(gPts[gPts.length - 1])}`);
    }
    expect(ghostAfter).toBe(0); // removed after the drag
    expect(gPts.length).toBeGreaterThan(3); // ghost mounted + positioned during the drag
    expect(uniqY).toBeGreaterThan(3); // it MOVES, not stuck at origin

    const ev = await cdp.evaluate<[string, number, number, number][]>(`JSON.stringify(globalThis.__ev)`).then((s) => JSON.parse(s as unknown as string));

    // ghost must track the cursor within a small delta near the end of the drag
    const lastDrag = ev.filter((e) => e[0] === 'drag' || e[0] === 'dragover').slice(-1)[0];
    const lastGhost = gPts.slice(-1)[0];
    if (lastDrag && lastGhost && lastGhost[2] != null) {
      const dy = Math.abs(lastDrag[3] - (lastGhost[2] + 10)); // +offset used by the sensor
      console.log(`[ghost] last cursor y=${lastDrag[3]}  last ghost y=${lastGhost[2]}  |Δ|≈${dy}px`);
      expect(dy).toBeLessThan(60);
    }
    const byType = (t: string) => ev.filter((e) => e[0] === t);
    for (const t of ['dragover', 'drag']) {
      const rows = byType(t);
      if (rows.length < 2) {
        console.log(`[rate] ${t}: ${rows.length} events (cannot compute)`);
        continue;
      }
      const span = rows[rows.length - 1][1] - rows[0][1];
      const hz = ((rows.length - 1) / span) * 1000;
      const gaps = rows.slice(1).map((r, i) => Math.round(r[1] - rows[i][1]));
      const dCoords = rows.slice(1).map((r, i) => Math.abs(r[2] - rows[i][2]) + Math.abs(r[3] - rows[i][3]));
      console.log(`[rate] ${t}: ${rows.length} events over ${Math.round(span)}ms  ≈ ${hz.toFixed(1)} Hz`);
      console.log(`[rate] ${t} gaps(ms): ${JSON.stringify(gaps.slice(0, 40))}`);
      console.log(`[rate] ${t} per-event |Δcoord| px: ${JSON.stringify(dCoords.slice(0, 40))}`);
      console.log(`[rate] ${t} first coords: ${JSON.stringify(rows.slice(0, 3).map((r) => [r[2], r[3]]))}  last: ${JSON.stringify(rows.slice(-3).map((r) => [r[2], r[3]]))}`);
    }
    expect(ev.length).toBeGreaterThan(0);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

interface GhostInfo {
  exists: boolean;
  rect: { x: number; y: number; width: number; height: number } | null;
  cs: Record<string, string> | null;
  text: string | null;
  html: string | null;
}

/**
 * `cs` fields are split across two elements: `opacity`/`boxShadow`/`position`/
 * `zIndex`/`transform` come from the GHOST WRAPPER (the positioning box the
 * sensor owns) — but `backgroundColor`/`color`/`border*` now come from the
 * WRAPPER'S FIRST CHILD, the cloned row itself. This is the fidelity fix: the
 * wrapper is deliberately unstyled beyond a drop shadow + slight opacity, and
 * a real background/border only shows up here if the SOURCE row actually has
 * one (e.g. a window's `bg-card`, or an active group's colored `borderLeft`) —
 * matching the real item instead of a synthesized card.
 */
async function ghostInfo(cdp: RawCdp): Promise<GhostInfo> {
  return cdp.evaluate<GhostInfo>(`(() => {
    const g = document.querySelector('[data-testid="drag-ghost"]');
    if (!g) return { exists: false, rect: null, cs: null, text: null, html: null };
    const r = g.getBoundingClientRect();
    const wrapperCs = getComputedStyle(g);
    const inner = g.firstElementChild;
    const innerCs = inner ? getComputedStyle(inner) : null;
    return {
      exists: true,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      cs: {
        display: wrapperCs.display, visibility: wrapperCs.visibility, opacity: wrapperCs.opacity,
        backgroundColor: innerCs ? innerCs.backgroundColor : '',
        color: innerCs ? innerCs.color : '',
        borderStyle: innerCs ? innerCs.borderStyle : '',
        borderColor: innerCs ? innerCs.borderColor : '',
        borderLeftColor: innerCs ? innerCs.borderLeftColor : '',
        borderLeftWidth: innerCs ? innerCs.borderLeftWidth : '',
        borderWidth: innerCs ? innerCs.borderWidth : '',
        zIndex: wrapperCs.zIndex, position: wrapperCs.position, transform: wrapperCs.transform,
        boxShadow: wrapperCs.boxShadow
      },
      text: g.textContent,
      html: g.outerHTML.slice(0, 400)
    };
  })()`);
}

async function saveShot(cdp: RawCdp, name: string): Promise<string> {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const outDir = path.resolve(here, '../test-results/repro');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, Buffer.from(shot.data as string, 'base64'));
  console.log('[screenshot] saved to', outPath);
  return outPath;
}

/**
 * Press on grip `idx`, nudge down `steps` times (`stepMs` apart) WITHOUT ever
 * moving far enough to cross into another row, snapshot, then release back at
 * (approximately) the pickup point. Deliberately does NOT commit a reorder —
 * each call in a sequence must see the SAME tab order the caller expects, so a
 * "drag tab #1, then tab #2" content-correctness check isn't confused by the
 * first drag silently relocating a tab.
 */
async function dragAndShoot(
  cdp: RawCdp,
  gripIdx: number,
  steps: number,
  stepMs: number,
  shotName: string
): Promise<{ info: GhostInfo; label: string; sourceVisibilityDuring: string; sourceVisibilityAfter: string }> {
  const g = await box(cdp, '[aria-label^="Drag to reorder tab"]', gripIdx);
  const label = (await cdp.evaluate<string | null>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]')[${gripIdx}]?.closest('[role="listitem"]')?.getAttribute('aria-label') ?? null`)) ?? '';
  // The dragged row's content sibling (not the grip) — used to confirm the
  // source is fully HIDDEN (not just dimmed) behind the ghost during the drag,
  // then restored after. `.grid` is the title/URL two-column div in `Tab.tsx`.
  const rowContentSelector = `document.querySelectorAll('[aria-label^="Drag to reorder tab"]')[${gripIdx}]?.closest('[role="listitem"]')?.querySelector('.grid')`;
  const cx = Math.round(g.x + g.w / 2);
  const cy = Math.round(g.y + g.h / 2);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
  let lastY = cy;
  for (let i = 1; i <= steps; i++) {
    // small back-and-forth within the same row's height — enough to keep the
    // native drag alive and move the ghost, never enough to cross a row boundary.
    lastY = cy + (i % 2 === 0 ? 6 : -6);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i, y: lastY, button: 'left', buttons: 1 });
    await sleep(stepMs);
  }
  const info = await ghostInfo(cdp);
  const sourceVisibilityDuring = (await cdp.evaluate<string>(`getComputedStyle(${rowContentSelector}).visibility`)) ?? '';
  await saveShot(cdp, shotName);
  // release back at the exact pickup point — same-slot drop, no reorder.
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
  const sourceVisibilityAfter = (await cdp.evaluate<string>(`getComputedStyle(${rowContentSelector}).visibility`)) ?? '';
  return { info, label, sourceVisibilityDuring, sourceVisibilityAfter };
}

/**
 * Same idea as `dragAndShoot` but for any grip selector (window/group), so the
 * ghost-fidelity screenshots can cover all three drag kinds, not just tabs.
 */
async function dragGripAndShoot(
  cdp: RawCdp,
  selector: string,
  gripIdx: number,
  steps: number,
  stepMs: number,
  shotName: string
): Promise<{ info: GhostInfo }> {
  const g = await box(cdp, selector, gripIdx);
  const cx = Math.round(g.x + g.w / 2);
  const cy = Math.round(g.y + g.h / 2);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
  let lastY = cy;
  for (let i = 1; i <= steps; i++) {
    lastY = cy + (i % 2 === 0 ? 6 : -6);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i, y: lastY, button: 'left', buttons: 1 });
    await sleep(stepMs);
  }
  const info = await ghostInfo(cdp);
  await saveShot(cdp, shotName);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
  return { info };
}

test('real popup — SCREENSHOT the ghost card: first frame, mid-drag, a second tab, and light mode', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);

    // (4) FIRST FRAME — screenshot as early as possible after dragstart, to catch
    // any flash of an unstyled wrapper before the fix's inline styles apply. The
    // wrapper's styles are all set synchronously in one `Object.assign` in the
    // SAME task as element creation, so there should be no observable
    // "unstyled then styled" frame — verify that empirically.
    //
    // NOTE: the ghost is now a FAITHFUL CLONE of the real row (fidelity fix),
    // not a synthesized card — a tab row itself has no background/border of
    // its own (only `hover:bg-accent/50`, not applicable to a non-hovered
    // clone), so a transparent tab ghost background is CORRECT, matching the
    // real item. What's asserted here is the "lifted" affordance the sensor
    // adds ON TOP of the clone (box-shadow + FULL opacity, prominence fix —
    // user feedback: "the ghost item being dragged should be more visible")
    // plus the wrapper sizing itself from the real row instead of collapsing
    // to 0.
    const first = await dragAndShoot(cdp, 0, 1, 30, 'ghost-first-frame.png');
    console.log('[screenshot] first-frame ghost info:', JSON.stringify(first.info, null, 2));
    expect(first.info.exists).toBe(true);
    expect(first.info.cs?.boxShadow).not.toBe('none');
    expect(Number(first.info.cs?.opacity)).toBe(1);
    expect(first.info.cs?.transform).toMatch(/1\.03/); // subtle scale-up affordance
    expect(first.info.rect?.width).toBeGreaterThan(0);
    expect(first.info.text).toContain('Alpha');

    // (3a) CONTENT CORRECTNESS — drag a DIFFERENT tab (index 1) and confirm the
    // ghost shows THAT tab's title, not a stale/cached one from the first drag.
    const second = await dragAndShoot(cdp, 1, 6, 60, 'ghost-second-tab.png');
    console.log('[screenshot] second-tab ghost info:', JSON.stringify(second.info, null, 2));
    console.log('[screenshot] dragged row aria-label:', second.label);
    expect(second.info.exists).toBe(true);
    expect(second.label).toBeTruthy();
    expect(second.info.text).toContain(second.label.split(' ')[0]);
    expect(second.info.text).not.toContain(first.label.split(' ')[0]); // not stuck on tab #1's title

    // User feedback: "the draggable item stays in the background which
    // doesn't look good" — the source row's content must be FULLY HIDDEN
    // (visibility:hidden, not a mild opacity dim) while the ghost is up, and
    // restored once the drag ends.
    console.log('[screenshot] source content visibility — during:', second.sourceVisibilityDuring, ' after:', second.sourceVisibilityAfter);
    expect(second.sourceVisibilityDuring).toBe('hidden');
    expect(second.sourceVisibilityAfter).not.toBe('hidden');

    // (3b) LIGHT MODE — flip the theme the way the REAL app does: `useTheme()`
    // re-applies the persisted `appSettings.theme` from IndexedDB on every mount
    // (AFTER the synchronous localStorage-only theme-init.js paint), so setting
    // localStorage alone gets overridden back to 'system' → dark the instant
    // React mounts. Write BOTH so the light theme actually sticks post-reload.
    //
    // Use a WINDOW drag for this check, not a tab: `WindowItem`'s row has a
    // real `bg-card` class (unlike a tab row, which has none by default), so
    // its clone actually carries a background — this is the fidelity check
    // that a window ghost picks up the correct light/dark `--card` value via
    // the real CSS cascade, not a hardcoded palette.
    await cdp.evaluate(`
      localStorage.setItem('tabmerger-theme', 'light');
      new Promise((resolve) => {
        const req = indexedDB.open('tabmerger', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readwrite');
          const store = tx.objectStore('settings');
          const getReq = store.get('appSettings');
          getReq.onsuccess = () => {
            const existing = getReq.result?.value ?? {};
            store.put({ id: 'appSettings', value: { ...existing, theme: 'light' } });
          };
          tx.oncomplete = () => resolve(undefined);
        };
      })
    `);
    await cdp.send('Page.reload', {});
    await sleep(1500);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder window"]').length`), { timeout: 5_000 }).toBeGreaterThan(0);
    const isDark = await cdp.evaluate<boolean>(`document.documentElement.classList.contains('dark')`);
    console.log('[screenshot] documentElement.classList has "dark" after switching to light?', isDark);
    expect(isDark).toBe(false);
    const light = await dragGripAndShoot(cdp, '[aria-label^="Drag to reorder window"]', 0, 6, 60, 'ghost-window-light-mode.png');
    console.log('[screenshot] light-mode window ghost info:', JSON.stringify(light.info, null, 2));
    expect(light.info.exists).toBe(true);
    expect(light.info.cs?.backgroundColor).toBe('rgb(255, 255, 255)'); // --card (light)
    expect(light.info.cs?.color).toBe('rgb(9, 9, 11)'); // --card-foreground (light)
    expect(light.info.cs?.borderStyle).toBe('solid'); // WindowItem's `border` class
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — GROUP ghost fidelity: the active group\'s colored border shows up in the ghost, matching the real row', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    // Selecting "Work" makes it the ACTIVE group — `GroupItem` only applies its
    // real `borderLeft: 3px solid ${group.color}` (vs. transparent) while
    // active, so this is the case that actually exercises the fidelity fix
    // ("groups should have the group border").
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder group"]').length`), { timeout: 5_000 }).toBe(2);

    const realBorderLeft = await cdp.evaluate<string>(
      `document.querySelectorAll('[aria-label^="Drag to reorder group"]')[0].closest('[data-sidebar-group-index]').style.borderLeft`
    );
    console.log('[repro] real active-group row borderLeft:', realBorderLeft);
    expect(realBorderLeft).toMatch(/^3px solid rgb/); // a real color, not "transparent"

    const result = await dragGripAndShoot(cdp, '[aria-label^="Drag to reorder group"]', 0, 6, 60, 'ghost-group-active-border.png');
    console.log('[screenshot] group ghost info:', JSON.stringify(result.info, null, 2));
    expect(result.info.exists).toBe(true);
    // The clone's inline `borderLeft` must match the real row's — not a
    // hardcoded/generic color, and not "transparent" (the inactive default).
    expect(result.info.cs?.borderLeftColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.info.cs?.borderLeftWidth).toBe('3px');
    const realColorMatch = /rgb\([^)]+\)/.exec(realBorderLeft);
    expect(realColorMatch).not.toBeNull();
    expect(result.info.cs?.borderLeftColor).toBe(realColorMatch![0]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — reinstated verticalListSortingStrategy: siblings live-reflow, no measurement loop, no ancestor mutation', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);

    // Capture console.error (React logs "Maximum update depth exceeded" via it)
    // and window 'error' events — the earlier reflow bug had no error boundary,
    // so a regression would either log this or blank out #root.
    await cdp.evaluate(`
      globalThis.__consoleErrors = [];
      globalThis.__pageErrors = [];
      const origErr = console.error.bind(console);
      console.error = (...args) => { globalThis.__consoleErrors.push(String(args[0])); origErr(...args); };
      window.addEventListener('error', (e) => globalThis.__pageErrors.push(String(e.message || e.error)));
    `);

    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0);
    const g2 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 2);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    // sample sibling rows' inline transform a few times across a slow drag
    const samples: Array<Record<string, string>> = [];
    await driveSlow(
      cdp,
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
      { x: Math.round(g2.x + g2.w / 2), y: Math.round(g2.y + g2.h - 2) },
      900,
      45,
      async (i, n) => {
        if (i % 4 !== 0 && i !== n) return; // ~every 4th step + the last
        const rows = await cdp.evaluate<string[]>(
          `[...document.querySelectorAll('[data-window-index="0"] [role="listitem"]')].map(e => e.style.transform || '')`
        );
        samples.push({ i: String(i), transforms: JSON.stringify(rows) });
      }
    );

    const log = await readLog(cdp);
    const mutationEntries = log.filter(([, s]) => s === 'html5:mutation');
    const childListOnChain = mutationEntries.filter(
      ([, , d]) => (d as { kind?: string; removedHitChain?: boolean; addedHitChain?: boolean })?.kind === 'childList' &&
        ((d as { removedHitChain?: boolean }).removedHitChain || (d as { addedHitChain?: boolean }).addedHitChain)
    );
    console.log('[reflow] html5:mutation total:', mutationEntries.length, ' childList-on-ancestor-chain:', childListOnChain.length);
    for (const m of mutationEntries) console.log('   ', JSON.stringify(m));

    console.log('[reflow] sibling transform samples over the drag:');
    for (const s of samples) console.log(`   step ${s.i}:`, s.transforms);

    const consoleErrors = await cdp.evaluate<string[]>(`JSON.stringify(globalThis.__consoleErrors)`).then((s) => JSON.parse(s as unknown as string));
    const pageErrors = await cdp.evaluate<string[]>(`JSON.stringify(globalThis.__pageErrors)`).then((s) => JSON.parse(s as unknown as string));
    const maxDepthHit = [...consoleErrors, ...pageErrors].some((m) => /maximum update depth/i.test(m));
    console.log('[reflow] console errors:', JSON.stringify(consoleErrors));
    console.log('[reflow] page errors:', JSON.stringify(pageErrors));
    const rootAlive = await cdp.evaluate<number>(`document.getElementById('root')?.childElementCount ?? 0`);
    console.log('[reflow] #root still mounted, childCount=', rootAlive);

    // 1. zero ancestor-chain childList mutations (must not regress)
    expect(childListOnChain).toHaveLength(0);
    // 2. no "Maximum update depth exceeded" and the popup did not unmount
    expect(maxDepthHit).toBe(false);
    expect(rootAlive).toBeGreaterThan(0);
    // 3. the reflow is LIVE — at least one sample shows a non-identity transform
    //    on some row (a sibling opening a gap), and it's not the exact same
    //    string on every sample (proves it's changing across the drag, not a
    //    one-shot static value).
    const nonEmpty = samples.filter((s) => s.transforms.includes('translate'));
    const distinctSnapshots = new Set(samples.map((s) => s.transforms)).size;
    console.log('[reflow] samples with a translate transform:', nonEmpty.length, '/', samples.length, ' distinct snapshots:', distinctSnapshots);
    expect(nonEmpty.length).toBeGreaterThan(0);
    expect(distinctSnapshots).toBeGreaterThan(1);

    // 4. drop still commits cleanly, no flicker: DOM order == committed order
    const after = await idbGroup(cdp, 'work');
    const domOrder = await cdp.evaluate<string[]>(
      `[...document.querySelectorAll('[data-window-index="0"] [role="listitem"]')].map(e => (e.getAttribute('aria-label')||'').split(' ')[0])`
    );
    console.log('[reflow] IDB after:', JSON.stringify(after.windows[0].tabs), ' DOM after:', JSON.stringify(domOrder));
    expect(domOrder).toEqual(after.windows[0].tabs.map((t) => t.split(' ')[0]));
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — TAB drag commits', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0);
    const g2 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 2);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    const before = await idbGroup(cdp, 'work');
    await drive(cdp, { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) }, { x: Math.round(g2.x + g2.w / 2), y: Math.round(g2.y + g2.h - 2) });
    const log = await readLog(cdp);
    printLog('TAB drag', log);
    const after = await idbGroup(cdp, 'work');
    console.log('[repro] work w0 before:', JSON.stringify(before.windows[0].tabs), '→ after:', JSON.stringify(after.windows[0].tabs));
    const names = stageNames(log);
    expect(names).toEqual(expect.arrayContaining(['html5:dragstart', 'onDragStart', 'html5:drop', 'onDragEnd', 'committed']));
    expect(after.windows[0].tabs).toEqual(['Bravo', 'Charlie', 'Alpha']);

    // item 5 (no flicker, best-effort): `committed` lands within ~a few frames
    // of `html5:drop` (commit is synchronous, not waiting on the async IDB write)
    // and the rendered order already matches the committed order.
    const dropT = log.find(([, s]) => s === 'html5:drop')?.[0] ?? 0;
    const commitT = log.find(([, s]) => s === 'committed')?.[0] ?? 0;
    console.log('[repro] drop→committed gap:', commitT - dropT, 'ms');
    expect(commitT - dropT).toBeLessThan(80);
    const domOrder = await cdp.evaluate<string[]>(
      `[...document.querySelectorAll('[data-window-index="0"] [role="listitem"]')].map(e => (e.getAttribute('aria-label')||'').split(' ')[0])`
    );
    console.log('[repro] DOM order after drop:', JSON.stringify(domOrder));
    expect(domOrder).toEqual(['Bravo', 'Charlie', 'Alpha']);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — transparent drag image is a decoded <img>, not a canvas fallback (grey-dotted-box regression)', async () => {
  // IMPORTANT — read before trusting this test alone: this asserts the
  // PROPERTIES of the image argument passed to `setDragImage()` as read live,
  // in the real toolbar popup, at the moment `dragstart` fires. It CANNOT
  // prove the native drag image itself is gone — Chrome's native drag image is
  // composited by the OS window manager, outside the page's render surface, so
  // `Page.captureScreenshot` (or any CDP screenshot) is structurally incapable
  // of observing it either way. A detached <canvas> with `calledSetDragImage:
  // true` looked identical to a working fix under every screenshot-based check
  // in earlier rounds. This test instead pins the actual Blink precondition
  // for the decoded-bitmap fast path (`<img>`, `complete`, `naturalWidth>0`,
  // `isConnected`) — proving the argument is now valid is the strongest claim
  // CDP can make; only manual visual confirmation in Chrome proves the grey
  // box is actually gone.
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0);
    const g2 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 2);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) }, { x: Math.round(g2.x + g2.w / 2), y: Math.round(g2.y + g2.h - 2) });
    const log = await readLog(cdp);
    printLog('TAB drag (drag-image diagnostic)', log);
    const dragImageEntry = log.find(([, s]) => s === 'html5:dragimage');
    expect(dragImageEntry).toBeDefined();
    const detail = dragImageEntry![2] as {
      calledSetDragImage: boolean;
      tagName: string | null;
      complete: boolean | null;
      naturalWidth: number | null;
      isConnected: boolean | null;
    };
    console.log('[repro] html5:dragimage detail:', JSON.stringify(detail));
    expect(detail.calledSetDragImage).toBe(true);
    expect(detail.tagName).toBe('IMG');
    expect(detail.tagName).not.toBe('CANVAS');
    // Real Chrome, real data-URI image, decoded well before dragstart (created
    // + `.decode()`d at popup boot) — unlike the jsdom unit test, this SHOULD
    // be a real decoded 1×1 bitmap by the time a drag can start.
    expect(detail.complete).toBe(true);
    expect(detail.naturalWidth).toBeGreaterThan(0);
    expect(detail.isConnected).toBe(true);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — WINDOW drag commits', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder window"]').length`), { timeout: 5_000 }).toBe(2);
    const w0 = await box(cdp, '[aria-label^="Drag to reorder window"]', 0);
    const w1 = await box(cdp, '[aria-label^="Drag to reorder window"]', 1);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    const before = await idbGroup(cdp, 'work');
    await drive(cdp, { x: Math.round(w0.x + w0.w / 2), y: Math.round(w0.y + w0.h / 2) }, { x: Math.round(w1.x + w1.w / 2), y: Math.round(w1.y + w1.h + 20) });
    const log = await readLog(cdp);
    printLog('WINDOW drag', log);
    const after = await idbGroup(cdp, 'work');
    console.log('[repro] work windows before:', JSON.stringify(before.windows.map((w) => w.tabs[0])), '→ after:', JSON.stringify(after.windows.map((w) => w.tabs[0])));
    const names = stageNames(log);
    expect(names).toEqual(expect.arrayContaining(['html5:dragstart', 'onDragStart', 'html5:drop', 'onDragEnd', 'committed']));
    expect(after.windows.map((w) => w.tabs[0])).toEqual(['Delta', 'Alpha']); // windows swapped
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — GROUP drag reorders the sidebar', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder group"]').length`), { timeout: 5_000 }).toBe(2);
    const gr0 = await box(cdp, '[aria-label^="Drag to reorder group"]', 0); // Work
    const gr1 = await box(cdp, '[aria-label^="Drag to reorder group"]', 1); // Play
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    const before = await groupOrder(cdp);
    await drive(cdp, { x: Math.round(gr0.x + gr0.w / 2), y: Math.round(gr0.y + gr0.h / 2) }, { x: Math.round(gr1.x + gr1.w / 2), y: Math.round(gr1.y + gr1.h + 10) });
    const log = await readLog(cdp);
    printLog('GROUP drag', log);
    const after = await groupOrder(cdp);
    console.log('[repro] group order before:', JSON.stringify(before), '→ after:', JSON.stringify(after));
    const names = stageNames(log);
    expect(names).toEqual(expect.arrayContaining(['html5:dragstart', 'onDragStart', 'html5:drop', 'onDragEnd', 'committed']));
    expect(JSON.stringify(after)).not.toEqual(JSON.stringify(before)); // order actually changed
    expect(after.indexOf('play')).toBeLessThan(after.indexOf('work')); // Play now before Work
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — item 2: a GROUP cannot be dropped above "Now Open"', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder group"]').length`), { timeout: 5_000 }).toBe(2);
    const before = await groupOrder(cdp); // [permanent, work, play]
    const permId = before[0];
    const playGrip = await box(cdp, '[aria-label^="Drag to reorder group"]', 1); // Play
    const nowOpen = await rowBoxByText(cdp, 'Now Open');
    expect(nowOpen).not.toBeNull();
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    // drag Play's grip UP to the middle of the Now Open row
    await drive(
      cdp,
      { x: Math.round(playGrip.x + playGrip.w / 2), y: Math.round(playGrip.y + playGrip.h / 2) },
      { x: Math.round(nowOpen!.x + nowOpen!.w / 2), y: Math.round(nowOpen!.y + nowOpen!.h / 2) }
    );
    const log = await readLog(cdp);
    printLog('GROUP → above Now Open', log);
    const after = await groupOrder(cdp);
    console.log('[repro] order before:', JSON.stringify(before), '→ after:', JSON.stringify(after));
    // "Now Open" (permanent) must still be first, and Play must not have reached index 0.
    expect(after[0]).toBe(permId);
    expect(after.indexOf('play')).toBeGreaterThan(0);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — item 3: dropping a TAB on the "new window" zone makes a new window', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const before = await idbGroup(cdp, 'work');
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // "Alpha" in window 0
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    // zone box must be read WHILE a drag is active — grab it at the mid hook
    let zone: { x: number; y: number; w: number; h: number } | undefined;
    await drive(
      cdp,
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
      // provisional target; corrected below once we know the zone rect
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + 260) },
      async () => {
        zone = await box(cdp, '[data-testid="new-window-dropzone"]', 0);
        const vis = await cdp.evaluate<string>(
          `getComputedStyle(document.querySelector('[data-testid="new-window-dropzone"]')).visibility`
        );
        console.log('[repro] new-window zone while dragging:', JSON.stringify(zone), 'visibility=', vis);
        expect(vis).toBe('visible');
      }
    );
    // If the provisional target missed the zone, redo the drop precisely on it.
    let after = await idbGroup(cdp, 'work');
    if (after.windows.length === before.windows.length && zone) {
      await cdp.evaluate(`globalThis.__tmDndLog = []`);
      await drive(
        cdp,
        { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
        { x: Math.round(zone.x + zone.w / 2), y: Math.round(zone.y + zone.h / 2) }
      );
      after = await idbGroup(cdp, 'work');
    }
    const log = await readLog(cdp);
    printLog('TAB → new-window zone', log);
    console.log('[repro] work windows before:', before.windows.length, '→ after:', after.windows.length);
    console.log('[repro] work after:', JSON.stringify(after.windows.map((w) => w.tabs)));
    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:drop', 'onDragEnd', 'committed']));
    expect(after.windows.length).toBe(before.windows.length + 1);
    expect(after.windows[after.windows.length - 1].tabs).toEqual(['Alpha']);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — item 4: cross-group TAB drop persists immediately', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const workBefore = await idbGroup(cdp, 'work');
    const playBefore = await idbGroup(cdp, 'play');
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // "Alpha"
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(
      cdp,
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
      { x: Math.round(playRow!.x + playRow!.w / 2), y: Math.round(playRow!.y + playRow!.h / 2) }
    );
    const log = await readLog(cdp);
    printLog('TAB → other group row', log);
    const workAfter = await idbGroup(cdp, 'work');
    const playAfter = await idbGroup(cdp, 'play');
    console.log('[repro] work w0 tabs:', JSON.stringify(workBefore.windows[0].tabs), '→', JSON.stringify(workAfter.windows[0].tabs));
    console.log('[repro] play windows:', JSON.stringify(playBefore.windows.map((w) => w.tabs)), '→', JSON.stringify(playAfter.windows.map((w) => w.tabs)));
    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:drop', 'onDragEnd', 'committed']));
    expect(workAfter.windows[0].tabs).toEqual(['Bravo', 'Charlie']); // left the source group
    // Group-ROW drop = a NEW window (user rule): Play's existing window is untouched and
    // Alpha sits alone in a new last window — no longer appended after Foxtrot.
    expect(playAfter.windows.map((w) => w.tabs)).toEqual([['Foxtrot'], ['Alpha']]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — item 6: a WINDOW drag keeps the window\'s tabs rendered (not collapsed)', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder window"]').length`), { timeout: 5_000 }).toBe(2);
    const tabsBefore = await cdp.evaluate<number>(
      `document.querySelectorAll('[data-window-index="0"] [role="listitem"]').length`
    );
    const w0 = await box(cdp, '[aria-label^="Drag to reorder window"]', 0);
    const w1 = await box(cdp, '[aria-label^="Drag to reorder window"]', 1);
    let tabsMid = -1;
    await drive(
      cdp,
      { x: Math.round(w0.x + w0.w / 2), y: Math.round(w0.y + w0.h / 2) },
      { x: Math.round(w1.x + w1.w / 2), y: Math.round(w1.y + w1.h + 20) },
      async () => {
        tabsMid = await cdp.evaluate<number>(
          `document.querySelectorAll('[data-window-index="0"] [role="listitem"]').length`
        );
      }
    );
    console.log('[repro] window-0 tab rows: before=', tabsBefore, ' during drag=', tabsMid);
    expect(tabsBefore).toBeGreaterThan(0);
    expect(tabsMid).toBe(tabsBefore); // not collapsed / minimized during its own drag
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

/**
 * REGRESSION HUNT — "cross group tab dnd causes extension to close."
 *
 * The existing "item 4" test above already covers ONE cross-group tab drop
 * (paced ~700ms drag) and passes cleanly, but it never checks for page
 * errors / `#root` survival / CDP-target liveness — it only checks IDB
 * content. These tests add that instrumentation AND vary the drag in ways a
 * real user might that the paced synthetic drag doesn't: a fast/abrupt
 * flick-style drag, and a drop that empties the source window entirely.
 */
async function installErrorCapture(cdp: RawCdp): Promise<void> {
  await cdp.evaluate(`
    globalThis.__consoleErrors = globalThis.__consoleErrors ?? [];
    globalThis.__pageErrors = globalThis.__pageErrors ?? [];
    if (!globalThis.__tmErrorCaptureInstalled) {
      globalThis.__tmErrorCaptureInstalled = true;
      const origErr = console.error.bind(console);
      console.error = (...args) => { globalThis.__consoleErrors.push(args.map(String).join(' ')); origErr(...args); };
      window.addEventListener('error', (e) => globalThis.__pageErrors.push(String(e.message || e.error)));
      window.addEventListener('unhandledrejection', (e) => globalThis.__pageErrors.push('unhandledrejection: ' + String(e.reason)));
    }
  `);
}
async function readErrors(cdp: RawCdp): Promise<{ consoleErrors: string[]; pageErrors: string[] }> {
  const consoleErrors = await cdp
    .evaluate<string[]>(`JSON.stringify(globalThis.__consoleErrors ?? [])`)
    .then((s) => JSON.parse(s as unknown as string));
  const pageErrors = await cdp
    .evaluate<string[]>(`JSON.stringify(globalThis.__pageErrors ?? [])`)
    .then((s) => JSON.parse(s as unknown as string));
  return { consoleErrors, pageErrors };
}
/** Throws / returns null if the popup CDP target is gone or its document died. */
async function rootAliveOrNull(cdp: RawCdp): Promise<number | null> {
  try {
    return await cdp.evaluate<number>(`document.getElementById('root')?.childElementCount ?? 0`);
  } catch (err) {
    console.log('[repro] rootAliveOrNull: evaluate FAILED — popup target likely gone:', String(err));
    return null;
  }
}

/** Press, jump in 2 large steps (no smooth pacing), release almost immediately — an abrupt "flick" a real user might do faster than our other paced helpers. */
async function fastDrag(cdp: RawCdp, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + 3, y: from.y + 8, button: 'left', buttons: 1 });
  await sleep(15);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 });
  await sleep(15);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
}

test('real popup — REGRESSION HUNT: fast cross-group TAB drop does not crash/close the popup', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const rootBefore = await rootAliveOrNull(cdp);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // "Alpha"
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await fastDrag(
      cdp,
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
      { x: Math.round(playRow!.x + playRow!.w / 2), y: Math.round(playRow!.y + playRow!.h / 2) }
    );
    const log = await readLog(cdp);
    printLog('FAST cross-group TAB drop', log);
    const rootAfter = await rootAliveOrNull(cdp);
    const { consoleErrors, pageErrors } = await readErrors(cdp);
    console.log('[repro] rootBefore=', rootBefore, ' rootAfter=', rootAfter);
    console.log('[repro] consoleErrors=', JSON.stringify(consoleErrors));
    console.log('[repro] pageErrors=', JSON.stringify(pageErrors));
    expect(rootAfter).not.toBeNull(); // popup target/document must still be alive
    expect(rootAfter).toBeGreaterThan(0); // #root still has children — not blanked
    expect(pageErrors).toEqual([]);
    const playAfter = await idbGroup(cdp, 'play');
    console.log('[repro] play tabs after:', JSON.stringify(playAfter.windows.flatMap((w) => w.tabs)));
    expect(playAfter.windows.flatMap((w) => w.tabs)).toContain('Alpha');
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — REGRESSION HUNT: cross-group TAB drop that EMPTIES the source window does not crash/close the popup', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Play'); // Play's only window has exactly ONE tab: "Foxtrot"
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(0);
    const rootBefore = await rootAliveOrNull(cdp);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // "Foxtrot" — the ONLY tab in this window
    const workRow = await rowBoxByText(cdp, 'Work');
    expect(workRow).not.toBeNull();
    // Per-frame: Play's panel (the SOURCE view) + sidebar texts + window count.
    await installFrameSampler(cdp, 'main [role="listitem"]');
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(
      cdp,
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
      { x: Math.round(workRow!.x + workRow!.w / 2), y: Math.round(workRow!.y + workRow!.h / 2) }
    );
    await sleep(300);
    const log = await readLog(cdp);
    printLog('cross-group TAB drop EMPTYING source window', log);
    const emptyFrames = await readFrames(cdp);
    const ev = analyzeDropFrames(emptyFrames.frames, emptyFrames.marks, 'Foxtrot');
    const es = analyzeSideFrames(emptyFrames.frames, emptyFrames.marks);
    const rootAfter = await rootAliveOrNull(cdp);
    const { consoleErrors, pageErrors } = await readErrors(cdp);
    console.log('[repro] rootBefore=', rootBefore, ' rootAfter=', rootAfter);
    console.log('[repro] consoleErrors=', JSON.stringify(consoleErrors));
    console.log('[repro] pageErrors=', JSON.stringify(pageErrors));
    expect(rootAfter).not.toBeNull();
    expect(rootAfter).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
    const playAfter = await idbGroup(cdp, 'play');
    const workAfter = await idbGroup(cdp, 'work');
    console.log('[repro] play windows after (should have an empty or removed window):', JSON.stringify(playAfter.windows));
    console.log('[repro] work tabs after:', JSON.stringify(workAfter.windows.flatMap((w) => w.tabs)));
    expect(workAfter.windows.flatMap((w) => w.tabs)).toContain('Foxtrot');
    // The emptied saved source window is REMOVED in the same commit (it was Play's only
    // window → Play has zero windows), and Foxtrot is Work's NEW last window.
    expect(playAfter.windows).toEqual([]);
    expect(workAfter.windows.map((w) => w.tabs)).toEqual([['Alpha', 'Bravo', 'Charlie'], ['Delta', 'Echo'], ['Foxtrot']]);
    // …in ONE paint in the source view: the window disappears, Foxtrot is never shown
    // again, and both sidebar badges change on that same frame.
    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:drop', 'onDragEnd', 'committed']));
    expect(ev.finalOrder).toEqual([]);
    expect(ev.framesToFinal).toBeGreaterThanOrEqual(0);
    expect(ev.framesToFinal).toBeLessThanOrEqual(1);
    expect(ev.regressedAfterFinal).toBe(false);
    expect(ev.framesMovedItemAtWrongSlot).toBe(0);
    expect(es.winsBefore).toBe(1);
    expect(es.winsFinal).toBe(0);
    expect(es.sideBefore).toEqual(expect.arrayContaining(['Work2◆5', 'Play1◆1']));
    expect(es.sideFinal).toEqual(expect.arrayContaining(['Work3◆6', 'Play0◆0']));
    expect(es.sideFramesToFinal).toBe(ev.framesToFinal);
    expect(es.sideRegressedAfterFinal).toBe(false);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — REGRESSION HUNT: moved tab is VISIBLE (not left visibility:hidden) in its destination group after a cross-group drop', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // "Alpha"
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(
      cdp,
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
      { x: Math.round(playRow!.x + playRow!.w / 2), y: Math.round(playRow!.y + playRow!.h / 2) }
    );
    const rootAfter = await rootAliveOrNull(cdp);
    expect(rootAfter).not.toBeNull();
    expect(rootAfter).toBeGreaterThan(0);
    // Switch to the destination group and confirm the moved tab actually
    // RENDERS visibly — hypothesis 1b: React recycling the DOM node the
    // sensor set `visibility:hidden` on, with the hide never getting restored.
    await selectGroup(cdp, 'Play');
    await expect
      .poll(() => cdp.evaluate<boolean>(`!![...document.querySelectorAll('[role="listitem"]')].find(e => e.getAttribute('aria-label')?.includes('Alpha'))`), { timeout: 5_000 })
      .toBe(true);
    const alphaVisibility = await cdp.evaluate<string>(
      `getComputedStyle([...document.querySelectorAll('[role="listitem"]')].find(e => e.getAttribute('aria-label')?.includes('Alpha'))).visibility`
    );
    console.log('[repro] moved tab "Alpha" visibility in destination group:', alphaVisibility);
    expect(alphaVisibility).toBe('visible');
    await saveShot(cdp, 'cross-group-destination-tab-visible.png');
    const { pageErrors } = await readErrors(cdp);
    expect(pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

/**
 * PRIME SUSPECT: `useDndHandlers.onDragOver`'s "spring-open" feature arms a
 * 600ms dwell timer (`SPRING_OPEN_MS`) when a tab/window drag rests on a
 * NON-active group's sidebar row, then calls `setActiveGroupIndex(...)` —
 * which re-renders the ENTIRE main windows panel to show the newly-active
 * group WHILE THE NATIVE HTML5 DRAG IS STILL IN PROGRESS. That's a childList
 * mutation on (and unmount of) the dragged row's own ancestor chain — the
 * exact class of mutation established to abort/crash a native drag in this
 * popup (see `watchSourceMutations` / the MV3 DnD saga). Every existing
 * cross-group test above releases almost immediately on arrival at the
 * sidebar row (well under 600ms dwell) — a real user pausing to aim, or
 * hesitating before releasing, easily dwells longer than that.
 */
async function pressMoveDwellRelease(
  cdp: RawCdp,
  from: { x: number; y: number },
  to: { x: number; y: number },
  dwellMs: number
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      button: 'left',
      buttons: 1
    });
    await sleep(50);
  }
  // Keep nudging by 1px every ~80ms while "parked" on the target — a real
  // user's hand never holds PERFECTLY still, and the popup's own throttled
  // `dragover` stream needs periodic events to keep feeding `onDragOver`.
  const dwellSteps = Math.ceil(dwellMs / 80);
  for (let i = 0; i < dwellSteps; i++) {
    const jitter = i % 2 === 0 ? 1 : -1;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x + jitter, y: to.y, button: 'left', buttons: 1 });
    await sleep(80);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
}

test('real popup — REGRESSION HUNT: dwelling on a non-active group\'s sidebar row during a TAB drag (spring-open) does not crash/close the popup', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work'); // Work is now the ACTIVE group
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const rootBefore = await rootAliveOrNull(cdp);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // "Alpha", in Work
    const playRow = await rowBoxByText(cdp, 'Play'); // Play is NOT active — a valid spring-open target
    expect(playRow).not.toBeNull();
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    // Dwell 900ms — safely past the 600ms SPRING_OPEN_MS threshold.
    await pressMoveDwellRelease(
      cdp,
      { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) },
      { x: Math.round(playRow!.x + playRow!.w / 2), y: Math.round(playRow!.y + playRow!.h / 2) },
      900
    );
    const log = await readLog(cdp);
    printLog('DWELL on non-active group row during TAB drag', log);
    const rootAfter = await rootAliveOrNull(cdp);
    const { consoleErrors, pageErrors } = await readErrors(cdp);
    console.log('[repro] rootBefore=', rootBefore, ' rootAfter=', rootAfter);
    console.log('[repro] consoleErrors=', JSON.stringify(consoleErrors));
    console.log('[repro] pageErrors=', JSON.stringify(pageErrors));
    if (rootAfter === null) {
      console.log('[repro] *** REPRODUCED: popup target/document died during the dwell-then-drop drag ***');
    }
    expect(rootAfter).not.toBeNull(); // popup target/document must still be alive
    expect(rootAfter).toBeGreaterThan(0); // #root still has children — not blanked
    expect(pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — REGRESSION HUNT: continuing a TAB drag INTO the just-sprung-open destination panel does not crash/close the popup', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work'); // Work is the ACTIVE group
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const rootBefore = await rootAliveOrNull(cdp);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // "Alpha", in Work
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    const cx0 = Math.round(g0.x + g0.w / 2);
    const cy0 = Math.round(g0.y + g0.h / 2);
    const playX = Math.round(playRow!.x + playRow!.w / 2);
    const playY = Math.round(playRow!.y + playRow!.h / 2);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx0, y: cy0, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx0, y: cy0, button: 'left', buttons: 1, clickCount: 1 });
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(cx0 + ((playX - cx0) * i) / steps),
        y: Math.round(cy0 + ((playY - cy0) * i) / steps),
        button: 'left',
        buttons: 1
      });
      await sleep(50);
    }
    // Dwell on the Play row past SPRING_OPEN_MS (600ms) with periodic jitter
    // moves (the popup throttles dragover, so onDragOver needs feeding).
    for (let i = 0; i < 10; i++) {
      const jitter = i % 2 === 0 ? 1 : -1;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: playX + jitter, y: playY, button: 'left', buttons: 1 });
      await sleep(80);
    }
    // By now the spring-open should have fired (Play is active, main panel
    // re-rendered). Continue the SAME physical drag further into the newly
    // revealed main panel and drop it there — what a real user pursuing
    // "drop into a specific window of the destination group" would do.
    const mainPanelTarget = await cdp.evaluate<{ x: number; y: number } | null>(
      `(() => {
         const w = document.querySelector('[data-window-index]');
         if (!w) return null;
         const r = w.getBoundingClientRect();
         return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
       })()`
    );
    console.log('[repro] main panel target after spring-open dwell:', JSON.stringify(mainPanelTarget));
    if (mainPanelTarget) {
      const moveSteps = 8;
      for (let i = 1; i <= moveSteps; i++) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(playX + ((mainPanelTarget.x - playX) * i) / moveSteps),
          y: Math.round(playY + ((mainPanelTarget.y - playY) * i) / moveSteps),
          button: 'left',
          buttons: 1
        });
        await sleep(50);
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mainPanelTarget.x, y: mainPanelTarget.y, button: 'left', buttons: 0, clickCount: 1 });
    } else {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: playX, y: playY, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(600);

    const log = await readLog(cdp);
    printLog('CONTINUE drag into sprung-open destination panel', log);
    const rootAfter = await rootAliveOrNull(cdp);
    const { consoleErrors, pageErrors } = await readErrors(cdp);
    console.log('[repro] rootBefore=', rootBefore, ' rootAfter=', rootAfter);
    console.log('[repro] consoleErrors=', JSON.stringify(consoleErrors));
    console.log('[repro] pageErrors=', JSON.stringify(pageErrors));
    if (rootAfter === null) {
      console.log('[repro] *** REPRODUCED: popup target/document died continuing the drag into the sprung-open panel ***');
    }
    expect(rootAfter).not.toBeNull();
    expect(rootAfter).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NOW OPEN → saved group is a COPY — the popup must survive.
//
// Prior tests only ever dragged FROM saved groups. Dragging a LIVE Now Open tab
// or window used to emit `tabs.remove` side effects; closing the ACTIVE tab of
// the window the toolbar popup is anchored to makes Chrome dismiss the popup
// instantly (and a window drag closed the user's real browser window). These
// drag the popup's OWN anchor tab — the worst case — and assert the popup is
// still attached, the saved group gained the copy, and no real tab was closed.
// ─────────────────────────────────────────────────────────────────────────────

const liveUrl = (title: string) => `data:text/html,<title>${title}</title><p>${title}</p>`;

async function browserTabs(context: BrowserContext): Promise<{ id: number; title: string; windowId: number }[]> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  return sw.evaluate(async () =>
    (await chrome.tabs.query({})).map((t) => ({ id: t.id ?? -1, title: t.title ?? '', windowId: t.windowId }))
  );
}

/** Center of the drag grip inside the tab row whose aria-label === `title` (or, with `window`, of its window's grip). */
async function liveGripByTitle(cdp: RawCdp, title: string, kind: 'tab' | 'window') {
  return cdp.evaluate<{ x: number; y: number } | null>(
    `(() => {
       // aria-label is the tab title, or the URL until Chrome has reported the <title>
       const rows = [...document.querySelectorAll('[role="listitem"]')];
       const row = rows.find(e => e.getAttribute('aria-label') === ${JSON.stringify(title)})
         || rows.find(e => (e.getAttribute('aria-label') || '').includes('<title>' + ${JSON.stringify(title)} + '</title>'));
       if (!row) return null;
       const sel = ${JSON.stringify(kind === 'window' ? '[aria-label^="Drag to reorder window"]' : '[aria-label^="Drag to reorder tab"]')};
       // Tab rows ALSO carry data-window-index, so walk up to the ancestor that owns a window grip.
       let scope = row;
       if (${kind === 'window'}) {
         scope = row.parentElement;
         while (scope && !(scope.hasAttribute('data-window-index') && scope.querySelector(sel))) scope = scope.parentElement;
       }
       const grip = scope && scope.querySelector(sel);
       if (!grip) return null;
       const r = grip.getBoundingClientRect();
       return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
     })()`
  );
}

async function nowOpenCopyDrag(kind: 'tab' | 'window') {
  // LiveHost is the popup's ANCHOR tab (focused window) — the worst case to drag.
  // A 2nd real window is needed so Now Open renders window grips at all.
  const { context, cdp } = await launch({
    hostUrl: liveUrl('LiveHost'),
    extraTabUrls: [liveUrl('LiveOther')],
    extraWindowUrls: [liveUrl('LiveSecond')]
  });
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Now Open');
    const found = await expect
      .poll(() => liveGripByTitle(cdp, 'LiveHost', kind), { timeout: 10_000 })
      .not.toBeNull()
      .then(() => true, () => false);
    if (!found) {
      const diag = await cdp.evaluate<unknown>(
        `({ rows: [...document.querySelectorAll('[role="listitem"]')].map(e => e.getAttribute('aria-label')),
            windowGrips: document.querySelectorAll('[aria-label^="Drag to reorder window"]').length,
            tabGrips: document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length,
            windows: document.querySelectorAll('[data-window-index]').length })`
      );
      console.log(`[now-open ${kind}] grip NOT found — popup DOM:`, JSON.stringify(diag));
    }
    expect(found).toBe(true);
    const from = (await liveGripByTitle(cdp, 'LiveHost', kind))!;
    const workRow = await rowBoxByText(cdp, 'Work');
    expect(workRow).not.toBeNull();

    const tabsBefore = await browserTabs(context);
    const workBefore = await idbGroup(cdp, 'work');
    console.log(`[now-open ${kind}] browser tabs before:`, JSON.stringify(tabsBefore));
    expect(tabsBefore.map((t) => t.title)).toEqual(expect.arrayContaining(['LiveHost', 'LiveOther']));

    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, from, { x: Math.round(workRow!.x + workRow!.w / 2), y: Math.round(workRow!.y + workRow!.h / 2) });
    await sleep(800); // let any (formerly) async chrome side effects land

    // RawCdp.send has no timeout: against a DISMISSED popup target it hangs forever,
    // so bound the liveness probe and treat "no answer" as "popup gone".
    let probeSettled = false;
    const rootAfter = await Promise.race([
      rootAliveOrNull(cdp).finally(() => {
        probeSettled = true;
      }),
      sleep(5_000).then(() => {
        if (!probeSettled) console.log(`[now-open ${kind}] liveness probe got NO answer in 5s — popup target gone`);
        return null;
      })
    ]);
    console.log(`[now-open ${kind}] rootAfter=`, rootAfter);
    // 1. popup target still attached AND #root still rendered
    expect(rootAfter).not.toBeNull();
    expect(rootAfter).toBeGreaterThan(0);

    const log = await readLog(cdp);
    printLog(`NOW OPEN ${kind.toUpperCase()} → saved group`, log);
    const { consoleErrors, pageErrors } = await readErrors(cdp);
    console.log(`[now-open ${kind}] consoleErrors=`, JSON.stringify(consoleErrors), ' pageErrors=', JSON.stringify(pageErrors));
    // 2. drag reached committed, not undoable (touches Now Open)
    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:dragstart', 'onDragStart', 'html5:drop', 'onDragEnd', 'committed']));
    const committed = log.find(([, s]) => s === 'committed')![2] as { undoable?: boolean };
    expect(committed.undoable).toBe(false);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);

    // 3. saved group gained the copy in IndexedDB
    const workAfter = await idbGroup(cdp, 'work');
    console.log(`[now-open ${kind}] work before:`, JSON.stringify(workBefore.windows), '→ after:', JSON.stringify(workAfter.windows));
    const workTitles = workAfter.windows.flatMap((w) => w.tabs);
    expect(workTitles).toContain('LiveHost');
    if (kind === 'window') {
      expect(workAfter.windows.length).toBe(workBefore.windows.length + 1);
      expect(workTitles).toContain('LiveOther');
    }

    // 4. no real browser tab was closed
    const tabsAfter = await browserTabs(context);
    console.log(`[now-open ${kind}] browser tabs after:`, JSON.stringify(tabsAfter));
    expect(tabsAfter.length).toBe(tabsBefore.length);
    expect(tabsAfter.map((t) => t.id).sort((a, b) => a - b)).toEqual(tabsBefore.map((t) => t.id).sort((a, b) => a - b));
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FRAME-LEVEL SAMPLING (tasks: "source row fully out of layout" + "instant drop").
//
// Every frame is sampled in a ResizeObserver callback on an off-screen sentinel
// whose width a rAF toggles each frame. RO callbacks run AFTER every rAF callback
// (incl. the sensor's deferred `onEnd`) and after layout, immediately before
// paint — so a sample is the state that frame paints, not the state some earlier
// rAF callback saw. The sentinel is appended BEFORE any drag starts (a <body>
// childList change mid-dispatch is exactly the kind of thing to avoid).
// ─────────────────────────────────────────────────────────────────────────────

interface FrameRow {
  l: string;
  top: number;
  h: number;
  tf: string;
  vis: string;
  anim: number;
}
interface Frame {
  n: number;
  t: number;
  wall: number;
  ghost: boolean;
  instant: boolean;
  rows: FrameRow[];
  /** every sidebar group row's text, whitespace-stripped: name + "W◆T" badge, e.g. `Work2◆5` */
  side: string[];
  /** window cards rendered in the windows panel */
  wins: number;
}
interface FrameMark {
  type: string;
  t: number;
  wall: number;
}

async function installFrameSampler(cdp: RawCdp, rowSel: string): Promise<void> {
  await cdp.evaluate(`(() => {
    const ROW_SEL = ${JSON.stringify(rowSel)};
    if (globalThis.__fs && globalThis.__fs.stop) globalThis.__fs.stop();
    const S = globalThis.__fs = { frames: [], marks: [], running: true };
    let sentinel = document.getElementById('tm-frame-sentinel');
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = 'tm-frame-sentinel';
      sentinel.style.cssText = 'position:fixed;left:-20px;top:-20px;width:1px;height:1px;pointer-events:none;';
      document.body.appendChild(sentinel);
    }
    let flip = false, frameNo = 0;
    const label = (r) => ((r.getAttribute('aria-label') || r.textContent || '').trim().split(' ')[0]);
    const snap = () => {
      const rows = [...document.querySelectorAll(ROW_SEL)];
      S.frames.push({
        n: frameNo, t: Math.round(performance.now() * 10) / 10, wall: Date.now(),
        ghost: !!document.querySelector('[data-testid="drag-ghost"]'),
        instant: document.documentElement.hasAttribute('data-tm-dnd-instant'),
        side: [...document.querySelectorAll('[data-sidebar-group-index]')].map((r) => (r.textContent || '').replace(/\\s+/g, '')),
        wins: document.querySelectorAll('main [data-window-index]:not([role])').length,
        rows: rows.map((r) => {
          const rc = r.getBoundingClientRect();
          const content = r.querySelector('.grid') || r;
          return {
            l: label(r), top: Math.round(rc.top), h: Math.round(rc.height), tf: r.style.transform || '',
            vis: getComputedStyle(content).visibility,
            anim: r.getAnimations().filter((a) => a.playState === 'running').length
          };
        })
      });
      if (S.frames.length > 900) S.frames.shift();
    };
    const ro = new ResizeObserver(() => { if (S.running) snap(); });
    ro.observe(sentinel);
    const tick = () => { if (!S.running) return; frameNo++; flip = !flip; sentinel.style.width = flip ? '2px' : '1px'; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const onMark = (e) => S.marks.push({ type: e.type, t: Math.round(performance.now() * 10) / 10, wall: Date.now() });
    for (const type of ['dragstart', 'drop', 'dragend']) document.addEventListener(type, onMark, true);
    // Every write to the groups query (debug-flag-only QueryClient handle), with the
    // Work group's window-0 order it installed and who wrote it.
    S.qlog = [];
    const qc = globalThis.__tmQueryClient;
    const qunsub = qc ? qc.getQueryCache().subscribe((e) => {
      if (!e || e.type !== 'updated' || !e.query || e.query.queryKey[0] !== 'groups') return;
      const data = e.query.state.data;
      const work = data && data.available ? data.available.find((g) => g.id === 'work') : null;
      S.qlog.push({
        t: Math.round(performance.now() * 10) / 10,
        action: e.action ? e.action.type : null,
        w0: work && work.windows[0] ? work.windows[0].tabs.map((x) => x.title) : null,
      });
    }) : null;
    S.stop = () => { S.running = false; ro.disconnect(); if (qunsub) qunsub(); for (const type of ['dragstart', 'drop', 'dragend']) document.removeEventListener(type, onMark, true); };
  })()`);
}

interface QueryWrite {
  t: number;
  action: string | null;
  w0: string[] | null;
}

async function readFrames(cdp: RawCdp): Promise<{ frames: Frame[]; marks: FrameMark[]; qlog: QueryWrite[] }> {
  const raw = await cdp.evaluate<string>(`(() => { const S = globalThis.__fs; if (S && S.stop) S.stop(); return JSON.stringify({ frames: S ? S.frames : [], marks: S ? S.marks : [], qlog: S ? S.qlog || [] : [] }); })()`);
  const parsed = JSON.parse(raw) as { frames: Frame[]; marks: FrameMark[]; qlog: QueryWrite[] };
  const drop = parsed.marks.find((m) => m.type === 'drop') ?? parsed.marks.find((m) => m.type === 'dragend');
  if (drop && parsed.qlog.length) {
    console.log('[query-writes] groups cache writes relative to the drop:');
    for (const q of parsed.qlog) {
      console.log(`   ${q.t - drop.t >= 0 ? '+' : ''}${Math.round(q.t - drop.t)}ms ${q.action} w0=${JSON.stringify(q.w0)}`);
    }
  }
  return parsed;
}

function fmtFrame(f: Frame, rel: number): string {
  const rows = f.rows
    .map((r) => `${r.l}@${r.top}${r.h === 0 ? '(h0)' : ''}${r.tf ? `[${r.tf.replace('translate3d', 't3d').replace(/px/g, '')}]` : ''}${r.vis === 'hidden' ? '(hid)' : ''}${r.anim ? `(anim${r.anim})` : ''}`)
    .join(' ');
  return `#${String(f.n).padStart(4)} ${rel >= 0 ? '+' : ''}${Math.round(rel)}ms ghost=${f.ghost ? 'Y' : 'n'}${f.instant ? ' instant' : ''} | ${rows} | side=${(f.side ?? []).join(',')} wins=${f.wins}`;
}

/** Screencast the popup target; returns a stop fn that writes frames near `aroundWall` and resolves their paths. */
async function startScreencast(cdp: RawCdp): Promise<(aroundWall: number, name: string) => Promise<string[]>> {
  const shots: { wall: number; data: string }[] = [];
  const off = cdp.on('Page.screencastFrame', (p) => {
    const meta = p.metadata as { timestamp?: number };
    shots.push({ wall: Math.round((meta.timestamp ?? 0) * 1000), data: p.data as string });
    void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId as number }).catch(() => {});
  });
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return async (aroundWall: number, name: string) => {
    await cdp.send('Page.stopScreencast').catch(() => {});
    off();
    const outDir = path.resolve(here, `../test-results/repro/${name}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const paths: string[] = [];
    const near = shots.filter((s) => s.wall >= aroundWall - 250 && s.wall <= aroundWall + 600);
    near.forEach((s, i) => {
      const rel = s.wall - aroundWall;
      const p = path.join(outDir, `${String(i).padStart(2, '0')}_${rel >= 0 ? 'p' : 'm'}${Math.abs(rel)}ms.png`);
      fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
      paths.push(p);
    });
    console.log(`[screencast] ${shots.length} frames total, ${near.length} within [-250ms, +600ms] of the drop → ${outDir}`);
    return paths;
  };
}

/**
 * Analyse the frames around the drop. `finalOrder` = committed order (DOM order of
 * the sampled rows once settled); `moved` = label of the dragged item.
 */
function analyzeDropFrames(frames: Frame[], marks: FrameMark[], moved: string) {
  const drop = marks.find((m) => m.type === 'drop') ?? marks.find((m) => m.type === 'dragend');
  if (!drop) throw new Error('no drop/dragend mark recorded');
  const idx = frames.findIndex((f) => f.t >= drop.t);
  const settled = frames[frames.length - 1];
  const finalTop = new Map(settled.rows.map((r) => [r.l, r.top]));
  const finalOrder = settled.rows.map((r) => r.l);
  const isFinal = (f: Frame) =>
    !f.ghost &&
    f.rows.length === settled.rows.length &&
    f.rows.every((r, i) => r.l === finalOrder[i] && r.top === finalTop.get(r.l) && r.h > 0 && r.vis !== 'hidden' && r.anim === 0);
  const post = frames.slice(idx);
  const firstFinal = post.findIndex(isFinal);
  const regressedAfterFinal = firstFinal >= 0 && post.slice(firstFinal).some((f) => !isFinal(f));
  const movedAtWrongSlot = post.filter((f) =>
    f.rows.some((r) => r.l === moved && r.h > 0 && r.vis !== 'hidden' && r.top !== finalTop.get(moved))
  );
  const midTransition = post.filter((f) => f.rows.some((r) => r.anim > 0));
  const ghostGoneAt = post.findIndex((f) => !f.ghost);
  const movedVisibleAtDestAt = post.findIndex((f) =>
    f.rows.some((r) => r.l === moved && r.h > 0 && r.vis !== 'hidden' && r.top === finalTop.get(moved))
  );
  console.log(`[drop-frames] drop @t=${drop.t} (frame index ${idx}); finalOrder=${JSON.stringify(finalOrder)}`);
  for (const f of frames.slice(Math.max(0, idx - 3), idx + 21)) console.log('   ', fmtFrame(f, f.t - drop.t));
  const verdict = {
    framesToFinal: firstFinal,
    regressedAfterFinal,
    framesMovedItemAtWrongSlot: movedAtWrongSlot.length,
    framesWithRunningTransition: midTransition.length,
    ghostGoneAtPostFrame: ghostGoneAt,
    movedVisibleAtDestAtPostFrame: movedVisibleAtDestAt
  };
  console.log('[drop-frames] verdict', JSON.stringify(verdict));
  return { ...verdict, finalOrder, dropWall: drop.wall };
}

test('real popup — DROP FRAMES: new order, ghost removal and source-at-destination land in ONE paint; no sibling transition', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0);
    const g2 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 2);
    await installFrameSampler(cdp, '[data-window-index="0"] [role="listitem"]');
    const stopCast = await startScreencast(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) }, { x: Math.round(g2.x + g2.w / 2), y: Math.round(g2.y + g2.h - 2) });
    await sleep(600);
    const { frames, marks } = await readFrames(cdp);
    const v = analyzeDropFrames(frames, marks, 'Alpha');
    await stopCast(v.dropWall, 'drop-frames-tab');
    printLog('DROP FRAMES tab', await readLog(cdp));
    const after = await idbGroup(cdp, 'work');
    expect(after.windows[0].tabs).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(v.finalOrder).toEqual(['Bravo', 'Charlie', 'Alpha']);
    // Final layout within 1 frame of the drop, and it never regresses afterwards.
    expect(v.framesToFinal).toBeGreaterThanOrEqual(0);
    expect(v.framesToFinal).toBeLessThanOrEqual(1);
    expect(v.regressedAfterFinal).toBe(false);
    // No frame shows the moved item visible anywhere but its destination.
    expect(v.framesMovedItemAtWrongSlot).toBe(0);
    // No sibling mid-transition after the drop.
    expect(v.framesWithRunningTransition).toBe(0);
    // Ghost removed in the same frame the item appears at its destination.
    expect(v.ghostGoneAtPostFrame).toBe(v.movedVisibleAtDestAtPostFrame);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE COLLAPSE — the dragged row leaves the layout; the insertion gap (the
// dragged item's height) sits at the pointer, in the home list or a foreign list;
// the drop lands exactly in the gap; release-in-place restores the row.
// ─────────────────────────────────────────────────────────────────────────────

interface GeoRow {
  l: string;
  top: number;
  h: number;
  layoutTop: number;
  anim: number;
}

/** Visual + layout (transform-stripped) geometry of the rows matching `sel`. */
async function geometry(cdp: RawCdp, sel: string): Promise<GeoRow[]> {
  return cdp.evaluate<GeoRow[]>(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((r) => {
    const rc = r.getBoundingClientRect();
    const tf = getComputedStyle(r).transform;
    const dy = tf && tf !== 'none' ? new DOMMatrixReadOnly(tf).m42 : 0;
    const name = (r.getAttribute('aria-label') || r.textContent || '').trim().split(' ')[0];
    return { l: name, top: Math.round(rc.top), h: Math.round(rc.height), layoutTop: Math.round(rc.top - dy),
      anim: r.getAnimations().filter((a) => a.playState === 'running').length };
  })`);
}

/**
 * For a list of equal-height rows, find `k` such that the visible rows sit at
 * `start + i*h (+h if i >= k)` — i.e. the gap is before visible row k (k === n →
 * no gap inside the list / gap after the last row). -1 = no consistent layout.
 */
function inferGap(rows: GeoRow[], h: number): { k: number; start: number } {
  const start = Math.min(...rows.map((r) => r.layoutTop));
  const visible = rows.filter((r) => r.h > 0);
  for (let k = 0; k <= visible.length; k++) {
    if (visible.every((r, i) => Math.abs(r.top - (start + i * h + (i >= k ? h : 0))) <= 2)) return { k, start };
  }
  return { k: -1, start };
}

async function mouse(cdp: RawCdp, type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', p: { x: number; y: number }) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: p.x,
    y: p.y,
    button: type === 'mouseMoved' ? 'left' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: type === 'mouseMoved' ? 0 : 1
  });
}
async function pressAndLift(cdp: RawCdp, p: { x: number; y: number }) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
  await mouse(cdp, 'mousePressed', p);
  // Must travel past Chrome's native drag threshold (~4px) or no dragstart fires.
  for (let i = 1; i <= 3; i++) {
    await mouse(cdp, 'mouseMoved', { x: p.x, y: p.y + i * 4 });
    await sleep(40);
  }
  await mouse(cdp, 'mouseMoved', p);
  await sleep(40);
}
async function glide(cdp: RawCdp, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  for (let i = 1; i <= steps; i++) {
    await mouse(cdp, 'mouseMoved', {
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps)
    });
    await sleep(40);
  }
}
/** Hold at `p` with 1px jitter (keeps the throttled dragover stream alive) so transitions settle. */
async function dwell(cdp: RawCdp, p: { x: number; y: number }, ms = 450) {
  for (let i = 0; i < Math.ceil(ms / 80); i++) {
    await mouse(cdp, 'mouseMoved', { x: p.x + (i % 2 ? 1 : 0), y: p.y });
    await sleep(80);
  }
}
const gapHolds = (g: { k: number; start: number }, h: number, y: number) => {
  const top = g.start + g.k * h;
  return y >= top - 2 && y <= top + h + 2;
};

test('real popup — SOURCE COLLAPSE (tab): row leaves the layout, gap follows the pointer across lists, drop lands in the gap in one paint', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const W0 = '[data-window-index="0"] [role="listitem"]';
    const W1 = '[data-window-index="1"] [role="listitem"]';
    const before0 = await geometry(cdp, W0);
    const h = before0[0].h;
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // Alpha
    const p0 = { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) };
    await installFrameSampler(cdp, W0);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    // S0 — picked up, pointer at the pickup point
    await pressAndLift(cdp, p0);
    await mouse(cdp, 'mouseMoved', p0);
    await dwell(cdp, p0);
    const s0w0 = await geometry(cdp, W0);
    const s0w1 = await geometry(cdp, W1);
    const s0g = inferGap(s0w0, h);
    console.log('[collapse] S0 w0', JSON.stringify(s0w0), 'gap', JSON.stringify(s0g), ' w1', JSON.stringify(s0w1));
    expect(s0w0.find((r) => r.l === 'Alpha')!.h).toBe(0); // out of the layout, not a hidden slot
    expect(s0g.k).toBe(0);
    expect(gapHolds(s0g, h, p0.y)).toBe(true);
    expect(inferGap(s0w1, h).k).toBe(s0w1.length); // foreign list untouched

    // S1 — over Charlie's lower half (home list) → gap after Charlie, where the pointer is
    const charlie = s0w0.find((r) => r.l === 'Charlie')!;
    const p1 = { x: p0.x, y: charlie.top + Math.round(h / 2) };
    await glide(cdp, p0, p1);
    await dwell(cdp, p1);
    const s1w0 = await geometry(cdp, W0);
    const s1g = inferGap(s1w0, h);
    console.log('[collapse] S1 w0', JSON.stringify(s1w0), 'gap', JSON.stringify(s1g), 'pointerY', p1.y);
    expect(s1g.k).toBe(2);
    expect(gapHolds(s1g, h, p1.y)).toBe(true);

    // S2 — into window 1, top of Delta → home list closes up, gap opens before Delta
    const s1w1 = await geometry(cdp, W1);
    const p2 = { x: p0.x, y: Math.min(...s1w1.map((r) => r.layoutTop)) + 6 };
    await glide(cdp, p1, p2);
    await dwell(cdp, p2);
    const s2w0 = await geometry(cdp, W0);
    const s2w1 = await geometry(cdp, W1);
    const s2g1 = inferGap(s2w1, h);
    console.log('[collapse] S2 w0', JSON.stringify(s2w0), ' w1', JSON.stringify(s2w1), 'gap1', JSON.stringify(s2g1), 'pointerY', p2.y);
    expect(inferGap(s2w0, h).k).toBe(2); // Bravo, Charlie contiguous — nothing left behind
    // When the home list closes up, window 1 moves up by h under a stationary pointer,
    // so the slot under the pointer can shift by one — assert the gap is AT the pointer.
    expect(s2g1.k).toBeGreaterThanOrEqual(0);
    expect(gapHolds(s2g1, h, p2.y)).toBe(true);

    // S3 — back to the top of the home list → gap before Bravo; window 1 closes again
    const p3 = { x: p0.x, y: inferGap(s2w0, h).start + 6 };
    await glide(cdp, p2, p3);
    await dwell(cdp, p3);
    const s3w0 = await geometry(cdp, W0);
    const s3w1 = await geometry(cdp, W1);
    const s3g = inferGap(s3w0, h);
    console.log('[collapse] S3 w0', JSON.stringify(s3w0), 'gap', JSON.stringify(s3g), ' w1', JSON.stringify(s3w1));
    expect(s3g.k).toBe(0);
    expect(gapHolds(s3g, h, p3.y)).toBe(true);
    expect(inferGap(s3w1, h).k).toBe(s3w1.length);

    // S4 — below Charlie → gap at the end; release there
    const p4 = { x: p0.x, y: s3g.start + 2 * h + Math.round(h * 0.75) };
    await glide(cdp, p3, p4);
    await dwell(cdp, p4);
    const s4g = inferGap(await geometry(cdp, W0), h);
    expect(s4g.k).toBe(2);
    await mouse(cdp, 'mouseReleased', p4);
    await sleep(700);

    const log = await readLog(cdp);
    printLog('SOURCE COLLAPSE tab', log);
    const names = stageNames(log);
    expect(names).toEqual(expect.arrayContaining(['html5:dragstart', 'html5:collapse', 'html5:drop', 'onDragEnd', 'committed']));
    expect(log.find(([, s]) => s === 'html5:dragend')?.[2]).toEqual({ dropEffect: 'move' });

    const { frames, marks } = await readFrames(cdp);
    const v = analyzeDropFrames(frames, marks, 'Alpha');
    const after = await idbGroup(cdp, 'work');
    expect(after.windows[0].tabs).toEqual(['Bravo', 'Charlie', 'Alpha']); // exactly where the gap was
    expect(v.framesToFinal).toBeGreaterThanOrEqual(0);
    expect(v.framesToFinal).toBeLessThanOrEqual(1);
    expect(v.framesMovedItemAtWrongSlot).toBe(0);
    expect(v.framesWithRunningTransition).toBe(0);
    expect(v.ghostGoneAtPostFrame).toBe(v.movedVisibleAtDestAtPostFrame);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — SOURCE COLLAPSE (window + group) close up and commit into the gap; release-in-place restores the row with no move', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder window"]').length`), { timeout: 5_000 }).toBe(2);

    // ── release in place (tab) — no move, row back exactly where it was ─────────
    const W0 = '[data-window-index="0"] [role="listitem"]';
    const tabsBefore = await geometry(cdp, W0);
    const gt = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0);
    const pt = { x: Math.round(gt.x + gt.w / 2), y: Math.round(gt.y + gt.h / 2) };
    await installFrameSampler(cdp, W0);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await pressAndLift(cdp, pt);
    await mouse(cdp, 'mouseMoved', pt);
    await dwell(cdp, pt);
    expect((await geometry(cdp, W0)).find((r) => r.l === 'Alpha')!.h).toBe(0);
    await mouse(cdp, 'mouseReleased', pt);
    await sleep(600);
    const inPlace = await readFrames(cdp);
    const vIn = analyzeDropFrames(inPlace.frames, inPlace.marks, 'Alpha');
    const tabsAfter = await geometry(cdp, W0);
    console.log('[collapse] release-in-place before', JSON.stringify(tabsBefore), 'after', JSON.stringify(tabsAfter));
    expect(tabsAfter.map((r) => [r.l, r.top, r.h])).toEqual(tabsBefore.map((r) => [r.l, r.top, r.h]));
    expect((await idbGroup(cdp, 'work')).windows[0].tabs).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(stageNames(await readLog(cdp))).not.toContain('committed');
    expect(vIn.framesToFinal).toBeLessThanOrEqual(1);
    expect(vIn.framesWithRunningTransition).toBe(0);

    // ── window drag ──────────────────────────────────────────────────────────────
    const WIN = '[data-window-index]:not([role])';
    const winBefore = await geometry(cdp, WIN);
    const w0 = await box(cdp, '[aria-label^="Drag to reorder window"]', 0);
    const pw = { x: Math.round(w0.x + w0.w / 2), y: Math.round(w0.y + w0.h / 2) };
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await pressAndLift(cdp, pw);
    await mouse(cdp, 'mouseMoved', pw);
    await dwell(cdp, pw);
    const winS0 = await geometry(cdp, WIN);
    console.log('[collapse] window S0', JSON.stringify(winBefore), '→', JSON.stringify(winS0));
    expect(winS0[0].h).toBe(0);
    expect(Math.abs(winS0[1].top - winBefore[1].top)).toBeLessThanOrEqual(2); // gap at pickup: W1 not moved
    const pw2 = { x: pw.x, y: winBefore[1].top + winBefore[1].h - 6 };
    await glide(cdp, pw, pw2);
    await dwell(cdp, pw2);
    const winS1 = await geometry(cdp, WIN);
    console.log('[collapse] window S1', JSON.stringify(winS1));
    expect(Math.abs(winS1[1].top - winBefore[0].top)).toBeLessThanOrEqual(2); // W1 closed up into W0's place
    await mouse(cdp, 'mouseReleased', pw2);
    await sleep(700);
    printLog('SOURCE COLLAPSE window', await readLog(cdp));
    expect((await idbGroup(cdp, 'work')).windows.map((w) => w.tabs[0])).toEqual(['Delta', 'Alpha']);

    // ── group drag ───────────────────────────────────────────────────────────────
    const GRP = '[data-sidebar-group-index]';
    const grBefore = await geometry(cdp, GRP); // Now Open, Work, Play
    const gr0 = await box(cdp, '[aria-label^="Drag to reorder group"]', 0); // Work
    const pg = { x: Math.round(gr0.x + gr0.w / 2), y: Math.round(gr0.y + gr0.h / 2) };
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await pressAndLift(cdp, pg);
    await mouse(cdp, 'mouseMoved', pg);
    await dwell(cdp, pg);
    const grS0 = await geometry(cdp, GRP);
    console.log('[collapse] group S0', JSON.stringify(grBefore), '→', JSON.stringify(grS0));
    expect(grS0[1].h).toBe(0);
    expect(Math.abs(grS0[2].top - grBefore[2].top)).toBeLessThanOrEqual(2);
    expect(grS0[0].top).toBe(grBefore[0].top); // Now Open never shifts
    const pg2 = { x: pg.x, y: grBefore[2].top + grBefore[2].h - 4 };
    await glide(cdp, pg, pg2);
    await dwell(cdp, pg2);
    const grS1 = await geometry(cdp, GRP);
    console.log('[collapse] group S1', JSON.stringify(grS1));
    expect(Math.abs(grS1[2].top - grBefore[1].top)).toBeLessThanOrEqual(2); // Play closed up into Work's place
    await mouse(cdp, 'mouseReleased', pg2);
    await sleep(700);
    printLog('SOURCE COLLAPSE group', await readLog(cdp));
    const order = await groupOrder(cdp);
    expect(order.indexOf('play')).toBeLessThan(order.indexOf('work'));
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — Escape during a native drag (diagnostic: CDP key events may not reach the OS drag loop)', async () => {
  test.setTimeout(90_000);
  const { context, cdp } = await launch();
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const W0 = '[data-window-index="0"] [role="listitem"]';
    const before = await geometry(cdp, W0);
    const g = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0);
    const p = { x: Math.round(g.x + g.w / 2), y: Math.round(g.y + g.h / 2) };
    const p2 = { x: p.x, y: p.y + 2 * before[0].h + 10 };
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await pressAndLift(cdp, p);
    await glide(cdp, p, p2);
    await dwell(cdp, p2, 300);
    for (const type of ['rawKeyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    }
    await dwell(cdp, p2, 400);
    const midLog = stageNames(await readLog(cdp));
    const mid = await geometry(cdp, W0);
    console.log('[escape] stages after Escape (still holding):', JSON.stringify(midLog));
    console.log('[escape] rows after Escape (still holding):', JSON.stringify(mid));
    await mouse(cdp, 'mouseReleased', p2);
    await sleep(700);
    const log = await readLog(cdp);
    printLog('ESCAPE diagnostic', log);
    const after = await geometry(cdp, W0);
    console.log('[escape] rows after release:', JSON.stringify(after), ' idb:', JSON.stringify((await idbGroup(cdp, 'work')).windows[0].tabs));
    // Whatever path ended the drag, no row may be left collapsed or hidden.
    expect(after.every((r) => r.h > 0)).toBe(true);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — NOW OPEN TAB (the popup\'s own active tab) dropped on a saved group is COPIED; popup survives, no real tab closed', async () => {
  test.setTimeout(120_000);
  await nowOpenCopyDrag('tab');
});

test('real popup — NOW OPEN WINDOW dropped on a saved group is COPIED; popup survives, real window stays open', async () => {
  test.setTimeout(120_000);
  await nowOpenCopyDrag('window');
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 (spec §6 deltas)
//  A. A picked-up GROUP becomes the active group mid-drag; the selection follows the
//     reorder in the same paint, and the persisted index lands the reopened popup on it.
//  B. A drop on a sidebar GROUP ROW adds a NEW window. The source list, BOTH sidebar
//     badges, and a visible destination update in ONE paint. On the Now Open row it
//     opens a new REAL window (unfocused); the popup survives.
// ─────────────────────────────────────────────────────────────────────────────

const TAB_GRIP = '[aria-label^="Drag to reorder tab"]';
const WIN_GRIP = '[aria-label^="Drag to reorder window"]';
const GROUP_GRIP = '[aria-label^="Drag to reorder group"]';
const WORK_TABS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
const center = (b: { x: number; y: number; w: number; h: number }) => ({
  x: Math.round(b.x + b.w / 2),
  y: Math.round(b.y + b.h / 2)
});

/**
 * Sidebar badges + panel window count around the drop: the pre-drop value, the settled
 * value, the first post-drop frame showing the settled value, and whether it regressed.
 */
function analyzeSideFrames(frames: Frame[], marks: FrameMark[]) {
  const drop = marks.find((m) => m.type === 'drop') ?? marks.find((m) => m.type === 'dragend');
  if (!drop) throw new Error('no drop/dragend mark recorded');
  const idx = frames.findIndex((f) => f.t >= drop.t);
  const settled = frames[frames.length - 1];
  const same = (f: Frame) => JSON.stringify(f.side) === JSON.stringify(settled.side) && f.wins === settled.wins;
  const post = frames.slice(idx);
  const first = post.findIndex(same);
  const before = frames[Math.max(0, idx - 1)];
  const verdict = {
    sideBefore: before?.side ?? [],
    winsBefore: before?.wins ?? -1,
    sideFinal: settled.side,
    winsFinal: settled.wins,
    sideFramesToFinal: first,
    sideRegressedAfterFinal: first >= 0 && post.slice(first).some((f) => !same(f))
  };
  console.log('[side-frames] verdict', JSON.stringify(verdict));
  return verdict;
}

/** Liveness probe bounded by a timer — `RawCdp.send` hangs forever against a dismissed popup. */
async function probeAlive(cdp: RawCdp, tag: string, ms = 5_000): Promise<number | null> {
  let settled = false;
  return Promise.race([
    rootAliveOrNull(cdp).finally(() => {
      settled = true;
    }),
    sleep(ms).then(() => {
      if (!settled) console.log(`[${tag}] liveness probe got NO answer in ${ms}ms — popup target gone`);
      return null;
    })
  ]);
}

async function normalWindows(context: BrowserContext): Promise<{ id: number; focused: boolean; urls: string[] }[]> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  return sw.evaluate(async () =>
    (await chrome.windows.getAll({ populate: true }))
      .filter((w) => w.type === 'normal')
      .map((w) => ({
        id: w.id ?? -1,
        focused: !!w.focused,
        urls: (w.tabs ?? []).map((t) => (t as { pendingUrl?: string }).pendingUrl || t.url || '')
      }))
  );
}

async function idbSetting(cdp: RawCdp, key: string): Promise<unknown> {
  return cdp.evaluate<unknown>(
    `new Promise(resolve => {
       const req = indexedDB.open('tabmerger', 1);
       req.onsuccess = () => {
         req.result.transaction('settings', 'readonly').objectStore('settings').get(${JSON.stringify(key)}).onsuccess =
           (e) => resolve(e.target.result ? e.target.result.value : null);
       };
     })`
  );
}

async function idbStateActive(cdp: RawCdp): Promise<unknown> {
  return cdp.evaluate<unknown>(
    `new Promise(resolve => {
       const req = indexedDB.open('tabmerger', 1);
       req.onsuccess = () => {
         req.result.transaction('groupsState', 'readonly').objectStore('groupsState').get('state').onsuccess =
           (e) => resolve(e.target.result ? e.target.result.active : null);
       };
     })`
  );
}

const panelTabs = (cdp: RawCdp) =>
  cdp.evaluate<string[]>(`[...document.querySelectorAll('main [role="listitem"]')].map((r) => r.getAttribute('aria-label'))`);

/** Shared single-paint assertions for a drop that REMOVES `moved` from the sampled source list. */
function expectSourceListInstant(v: ReturnType<typeof analyzeDropFrames>) {
  expect(v.framesToFinal).toBeGreaterThanOrEqual(0);
  expect(v.framesToFinal).toBeLessThanOrEqual(1);
  expect(v.regressedAfterFinal).toBe(false);
  expect(v.framesMovedItemAtWrongSlot).toBe(0); // the moved item never re-appears in the source
  expect(v.framesWithRunningTransition).toBe(0);
}

test('real popup — INSTANT RELOAD: cross-group TAB → another group ROW lands as a NEW window; source list + BOTH sidebar badges update in ONE paint', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${TAB_GRIP}').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const from = center(await box(cdp, TAB_GRIP, 0)); // Alpha
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    await installFrameSampler(cdp, '[data-window-index="0"] [role="listitem"]');
    const stopCast = await startScreencast(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, from, center(playRow!));
    await sleep(600);
    const { frames, marks } = await readFrames(cdp);
    const v = analyzeDropFrames(frames, marks, 'Alpha');
    const sv = analyzeSideFrames(frames, marks);
    const shots = await stopCast(v.dropWall, 'instant-reload-tab-to-group-row');
    console.log('[instant-reload tab] screencast frames:', shots.map((p) => path.basename(p)).join(' '));
    const log = await readLog(cdp);
    printLog('INSTANT RELOAD tab → group row', log);

    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:dragstart', 'html5:drop', 'onDragEnd', 'committed']));
    expect((log.find(([, s]) => s === 'committed')![2] as { undoable?: boolean }).undoable).toBe(true);
    const work = await idbGroup(cdp, 'work');
    const play = await idbGroup(cdp, 'play');
    console.log('[instant-reload tab] IDB work', JSON.stringify(work.windows.map((w) => w.tabs)), 'play', JSON.stringify(play.windows.map((w) => w.tabs)));
    expect(work.windows.map((w) => w.tabs)).toEqual([['Bravo', 'Charlie'], ['Delta', 'Echo']]);
    expect(play.windows.map((w) => w.tabs)).toEqual([['Foxtrot'], ['Alpha']]);

    expect(v.finalOrder).toEqual(['Bravo', 'Charlie']);
    expectSourceListInstant(v);
    expect(sv.sideBefore).toEqual(expect.arrayContaining(['Work2◆5', 'Play1◆1']));
    expect(sv.sideFinal).toEqual(expect.arrayContaining(['Work2◆4', 'Play2◆2']));
    expect(sv.sideFramesToFinal).toBe(v.framesToFinal); // badges change on the SAME frame as the list
    expect(sv.sideRegressedAfterFinal).toBe(false);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — INSTANT RELOAD: TAB dwelled on another group ROW (spring-open shows it) and released there → the NEW window appears in the visible destination in ONE paint', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${TAB_GRIP}').length`), { timeout: 5_000 }).toBeGreaterThan(2);
    const from = center(await box(cdp, TAB_GRIP, 0)); // Alpha
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    const to = center(playRow!);
    await installFrameSampler(cdp, 'main [role="listitem"]');
    const stopCast = await startScreencast(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    await pressAndLift(cdp, from);
    await glide(cdp, from, to, 10);
    await dwell(cdp, to, 1_000); // > SPRING_OPEN_MS (600)
    const mid = await panelTabs(cdp);
    console.log('[instant-reload spring] panel mid-drag:', JSON.stringify(mid));
    expect(mid).toEqual(['Foxtrot']); // the destination is what's visible while still dragging
    await mouse(cdp, 'mouseReleased', to);
    await sleep(700);

    const { frames, marks } = await readFrames(cdp);
    const v = analyzeDropFrames(frames, marks, 'Alpha');
    const sv = analyzeSideFrames(frames, marks);
    const shots = await stopCast(v.dropWall, 'instant-reload-spring-open-destination');
    console.log('[instant-reload spring] screencast frames:', shots.map((p) => path.basename(p)).join(' '));
    const log = await readLog(cdp);
    printLog('INSTANT RELOAD tab → sprung-open group row', log);
    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:drop', 'onDragEnd', 'committed']));
    expect((await idbGroup(cdp, 'play')).windows.map((w) => w.tabs)).toEqual([['Foxtrot'], ['Alpha']]);
    expect((await idbGroup(cdp, 'work')).windows.map((w) => w.tabs)).toEqual([['Bravo', 'Charlie'], ['Delta', 'Echo']]);

    expect(v.finalOrder).toEqual(['Foxtrot', 'Alpha']);
    expect(v.framesToFinal).toBeGreaterThanOrEqual(0);
    expect(v.framesToFinal).toBeLessThanOrEqual(1);
    expect(v.regressedAfterFinal).toBe(false);
    expect(v.framesMovedItemAtWrongSlot).toBe(0);
    expect(v.framesWithRunningTransition).toBe(0);
    expect(v.ghostGoneAtPostFrame).toBe(v.movedVisibleAtDestAtPostFrame); // ghost out, item in: same frame
    expect(sv.winsBefore).toBe(1);
    expect(sv.winsFinal).toBe(2); // the NEW window card
    expect(sv.sideBefore).toEqual(expect.arrayContaining(['Work2◆5', 'Play1◆1']));
    expect(sv.sideFinal).toEqual(expect.arrayContaining(['Work2◆4', 'Play2◆2']));
    expect(sv.sideFramesToFinal).toBe(v.framesToFinal);
    expect(sv.sideRegressedAfterFinal).toBe(false);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — INSTANT RELOAD: WINDOW → another group ROW becomes its new last window; the source window leaves the panel + both badges update in ONE paint', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${WIN_GRIP}').length`), { timeout: 5_000 }).toBe(2);
    const from = center(await box(cdp, WIN_GRIP, 0)); // window [Alpha, Bravo, Charlie]
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    await installFrameSampler(cdp, 'main [role="listitem"]');
    const stopCast = await startScreencast(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, from, center(playRow!));
    await sleep(600);
    const { frames, marks } = await readFrames(cdp);
    const v = analyzeDropFrames(frames, marks, 'Alpha');
    const sv = analyzeSideFrames(frames, marks);
    const shots = await stopCast(v.dropWall, 'instant-reload-window-to-group-row');
    console.log('[instant-reload window] screencast frames:', shots.map((p) => path.basename(p)).join(' '));
    const log = await readLog(cdp);
    printLog('INSTANT RELOAD window → group row', log);

    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:drop', 'onDragEnd', 'committed']));
    expect((log.find(([, s]) => s === 'committed')![2] as { undoable?: boolean }).undoable).toBe(true);
    expect((await idbGroup(cdp, 'work')).windows.map((w) => w.tabs)).toEqual([['Delta', 'Echo']]);
    expect((await idbGroup(cdp, 'play')).windows.map((w) => w.tabs)).toEqual([['Foxtrot'], ['Alpha', 'Bravo', 'Charlie']]);

    expect(v.finalOrder).toEqual(['Delta', 'Echo']);
    expectSourceListInstant(v);
    expect(v.framesMovedItemAtWrongSlot).toBe(0);
    expect(sv.winsBefore).toBe(2);
    expect(sv.winsFinal).toBe(1);
    expect(sv.sideBefore).toEqual(expect.arrayContaining(['Work2◆5', 'Play1◆1']));
    expect(sv.sideFinal).toEqual(expect.arrayContaining(['Work1◆2', 'Play2◆4']));
    expect(sv.sideFramesToFinal).toBe(v.framesToFinal);
    expect(sv.sideRegressedAfterFinal).toBe(false);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

/** A SAVED tab / window dropped on the Now Open ROW → a new REAL unfocused window; the popup must survive. */
async function savedOntoNowOpenRow(kind: 'tab' | 'window') {
  const { context, cdp } = await launch({ hostUrl: liveUrl('LiveHost') });
  const tag = `saved ${kind} → Now Open row`;
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    const grip = kind === 'tab' ? TAB_GRIP : WIN_GRIP;
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${grip}').length`), { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
    const from = center(await box(cdp, grip, 0));
    const nowOpenRow = await rowBoxByText(cdp, 'Now Open');
    expect(nowOpenRow).not.toBeNull();
    const winsBefore = await normalWindows(context);
    const tabsBefore = await browserTabs(context);
    console.log(`[${tag}] real windows before:`, JSON.stringify(winsBefore));

    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, from, center(nowOpenRow!));
    await sleep(1_500); // chrome.windows.create runs after the IDB write

    const rootAfter = await probeAlive(cdp, tag);
    console.log(`[${tag}] rootAfter=`, rootAfter);
    expect(rootAfter).not.toBeNull(); // CDP target alive
    expect(rootAfter).toBeGreaterThan(0); // #root still mounted

    const log = await readLog(cdp);
    printLog(tag.toUpperCase(), log);
    const { consoleErrors, pageErrors } = await readErrors(cdp);
    console.log(`[${tag}] consoleErrors=`, JSON.stringify(consoleErrors), ' pageErrors=', JSON.stringify(pageErrors));
    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:drop', 'onDragEnd', 'committed']));
    expect((log.find(([, s]) => s === 'committed')![2] as { undoable?: boolean }).undoable).toBe(false);
    expect(pageErrors).toEqual([]);

    const winsAfter = await normalWindows(context);
    const created = winsAfter.filter((w) => !winsBefore.some((b) => b.id === w.id));
    console.log(`[${tag}] real windows after:`, JSON.stringify(winsAfter), ' created:', JSON.stringify(created));
    expect(created).toHaveLength(1); // exactly ONE new real browser window
    const expected = kind === 'tab' ? ['alpha'] : ['alpha', 'bravo', 'charlie'];
    expect(created[0].urls).toHaveLength(expected.length);
    expected.forEach((name, i) => expect(created[0].urls[i]).toContain(`example.com/${name}`));

    const tabsAfter = await browserTabs(context);
    expect(tabsBefore.every((b) => tabsAfter.some((a) => a.id === b.id))).toBe(true); // nothing closed

    const work = await idbGroup(cdp, 'work');
    console.log(`[${tag}] IDB work after:`, JSON.stringify(work.windows.map((w) => w.tabs)));
    expect(work.windows.map((w) => w.tabs)).toEqual(kind === 'tab' ? [['Bravo', 'Charlie'], ['Delta', 'Echo']] : [['Delta', 'Echo']]);
    // still interactive after the new window opened: the source badge re-rendered
    const side = await cdp.evaluate<string[]>(`[...document.querySelectorAll('[data-sidebar-group-index]')].map((r) => (r.textContent || '').replace(/\\s+/g, ''))`);
    expect(side).toContain(kind === 'tab' ? 'Work2◆4' : 'Work1◆2');
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
}

test('real popup — SAVED TAB dropped on the Now Open ROW opens a NEW real window (unfocused); popup survives', async () => {
  test.setTimeout(120_000);
  await savedOntoNowOpenRow('tab');
});

test('real popup — SAVED WINDOW dropped on the Now Open ROW opens a NEW real window with its tabs (unfocused); popup survives', async () => {
  test.setTimeout(120_000);
  await savedOntoNowOpenRow('window');
});

test('real popup — DIAGNOSTIC (no assertion on the focused case): does a FOCUSED chrome.windows.create from the popup dismiss it in this harness?', async () => {
  test.setTimeout(90_000);
  const { context, cdp } = await launch({ hostUrl: liveUrl('LiveHost') });
  try {
    const before = await probeAlive(cdp, 'focus-diag');
    await cdp.evaluate(`chrome.windows.create({ url: 'about:blank', focused: false }); 1`);
    await sleep(1_500);
    const afterUnfocused = await probeAlive(cdp, 'focus-diag');
    // Fire-and-forget: if this dismisses the popup, an awaited evaluate would never return.
    void cdp.evaluate(`chrome.windows.create({ url: 'about:blank', focused: true }); 1`).catch(() => {});
    await sleep(1_500);
    const afterFocused = await probeAlive(cdp, 'focus-diag');
    console.log('[focus-diagnostic]', JSON.stringify({ before, afterUnfocused, afterFocused }));
    console.log(
      afterFocused === null
        ? '[focus-diagnostic] a FOCUSED new window DISMISSES the popup here → focused:false is load-bearing and the Now Open row tests prove it'
        : '[focus-diagnostic] a focused new window did NOT dismiss the popup in this headless harness → the Now Open row tests cannot distinguish focused:true from false; the unit tests pin focused:false'
    );
    expect(afterUnfocused).toBeGreaterThan(0);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-ITEM DRAG (rbd multi-drag pattern). Ctrl/Shift clicks are ordinary page
// clicks → `Input.dispatchMouseEvent` with `modifiers` (Ctrl=2, Shift=8). The drag
// itself follows the usual harness rules (press on a grip, first move >4px, paced).
// ─────────────────────────────────────────────────────────────────────────────

const MOD_CTRL = 2;
const MOD_SHIFT = 8;
const MULTI_WORK = {
  id: 'work',
  name: 'Work',
  windows: [
    { id: 1, incognito: false, focused: false, tabs: [tab('Alpha'), tab('Bravo'), tab('Charlie')] },
    { id: 2, incognito: false, focused: false, tabs: [tab('Delta'), tab('Echo')] },
    { id: 3, incognito: false, focused: false, tabs: [tab('Golf'), tab('Hotel')] }
  ]
};
const MULTI_SEED = [NOW_OPEN, MULTI_WORK, PLAY];

async function modClick(cdp: RawCdp, p: { x: number; y: number }, modifiers: number) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0, modifiers });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
  await sleep(250);
}

/** Find a panel tab row by title (or, for a still-loading live tab, by its data-URL `<title>`). */
const ROW_BY_TITLE = (title: string) => `[...document.querySelectorAll('main [role="listitem"]')].find((r) => {
  const l = r.getAttribute('aria-label') || '';
  return l === ${JSON.stringify(title)} || l.includes('<title>' + ${JSON.stringify(title)} + '</title>');
})`;

/** A neutral click point on a tab row: its favicon (no handler of its own; the click bubbles to the row). */
async function tabRowPoint(cdp: RawCdp, title: string) {
  return cdp.evaluate<{ x: number; y: number } | null>(`(() => {
    const row = ${ROW_BY_TITLE(title)};
    const img = row && row.querySelector('img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
}
async function tabGripPoint(cdp: RawCdp, title: string) {
  return cdp.evaluate<{ x: number; y: number } | null>(`(() => {
    const row = ${ROW_BY_TITLE(title)};
    const grip = row && row.querySelector('${TAB_GRIP}');
    if (!grip) return null;
    const r = grip.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
}
async function tabRowRect(cdp: RawCdp, title: string) {
  return cdp.evaluate<{ top: number; bottom: number; left: number; right: number } | null>(`(() => {
    const row = ${ROW_BY_TITLE(title)};
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
  })()`);
}
/** Titles of the highlighted (selected) tab rows in the panel, in DOM order. */
const selectedTabLabels = (cdp: RawCdp) =>
  cdp.evaluate<string[]>(
    `[...document.querySelectorAll('main [role="listitem"]')].filter((r) => r.className.split(' ').includes('bg-primary/10')).map((r) => (r.getAttribute('aria-label') || '').replace(/^.*<title>(.*)<\\/title>.*$/, '$1'))`
  );
async function idbTabs(cdp: RawCdp, id: string) {
  return cdp.evaluate<{ title: string; id: number; savedAt: number | null }[][]>(
    `new Promise(resolve => {
       const req = indexedDB.open('tabmerger', 1);
       req.onsuccess = () => {
         req.result.transaction('groups', 'readonly').objectStore('groups').get(${JSON.stringify(id)}).onsuccess = (e) => {
           const g = e.target.result;
           resolve((g?.windows ?? []).map(w => w.tabs.map(t => ({ title: t.title, id: t.id, savedAt: t.savedAt ?? null }))));
         };
       };
     })`
  );
}
async function selectAlphaDeltaEcho(cdp: RawCdp) {
  await modClick(cdp, (await tabRowPoint(cdp, 'Alpha'))!, MOD_CTRL);
  await modClick(cdp, (await tabRowPoint(cdp, 'Delta'))!, MOD_CTRL);
  await modClick(cdp, (await tabRowPoint(cdp, 'Echo'))!, MOD_SHIFT); // range Delta → Echo
  await expect.poll(() => selectedTabLabels(cdp), { timeout: 4_000 }).toEqual(['Alpha', 'Delta', 'Echo']);
}
const logEntry = (log: [number, string, unknown][], stage: string) => log.find(([, s]) => s === stage)?.[2] as Record<string, unknown> | undefined;

test('real popup — MULTI 1: 3 tabs across 2 windows (Ctrl, Ctrl, Shift) dropped on a THIRD window: one contiguous block in order, emptied window removed, selection kept at the new positions, single paint, +N ghost', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch({ groups: MULTI_SEED });
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${TAB_GRIP}').length`), { timeout: 5_000 }).toBe(7);
    await selectAlphaDeltaEcho(cdp);

    const from = (await tabGripPoint(cdp, 'Alpha'))!;
    await installFrameSampler(cdp, 'main [role="listitem"]');
    const stopCast = await startScreencast(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await pressAndLift(cdp, from);
    await sleep(350); // the first-rAF pickup collapse has run
    const collapsedAtPickup = await cdp.evaluate<string[]>(
      `[...document.querySelectorAll('main [role="listitem"]')].filter((r) => r.getBoundingClientRect().height === 0).map((r) => r.getAttribute('aria-label'))`
    );
    // Measure the target LIVE, in two passes: the collapse moved every row below the
    // selection up, and once the gap LEAVES the home list (pointer enters the third
    // window) that list's gap growth goes too, moving the rows below up one more row.
    const hotel = (await tabRowRect(cdp, 'Hotel'))!;
    const x = Math.round((hotel.left + hotel.right) / 2);
    const approach = { x, y: hotel.top + 4 };
    await glide(cdp, from, approach);
    await dwell(cdp, approach, 400);
    const hotelLayoutTop = await cdp.evaluate<number>(`(() => {
      const r = ${ROW_BY_TITLE('Hotel')};
      const tf = getComputedStyle(r).transform;
      const dy = tf && tf !== 'none' ? new DOMMatrixReadOnly(tf).m42 : 0;
      return Math.round(r.getBoundingClientRect().top - dy);
    })()`);
    const target = { x, y: hotelLayoutTop + 4 }; // gap between Golf and Hotel
    await glide(cdp, approach, target, 3);
    await dwell(cdp, target, 500);
    // The DRAWN gap at release (row transforms) — must agree with what commits.
    const gapAtRelease = await cdp.evaluate<Record<string, string>>(`(() => Object.fromEntries(['Golf', 'Hotel'].map((t) => {
      const r = ${'[...document.querySelectorAll(\'main [role="listitem"]\')]'}.find((e) => e.getAttribute('aria-label') === t);
      return [t, r ? r.style.transform : 'missing'];
    })))()`);
    console.log('[multi-1] hotel pre-gap top', hotel.top, 'layout top in target list', hotelLayoutTop, 'drawn gap at release', JSON.stringify(gapAtRelease));
    expect(gapAtRelease.Golf).toBe('');
    expect(gapAtRelease.Hotel).toContain('24px');
    const ghost = await cdp.evaluate<{ count: string | null; stacks: number } | null>(`(() => {
      const g = document.querySelector('[data-testid="drag-ghost"]');
      return g ? { count: g.querySelector('[data-testid="drag-ghost-count"]')?.textContent ?? null, stacks: g.querySelectorAll('[data-testid="drag-ghost-stack"]').length } : null;
    })()`);
    const ghostShot = await saveShot(cdp, 'multi-1-ghost.png');
    await mouse(cdp, 'mouseReleased', target);
    await sleep(700); // keep sampling well past 300ms after the drop
    const { frames, marks } = await readFrames(cdp);
    const v = analyzeDropFrames(frames, marks, 'Alpha');
    const shots = await stopCast(v.dropWall, 'multi-1-drop');
    const log = await readLog(cdp);
    printLog('MULTI 1', log);
    console.log('[multi-1] collapsed at pickup:', JSON.stringify(collapsedAtPickup), 'ghost:', JSON.stringify(ghost), 'shot:', ghostShot, 'frames:', shots.length);

    expect([...collapsedAtPickup].sort()).toEqual(['Alpha', 'Delta', 'Echo']);
    expect(ghost).toEqual({ count: '+2', stacks: 2 });
    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:dragstart', 'onDragStart', 'html5:drop', 'onDragEnd', 'committed']));
    expect(logEntry(log, 'html5:ghost')).toMatchObject({ kind: 'tab', count: 3 });
    expect(logEntry(log, 'html5:collapse')).toMatchObject({ extra: 2 });
    expect(logEntry(log, 'committed')).toMatchObject({ undoable: true });

    const work = await idbGroup(cdp, 'work');
    console.log('[multi-1] IDB work', JSON.stringify(work.windows.map((w) => w.tabs)));
    expect(work.windows.map((w) => w.tabs)).toEqual([['Bravo', 'Charlie'], ['Golf', 'Alpha', 'Delta', 'Echo', 'Hotel']]);
    expect(v.finalOrder).toEqual(['Bravo', 'Charlie', 'Golf', 'Alpha', 'Delta', 'Echo', 'Hotel']);
    expect(v.framesToFinal).toBeGreaterThanOrEqual(0);
    expect(v.framesToFinal).toBeLessThanOrEqual(1);
    expect(v.regressedAfterFinal).toBe(false);
    expect(v.framesMovedItemAtWrongSlot).toBe(0);
    expect(v.framesWithRunningTransition).toBe(0);
    expect(await selectedTabLabels(cdp)).toEqual(['Alpha', 'Delta', 'Echo']);
    expect(await probeAlive(cdp, 'multi-1')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — MULTI 2: the same selection dropped on another group\'s SIDEBAR ROW → ONE new window holding all 3; source + badges in one paint; selection kept', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch({ groups: MULTI_SEED });
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${TAB_GRIP}').length`), { timeout: 5_000 }).toBe(7);
    await selectAlphaDeltaEcho(cdp);
    const from = (await tabGripPoint(cdp, 'Alpha'))!;
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    await installFrameSampler(cdp, 'main [role="listitem"]');
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, from, center(playRow!));
    await sleep(600);
    const { frames, marks } = await readFrames(cdp);
    const v = analyzeDropFrames(frames, marks, 'Alpha');
    const sv = analyzeSideFrames(frames, marks);
    const log = await readLog(cdp);
    printLog('MULTI 2', log);

    expect(logEntry(log, 'committed')).toMatchObject({ undoable: true, to: 'play' });
    const work = await idbGroup(cdp, 'work');
    const play = await idbGroup(cdp, 'play');
    console.log('[multi-2] IDB work', JSON.stringify(work.windows.map((w) => w.tabs)), 'play', JSON.stringify(play.windows.map((w) => w.tabs)));
    expect(play.windows.map((w) => w.tabs)).toEqual([['Foxtrot'], ['Alpha', 'Delta', 'Echo']]);
    expect(work.windows.map((w) => w.tabs)).toEqual([['Bravo', 'Charlie'], ['Golf', 'Hotel']]);
    expect(v.finalOrder).toEqual(['Bravo', 'Charlie', 'Golf', 'Hotel']);
    expectSourceListInstant(v);
    expect(sv.sideBefore).toEqual(expect.arrayContaining(['Work3◆7', 'Play1◆1']));
    expect(sv.sideFinal).toEqual(expect.arrayContaining(['Work2◆4', 'Play2◆4']));
    expect(sv.sideFramesToFinal).toBe(v.framesToFinal);
    expect(sv.sideRegressedAfterFinal).toBe(false);
    // remapped into Play (not the visible panel) — the selection bar still counts all 3
    await expect.poll(() => cdp.evaluate<boolean>(`document.body.innerText.includes('3 tabs selected')`), { timeout: 3_000 }).toBe(true);
    expect(await probeAlive(cdp, 'multi-2')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — MULTI 3: a multi-selection OUT of Now Open (incl. the popup\'s own anchor tab) dropped on a saved group is COPIED: popup survives, no real tab closed, every saved copy has id 0', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch({ hostUrl: liveUrl('LiveHost'), extraTabUrls: [liveUrl('LiveOther')] });
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Now Open');
    await expect.poll(async () => !!(await tabRowPoint(cdp, 'LiveHost')) && !!(await tabRowPoint(cdp, 'LiveOther')), { timeout: 10_000 }).toBe(true);
    await modClick(cdp, (await tabRowPoint(cdp, 'LiveHost'))!, MOD_CTRL);
    await modClick(cdp, (await tabRowPoint(cdp, 'LiveOther'))!, MOD_CTRL);
    await expect.poll(async () => (await selectedTabLabels(cdp)).length, { timeout: 4_000 }).toBe(2);

    const from = (await tabGripPoint(cdp, 'LiveHost'))!;
    const workRow = await rowBoxByText(cdp, 'Work');
    expect(workRow).not.toBeNull();
    const tabsBefore = await browserTabs(context);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, from, center(workRow!));
    await sleep(800);

    const alive = await probeAlive(cdp, 'multi-3');
    expect(alive).not.toBeNull();
    expect(alive).toBeGreaterThan(0);
    const log = await readLog(cdp);
    printLog('MULTI 3 (Now Open copy)', log);
    expect(logEntry(log, 'html5:ghost')).toMatchObject({ count: 2 });
    expect(logEntry(log, 'committed')).toMatchObject({ undoable: false });

    const work = await idbTabs(cdp, 'work');
    console.log('[multi-3] IDB work', JSON.stringify(work));
    const copied = work[work.length - 1];
    expect(copied.map((t) => t.title).sort()).toEqual(['LiveHost', 'LiveOther']);
    for (const t of work.flat()) expect(t.id).toBe(0);
    for (const t of copied) expect(typeof t.savedAt).toBe('number');

    const tabsAfter = await browserTabs(context);
    expect(tabsAfter.map((t) => t.id).sort((a, b) => a - b)).toEqual(tabsBefore.map((t) => t.id).sort((a, b) => a - b));
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — MULTI 4: dragging an UNSELECTED tab while a selection exists clears the selection and commits a single-item move', async () => {
  test.setTimeout(150_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${TAB_GRIP}').length`), { timeout: 5_000 }).toBe(5);
    await modClick(cdp, (await tabRowPoint(cdp, 'Delta'))!, MOD_CTRL);
    await modClick(cdp, (await tabRowPoint(cdp, 'Echo'))!, MOD_CTRL);
    await expect.poll(() => selectedTabLabels(cdp), { timeout: 4_000 }).toEqual(['Delta', 'Echo']);

    const g0 = await box(cdp, TAB_GRIP, 0); // Alpha (unselected)
    const g2 = await box(cdp, TAB_GRIP, 2); // Charlie
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await drive(cdp, center(g0), { x: Math.round(g2.x + g2.w / 2), y: Math.round(g2.y + g2.h - 2) });
    await sleep(600);
    const log = await readLog(cdp);
    printLog('MULTI 4 (unselected drag)', log);

    expect(stageNames(log)).toEqual(expect.arrayContaining(['html5:dragstart', 'html5:drop', 'committed']));
    expect(logEntry(log, 'html5:ghost')).toMatchObject({ count: 1 });
    expect(logEntry(log, 'html5:collapse')).toMatchObject({ extra: 0 });
    const work = await idbGroup(cdp, 'work');
    expect(work.windows.map((w) => w.tabs)).toEqual([['Bravo', 'Charlie', 'Alpha'], ['Delta', 'Echo']]);
    expect(await selectedTabLabels(cdp)).toEqual([]);
    expect(await cdp.evaluate<boolean>(`document.body.innerText.includes('selected')`)).toBe(false);
    expect(await probeAlive(cdp, 'multi-4')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — MULTI 5: selection-mode layout — every tab row shows a draggable grip AND a checkbox; nothing overflows the 800px popup', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch({ groups: MULTI_SEED });
  try {
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${TAB_GRIP}').length`), { timeout: 5_000 }).toBe(7);
    type Layout = {
      rows: { l: string | null; grip: string | null; checkbox: boolean; over: number; right: number; clusterRight: number; titleW: number }[];
      docOver: number;
      mainOver: number;
      viewport: number;
    };
    const measure = () =>
      cdp.evaluate<Layout>(`(() => {
        const rows = [...document.querySelectorAll('main [role="listitem"]')].map((r) => ({
          l: r.getAttribute('aria-label'),
          grip: r.querySelector('${TAB_GRIP}')?.getAttribute('draggable') ?? null,
          checkbox: !!r.querySelector('[role="checkbox"][aria-label^="Select "]'),
          over: r.scrollWidth - r.clientWidth,
          right: Math.round(r.getBoundingClientRect().right),
          clusterRight: Math.round(r.lastElementChild.getBoundingClientRect().right),
          titleW: Math.round(r.querySelector('.grid').firstElementChild.getBoundingClientRect().width)
        }));
        const main = document.querySelector('main');
        return { rows, docOver: document.documentElement.scrollWidth - window.innerWidth, mainOver: main.scrollWidth - main.clientWidth, viewport: window.innerWidth };
      })()`);
    // Baseline first: the headless popup viewport can be narrower than the app's fixed
    // 800px layout (measured 670px), which is pre-existing and not what this checks.
    const baseline = await measure();
    await modClick(cdp, (await tabRowPoint(cdp, 'Alpha'))!, MOD_CTRL);
    await modClick(cdp, (await tabRowPoint(cdp, 'Hotel'))!, MOD_CTRL);
    await expect.poll(() => selectedTabLabels(cdp), { timeout: 4_000 }).toEqual(['Alpha', 'Hotel']);
    await sleep(300);
    const layout = await measure();
    const shot = await saveShot(cdp, 'multi-5-selection-mode.png');
    console.log('[multi-5] baseline', JSON.stringify(baseline), '\n[multi-5] selection mode', JSON.stringify(layout), 'shot:', shot);

    expect(layout.rows).toHaveLength(7);
    layout.rows.forEach((r, i) => {
      expect(r.grip).toBe('true');
      expect(r.checkbox).toBe(true);
      expect(r.over).toBeLessThanOrEqual(0); // nothing spills out of the row
      expect(r.right).toBe(baseline.rows[i].right); // the row did not widen
      expect(r.clusterRight).toBeLessThanOrEqual(r.right); // right cluster still inside the row
      expect(r.titleW).toBe(baseline.rows[i].titleW); // title column kept its width (hostname column absorbs it)
    });
    expect(layout.docOver).toBe(baseline.docOver); // selection mode adds NO document overflow
    expect(layout.mainOver).toBeLessThanOrEqual(0);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — GROUP pickup makes it the ACTIVE group mid-drag; release-in-place keeps it; a reorder keeps the panel on it in ONE paint, persists, and the reopened popup lands on it', async () => {
  test.setTimeout(180_000);
  const { context, cdp, port } = await launch();
  let cdp2: RawCdp | null = null;
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Play'); // Play (index 2) is active; we will drag Work (index 1)
    await expect.poll(() => panelTabs(cdp), { timeout: 5_000 }).toEqual(['Foxtrot']);
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${GROUP_GRIP}').length`), { timeout: 5_000 }).toBe(2);
    const GRP = '[data-sidebar-group-index]';
    const grBefore = await geometry(cdp, GRP); // Now Open, Work, Play
    const pg = center(await box(cdp, GROUP_GRIP, 0)); // Work's grip

    // ── 1. pick Work up and hold: the panel switches to Work WHILE dragging; release in place ──
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await pressAndLift(cdp, pg);
    await mouse(cdp, 'mouseMoved', pg);
    await dwell(cdp, pg);
    const midPanel = await panelTabs(cdp);
    const midGeo = await geometry(cdp, GRP);
    console.log('[group-active] panel mid-drag:', JSON.stringify(midPanel), ' sidebar:', JSON.stringify(midGeo));
    expect(midPanel).toEqual(WORK_TABS);
    expect(midGeo[1].h).toBe(0); // the native drag is still live (source collapsed) after the panel swap
    await mouse(cdp, 'mouseReleased', pg);
    await sleep(700);
    const log1 = await readLog(cdp);
    printLog('GROUP pickup → release in place', log1);
    expect(stageNames(log1)).toEqual(expect.arrayContaining(['html5:dragstart', 'onDragStart', 'html5:collapse', 'html5:drop', 'onDragEnd']));
    expect(stageNames(log1)).not.toContain('committed');
    expect(log1.find(([, s]) => s === 'html5:dragend')?.[2]).toEqual({ dropEffect: 'move' });
    const order1 = await groupOrder(cdp);
    expect(order1.indexOf('work')).toBeLessThan(order1.indexOf('play')); // nothing moved
    expect(await panelTabs(cdp)).toEqual(WORK_TABS); // stays on the picked-up group
    expect(await idbSetting(cdp, 'activeGroupIndex')).toBe(1);

    // ── 2. back to Play; drag Work BELOW Play (a real reorder), sampling every frame ──
    await selectGroup(cdp, 'Play');
    await expect.poll(() => panelTabs(cdp), { timeout: 5_000 }).toEqual(['Foxtrot']);
    await installFrameSampler(cdp, 'main [role="listitem"]');
    const stopCast = await startScreencast(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    await pressAndLift(cdp, pg);
    await mouse(cdp, 'mouseMoved', pg);
    await dwell(cdp, pg);
    expect(await panelTabs(cdp)).toEqual(WORK_TABS); // activated at pickup
    const pg2 = { x: pg.x, y: grBefore[2].top + grBefore[2].h - 4 };
    await glide(cdp, pg, pg2);
    await dwell(cdp, pg2);
    const grS1 = await geometry(cdp, GRP);
    console.log('[group-active] sidebar over Play after the panel swap:', JSON.stringify(grS1));
    // The drag-start rect snapshot is still right after the windows panel changed:
    // Play closed up into Work's slot exactly as in the no-activation collapse test.
    expect(Math.abs(grS1[2].top - grBefore[1].top)).toBeLessThanOrEqual(2);
    await mouse(cdp, 'mouseReleased', pg2);
    await sleep(700);

    const { frames, marks } = await readFrames(cdp);
    const log2 = await readLog(cdp);
    printLog('GROUP pickup → reorder below Play', log2);
    expect(stageNames(log2)).toEqual(expect.arrayContaining(['html5:drop', 'onDragEnd', 'committed']));
    expect(log2.find(([, s]) => s === 'html5:dragend')?.[2]).toEqual({ dropEffect: 'move' });
    const order2 = await groupOrder(cdp);
    console.log('[group-active] order after:', JSON.stringify(order2));
    expect(order2.indexOf('play')).toBeLessThan(order2.indexOf('work'));

    const drop = marks.find((m) => m.type === 'drop') ?? marks.find((m) => m.type === 'dragend');
    expect(drop).toBeDefined();
    const idx = frames.findIndex((f) => f.t >= drop!.t);
    for (const f of frames.slice(Math.max(0, idx - 3), idx + 12)) console.log('   ', fmtFrame(f, f.t - drop!.t));
    const post = frames.slice(idx);
    const shots = await stopCast(drop!.wall, 'group-reorder-active-follows');
    console.log('[group-active] screencast frames:', shots.map((p) => path.basename(p)).join(' '));
    // After the reorder, index 1 holds PLAY. Had the selection followed a frame late, the
    // panel would paint Play's "Foxtrot" for that frame.
    expect(post.length).toBeGreaterThan(5);
    expect(post.filter((f) => f.rows.some((r) => r.l === 'Foxtrot'))).toHaveLength(0);
    expect(post.every((f) => JSON.stringify(f.rows.map((r) => r.l)) === JSON.stringify(WORK_TABS))).toBe(true);
    expect(post[post.length - 1].side.findIndex((t) => t.startsWith('Work'))).toBe(2);

    // All three sources of truth agree on the NEW index.
    expect(await panelTabs(cdp)).toEqual(WORK_TABS);
    expect(await cdp.evaluate<string | null>(`document.querySelector('[data-sidebar-group-index="2"]')?.getAttribute('aria-label') ?? null`)).toBe('Work');
    expect(await idbSetting(cdp, 'activeGroupIndex')).toBe(2);
    expect(await idbStateActive(cdp)).toEqual({ id: 'work', index: 2 });
    expect((await readErrors(cdp)).pageErrors).toEqual([]);

    // ── 3. close + reopen the popup → it lands on Work ──
    void cdp.evaluate(`window.close(); 1`).catch(() => {});
    await sleep(1_000);
    cdp.close();
    const [sw] = context.serviceWorkers();
    await sw.evaluate(async () => {
      await chrome.action.openPopup();
    });
    cdp2 = await RawCdp.attach(port, '/popup.html');
    await cdp2.send('Runtime.enable');
    const c2 = cdp2;
    await expect.poll(() => c2.evaluate<number>(`document.getElementById('root')?.childElementCount ?? 0`), { timeout: 8_000 }).toBeGreaterThan(0);
    await expect.poll(() => panelTabs(c2), { timeout: 8_000 }).toEqual(WORK_TABS);
    console.log('[group-active] reopened popup panel:', JSON.stringify(await panelTabs(c2)));
  } finally {
    cdp.close();
    cdp2?.close();
    await context.close().catch(() => {});
  }
});

// ─── KEYBOARD DnD (accessibility audit C1/C2/S1/S3) ──────────────────────────
// A keyboard drag has NO native drag session, so CDP key events DO reach it (C10 is
// about native drags only). Before the fix: Space on the grip bubbled to the row and
// opened the tab (dismissing the popup), and each ArrowDown switched the active group.

async function pressKey(cdp: RawCdp, code: 'Space' | 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'Escape', ms = 300) {
  const map = {
    Space: { key: ' ', vk: 32, text: ' ' },
    ArrowDown: { key: 'ArrowDown', vk: 40 },
    ArrowUp: { key: 'ArrowUp', vk: 38 },
    ArrowLeft: { key: 'ArrowLeft', vk: 37 },
    Escape: { key: 'Escape', vk: 27 }
  } as const;
  const k = map[code] as { key: string; vk: number; text?: string };
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code,
    key: k.key,
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
    ...(k.text ? { text: k.text, unmodifiedText: k.text } : {})
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k.key, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk });
  await sleep(ms);
}

test('real popup — KEYBOARD DnD: focus a tab grip, Space, ArrowDown ×2, Space → commits; popup alive; no tab opened; group never switched; focus + announcement follow the moved tab', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${TAB_GRIP}').length`), { timeout: 5_000 }).toBe(5);
    await expect.poll(() => panelTabs(cdp), { timeout: 5_000 }).toEqual(WORK_TABS);
    const activeBefore = await idbSetting(cdp, 'activeGroupIndex');
    const tabsBefore = await browserTabs(context);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    const focused = await cdp.evaluate<string | null>(`(() => {
      const grip = ${ROW_BY_TITLE('Alpha')}.querySelector('${TAB_GRIP}');
      grip.focus();
      return document.activeElement?.getAttribute('aria-label') ?? null;
    })()`);
    expect(focused).toBe('Drag to reorder tab: Alpha');

    await pressKey(cdp, 'Space'); // pick up
    const liveRegion = `(document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '')`;
    const pickup = await cdp.evaluate<string>(liveRegion);
    await pressKey(cdp, 'ArrowDown');
    await pressKey(cdp, 'ArrowDown');
    const mid = await cdp.evaluate<{ panel: string[]; alphaTransform: string; lifted: boolean }>(`(() => {
      const r = ${ROW_BY_TITLE('Alpha')};
      return {
        panel: [...document.querySelectorAll('main [role="listitem"]')].map((e) => e.getAttribute('aria-label')),
        alphaTransform: r.style.transform,
        // ring-ring (≥3:1 in both themes), not ring-primary (2.73:1 on a selected light row)
        lifted: r.className.split(' ').includes('ring-ring')
      };
    })()`);
    const midShot = await saveShot(cdp, 'keyboard-dnd-mid.png');
    await pressKey(cdp, 'Space', 900); // drop

    const log = await readLog(cdp);
    printLog('KEYBOARD DnD', log);
    // A1: dnd-kit's own region only gets a token (focus moves right after the drop and would
    // cut speech off); the full outcome lands in the app-owned region ~150ms after focus.
    const after = await cdp.evaluate<{ focus: string | null; region: string; dndKitRegion: string }>(
      `({ focus: document.activeElement?.getAttribute('aria-label') ?? null, region: ${APP_REGION}, dndKitRegion: ${liveRegion} })`
    );
    const work = await idbGroup(cdp, 'work');
    console.log('[keyboard-dnd] pickup:', JSON.stringify(pickup), ' mid:', JSON.stringify(mid), ' shot:', midShot);
    console.log('[keyboard-dnd] after:', JSON.stringify(after), ' IDB work:', JSON.stringify(work.windows.map((w) => w.tabs)));

    // committed, and IndexedDB actually reordered
    expect(stageNames(log)).toEqual(expect.arrayContaining(['onDragStart', 'onDragEnd', 'committed']));
    expect(work.windows.map((w) => w.tabs)).toEqual([['Bravo', 'Charlie', 'Alpha'], ['Delta', 'Echo']]);
    // S1: a sighted keyboard user SEES the row move (live transform + lifted style) mid-drag
    expect(mid.alphaTransform).toMatch(/translate/);
    expect(mid.lifted).toBe(true);
    // C2: arrows moved the item, not the active group
    expect(mid.panel).toEqual(WORK_TABS);
    expect(await idbSetting(cdp, 'activeGroupIndex')).toBe(activeBefore);
    // C1: no tab was opened by the Space pickup/drop, and the popup survived
    const tabsAfter = await browserTabs(context);
    expect(tabsAfter.map((t) => t.id).sort((a, b) => a - b)).toEqual(tabsBefore.map((t) => t.id).sort((a, b) => a - b));
    expect(await probeAlive(cdp, 'keyboard-dnd')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
    // S2/S3: real names in the announcements, focus on the moved tab's grip
    expect(pickup).toContain('Picked up tab Alpha');
    expect(after.region).toContain('Moved tab Alpha');
    expect(after.focus).toBe('Drag to reorder tab: Alpha');
    expect(after.dndKitRegion).toBe('Dropped.');
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

// ─── 2026-09-14 follow-ups: A2 (no spring-open on keyboard drags), A5 (focus by identity),
// #15 (look-alike permutation mid-drag cancels) ─────────────────────────────────────────

/** The app-owned assertive region (outside #root) that carries keyboard drop outcomes (A1). */
const APP_REGION = `(document.getElementById('tm-dnd-live-region')?.textContent ?? '')`;
const DNDKIT_REGION = `(document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '')`;
const FOCUS_LABEL = `(document.activeElement?.getAttribute('aria-label') ?? null)`;

async function focusGrip(cdp: RawCdp, rowExpr: string, gripSel: string): Promise<string | null> {
  return cdp.evaluate<string | null>(`(() => {
    const grip = ${rowExpr}?.querySelector('${gripSel}');
    grip?.focus();
    return ${FOCUS_LABEL};
  })()`);
}

test('real popup — KEYBOARD drag, ArrowLeft onto a SIDEBAR group row and dwell: the panel never switches, focus stays on the dragged grip (A2)', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => panelTabs(cdp), { timeout: 5_000 }).toEqual(WORK_TABS);
    const activeBefore = await idbSetting(cdp, 'activeGroupIndex');
    expect(await focusGrip(cdp, ROW_BY_TITLE('Alpha'), TAB_GRIP)).toBe('Drag to reorder tab: Alpha');

    await pressKey(cdp, 'Space');
    // Must rest on a NON-active, non-permanent group row (Play) — spring-open never arms for
    // Work (already shown) or Now Open, so anything else would prove nothing about A2.
    const overText = await walkKeyboardToSidebarRow(cdp, 'Play');
    // dwell well past the 600ms spring-open delay
    await sleep(1_500);
    const during = await cdp.evaluate<{ panel: string[]; focus: string | null }>(
      `({ panel: [...document.querySelectorAll('main [role="listitem"]')].map((e) => e.getAttribute('aria-label')), focus: ${FOCUS_LABEL} })`
    );
    await pressKey(cdp, 'Escape', 600);
    const afterCancel = await cdp.evaluate<{ focus: string | null }>(`({ focus: ${FOCUS_LABEL} })`);
    const work = await idbGroup(cdp, 'work');
    console.log('[kbd-left] over:', JSON.stringify(overText), ' during:', JSON.stringify(during), ' afterCancel:', JSON.stringify(afterCancel));

    expect(overText).toMatch(/^Over group Play, as a new window\./); // the arrows DID reach the non-active sidebar row
    expect(during.panel).toEqual(WORK_TABS); // …but the panel never switched
    expect(during.focus).toBe('Drag to reorder tab: Alpha');
    expect(await idbSetting(cdp, 'activeGroupIndex')).toBe(activeBefore);
    expect(afterCancel.focus).toBe('Drag to reorder tab: Alpha');
    expect(work.windows.map((w) => w.tabs)).toEqual([['Alpha', 'Bravo', 'Charlie'], ['Delta', 'Echo']]);
    expect(await probeAlive(cdp, 'kbd-left')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

/**
 * During a keyboard drag, walk dnd-kit's arrow targeting onto the sidebar row of group
 * `name`. Measured in the real popup: ArrowLeft from a tab grip lands on its WINDOW
 * container first ("Over position 1 of 2 in group Work."), so keep pressing Left until a
 * sidebar-row phrase is announced, then step Down/Up to the wanted row. Returns the last
 * dnd-kit announcement (callers assert on it).
 */
async function walkKeyboardToSidebarRow(cdp: RawCdp, name: string): Promise<string> {
  const want = new RegExp(`^Over group ${name}, as a new window\\.`);
  const sidebarPhrase = /^Over (group .+, as a new window|Now Open, which opens)/;
  let over = await cdp.evaluate<string>(DNDKIT_REGION);
  for (let i = 0; i < 4 && !sidebarPhrase.test(over); i++) {
    await pressKey(cdp, 'ArrowLeft', 350);
    over = await cdp.evaluate<string>(DNDKIT_REGION);
  }
  for (let i = 0; i < 4 && sidebarPhrase.test(over) && !want.test(over); i++) {
    await pressKey(cdp, 'ArrowDown', 350);
    over = await cdp.evaluate<string>(DNDKIT_REGION);
  }
  for (let i = 0; i < 4 && sidebarPhrase.test(over) && !want.test(over); i++) {
    await pressKey(cdp, 'ArrowUp', 350);
    over = await cdp.evaluate<string>(DNDKIT_REGION);
  }
  console.log(`[walkKeyboardToSidebarRow ${name}] last announcement:`, JSON.stringify(over));
  return over;
}

test('real popup — KEYBOARD drop onto ANOTHER group\'s sidebar row: moved, panel stays, focus lands on the nearest remaining tab BY IDENTITY, outcome announced after focus (A1/A5)', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch();
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect.poll(() => panelTabs(cdp), { timeout: 5_000 }).toEqual(WORK_TABS);
    expect(await focusGrip(cdp, ROW_BY_TITLE('Alpha'), TAB_GRIP)).toBe('Drag to reorder tab: Alpha');
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    await pressKey(cdp, 'Space');
    const over = await walkKeyboardToSidebarRow(cdp, 'Play');
    console.log('[kbd-cross] over before drop:', JSON.stringify(over));
    expect(over).toMatch(/^Over group Play, as a new window\./);
    await pressKey(cdp, 'Space', 1_000);

    const after = await cdp.evaluate<{ focus: string | null; region: string; panel: string[] }>(
      `({ focus: ${FOCUS_LABEL}, region: ${APP_REGION}, panel: [...document.querySelectorAll('main [role="listitem"]')].map((e) => e.getAttribute('aria-label')) })`
    );
    const work = await idbGroup(cdp, 'work');
    const play = await idbGroup(cdp, 'play');
    printLog('KEYBOARD cross-group', await readLog(cdp));
    console.log('[kbd-cross] after:', JSON.stringify(after), ' IDB work:', JSON.stringify(work), ' play:', JSON.stringify(play));

    expect(work.windows.map((w) => w.tabs)).toEqual([['Bravo', 'Charlie'], ['Delta', 'Echo']]);
    expect(play.windows.map((w) => w.tabs)).toEqual([['Foxtrot'], ['Alpha']]);
    expect(after.panel).toEqual(['Bravo', 'Charlie', 'Delta', 'Echo']); // Work still shown
    // A5: Alpha's next sibling in its own list — never "whatever slid into slot t0" by accident of position
    expect(after.focus).toBe('Drag to reorder tab: Bravo');
    expect(after.region).toContain('Moved tab Alpha to Window 2 of group Play');
    expect(after.region).toContain('Group Play is not shown.');
    expect(await probeAlive(cdp, 'kbd-cross')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — #15: two IDENTICAL saved windows reordered mid-drag (vs a stable neighbour) → the drop CANCELS cleanly; nothing written', async () => {
  test.setTimeout(120_000);
  const same = () => ({ id: 0, incognito: false, focused: false, tabs: [tab('Same')] });
  const DUP = {
    id: 'dup',
    name: 'Dup',
    windows: [same(), { id: 0, incognito: false, focused: false, tabs: [tab('Other')] }, same()]
  };
  const { context, cdp } = await launch({ groups: [NOW_OPEN, DUP, PLAY] });
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Dup');
    const WIN_GRIP = '[aria-label^="Drag to reorder window"]';
    await expect.poll(() => cdp.evaluate<number>(`document.querySelectorAll('${WIN_GRIP}').length`), { timeout: 5_000 }).toBe(3);
    const before = await idbGroup(cdp, 'dup');
    expect(before.windows.map((w) => w.tabs)).toEqual([['Same'], ['Other'], ['Same']]);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    const focused = await cdp.evaluate<string | null>(`(() => {
      document.querySelector('[data-tm-dnd-id="dup::w0"] ${WIN_GRIP}')?.focus();
      return ${FOCUS_LABEL};
    })()`);
    expect(focused).toBe('Drag to reorder window: Window 1');

    await pressKey(cdp, 'Space'); // pick up the FIRST "Same" window (before "Other")
    // a remote reorder lands mid-drag: [Other, Same, Same] — the rank-0 "Same" is now AFTER "Other"
    const injected = await cdp.evaluate<boolean>(`(() => {
      const qc = globalThis.__tmQueryClient;
      if (!qc) return false;
      qc.setQueryData(['groups'], (s) => ({
        ...s,
        available: s.available.map((g) => g.id === 'dup' ? { ...g, updatedAt: Date.now(), windows: [g.windows[1], g.windows[0], g.windows[2]] } : g)
      }));
      return true;
    })()`);
    expect(injected).toBe(true);
    await pressKey(cdp, 'ArrowDown', 400);
    await pressKey(cdp, 'ArrowDown', 400);
    await pressKey(cdp, 'Space', 1_000);

    const log = await readLog(cdp);
    printLog('#15 duplicate-window permutation', log);
    const after = await idbGroup(cdp, 'dup');
    const region = await cdp.evaluate<string>(APP_REGION);
    console.log('[#15] IDB after:', JSON.stringify(after), ' region:', JSON.stringify(region));

    expect(stageNames(log)).toContain('commit-cancelled-stale');
    expect(stageNames(log)).not.toContain('committed');
    expect(after.windows.map((w) => w.tabs)).toEqual([['Same'], ['Other'], ['Same']]); // IDB untouched
    expect(region).toMatch(/groups changed during the drag, so nothing was moved/);
    expect(await probeAlive(cdp, '#15')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DUAL-PATH SENSOR (`@/lib/dndPressTracker` + `Html5DragSensor`)
//
// The sensor decides PER PRESS whether to let the native HTML5 drag run, or to
// cancel it and drive the drag from pointer events. The pointer path is the only
// one on which `cursor: grabbing` is possible at all (spec C5) — during a native
// drag the OS owns the cursor.
//
// The decision is "how many `pointermove`s did the popup deliver before
// `dragstart`": >= 2 -> pointer, <= 1 -> native. Chrome opens a native drag once
// the pointer passes ~4px from the press origin, so the harness selects the path
// purely through its nudge step size:
//   1px nudges     -> several sub-threshold moves -> POINTER
//   >= 4px nudges  -> one move                    -> NATIVE
// Both are exercised below unforced, plus a forced-native run for parity.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Press, nudge in `nudgeStep`px steps until Chrome's native drag threshold is
 * passed, then paced moves to `to` (sampling at 5/8 of the way), then release.
 */
async function drivePath(
  cdp: RawCdp,
  from: { x: number; y: number },
  to: { x: number; y: number },
  nudgeStep: number,
  onMid?: () => Promise<void>
) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i * nudgeStep <= 8; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + i * nudgeStep, button: 'left', buttons: 1 });
    await sleep(25);
  }
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      button: 'left',
      buttons: 1
    });
    await sleep(60);
    if (i === 5 && onMid) await onMid();
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(700);
}

/** The `path:*` decision line the sensor logs at every `dragstart`. */
function pathEntry(log: [number, string, unknown][]) {
  const hit = log.find(([, s]) => s.startsWith('path:'));
  return hit ? { stage: hit[1], detail: (hit[2] ?? {}) as Record<string, unknown> } : null;
}

/**
 * The cursor as the PAGE resolves it (CDP screenshots can't see the real OS cursor —
 * spec C9). `under` is the element actually beneath the pointer. `grip` and `button`
 * are elements that set their OWN `cursor` (`cursor-grab` / `cursor-pointer`): an
 * inherited `<body>` value loses to those, so they are the ones that prove the
 * `html[data-tm-dnd-grabbing] *` rule — not `body` alone.
 */
async function readCursor(cdp: RawCdp, x: number, y: number) {
  const raw = await cdp.evaluate<string>(
    `(() => {
       const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
       const grip = document.querySelector('[aria-label^="Drag to reorder"]');
       const button = document.querySelector('button');
       const cur = (n) => (n ? getComputedStyle(n).cursor : null);
       return JSON.stringify({
         attr: document.documentElement.hasAttribute('data-tm-dnd-grabbing'),
         body: getComputedStyle(document.body).cursor,
         under: cur(el),
         grip: cur(grip),
         button: cur(button),
         ghost: !!document.querySelector('[data-testid="drag-ghost"]')
       });
     })()`
  );
  return JSON.parse(raw as unknown as string) as {
    attr: boolean;
    body: string;
    under: string | null;
    grip: string | null;
    button: string | null;
    ghost: boolean;
  };
}

/** The two tab grips a Work-group reorder drags between, plus the sampling point. */
async function workDragPoints(cdp: RawCdp) {
  await selectGroup(cdp, 'Work');
  await expect
    .poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), {
      timeout: 5_000
    })
    .toBeGreaterThan(2);
  const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0);
  const g2 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 2);
  const from = { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) };
  const to = { x: Math.round(g2.x + g2.w / 2), y: Math.round(g2.y + g2.h - 2) };
  const mid = {
    x: Math.round(from.x + (to.x - from.x) * 0.625),
    y: Math.round(from.y + (to.y - from.y) * 0.625)
  };
  return { from, to, mid };
}

test('real popup — DUAL PATH: a fine-grained drag takes the POINTER path, shows a grabbing cursor, and commits', async () => {
  test.setTimeout(120_000);
  // forcePath: null — the sensor decides from the real pointer stream.
  const { context, cdp } = await launch({ forcePath: null });
  try {
    const { from, to, mid } = await workDragPoints(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    const before = await idbGroup(cdp, 'work');

    let sample: Awaited<ReturnType<typeof readCursor>> | null = null;
    await drivePath(cdp, from, to, 1, async () => {
      sample = await readCursor(cdp, mid.x, mid.y);
    });

    const log = await readLog(cdp);
    printLog('DUAL PATH / pointer', log);
    const decision = pathEntry(log);
    console.log('[dual] decision:', JSON.stringify(decision), ' mid-drag cursor:', JSON.stringify(sample));
    const cursor = sample as unknown as Awaited<ReturnType<typeof readCursor>>;

    // 1. the pointer path ran, on the real evidence (no force flag)
    expect(decision?.stage).toBe('path:pointer');
    expect(decision?.detail).toMatchObject({ forced: null, pressValid: true });
    expect(Number(decision?.detail?.movesSeen)).toBeGreaterThanOrEqual(2);
    // 2. no native drag session existed at all
    expect(stageNames(log)).toContain('pointer:dragstart');
    expect(stageNames(log)).not.toContain('html5:dragstart');
    expect(stageNames(log)).not.toContain('html5:drop');
    // 3. THE POINT OF THE WHOLE EXERCISE: `grabbing` while the drag is live
    expect(cursor.attr).toBe(true);
    expect(cursor.body).toBe('grabbing');
    expect(cursor.under).toBe('grabbing');
    // Elements that set their OWN cursor must be overridden too, or the pointer
    // would flip back to `grab`/`pointer` every time it crossed a grip or a button.
    expect(cursor.grip).toBe('grabbing');
    expect(cursor.button).toBe('grabbing');
    expect(cursor.ghost).toBe(true);
    // 4. …and it commits exactly like the native path
    expect(stageNames(log)).toEqual(
      expect.arrayContaining(['pointer:drop', 'onDragStart', 'onDragEnd', 'committed'])
    );
    const after = await idbGroup(cdp, 'work');
    console.log('[dual] work w0 before:', JSON.stringify(before.windows[0].tabs), '→ after:', JSON.stringify(after.windows[0].tabs));
    expect(after.windows[0].tabs).toEqual(['Bravo', 'Charlie', 'Alpha']);
    // 5. cleaned up after the drop, popup alive
    const end = await readCursor(cdp, to.x, to.y);
    expect(end.attr).toBe(false);
    expect(end.ghost).toBe(false);
    expect(await probeAlive(cdp, 'dual/pointer')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — DUAL PATH: a coarse drag falls back to the NATIVE path and still commits (no grabbing cursor — spec C5)', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch({ forcePath: null });
  try {
    const { from, to, mid } = await workDragPoints(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    let sample: Awaited<ReturnType<typeof readCursor>> | null = null;
    // One >= 4px jump clears Chrome's native threshold before a second move lands.
    await drivePath(cdp, from, to, 8, async () => {
      sample = await readCursor(cdp, mid.x, mid.y);
    });

    const log = await readLog(cdp);
    printLog('DUAL PATH / native fallback', log);
    const decision = pathEntry(log);
    console.log('[dual] decision:', JSON.stringify(decision), ' mid-drag cursor:', JSON.stringify(sample));
    const cursor = sample as unknown as Awaited<ReturnType<typeof readCursor>>;

    expect(decision?.stage).toBe('path:native');
    expect(decision?.detail).toMatchObject({ forced: null });
    expect(Number(decision?.detail?.movesSeen)).toBeLessThanOrEqual(1);
    // The native drag really ran, unchanged.
    expect(stageNames(log)).toEqual(
      expect.arrayContaining(['html5:dragstart', 'onDragStart', 'html5:drop', 'onDragEnd', 'committed'])
    );
    expect(stageNames(log)).not.toContain('pointer:dragstart');
    // …and `grabbing` is correctly NOT claimed on this path: the attribute is absent,
    // so a grip still computes its own `cursor-grab`. (What the USER sees here is the
    // OS drag glyph regardless of any CSS value — spec C5, C9.)
    expect(cursor.attr).toBe(false);
    expect(cursor.grip).toBe('grab');
    expect(cursor.ghost).toBe(true);
    const after = await idbGroup(cdp, 'work');
    expect(after.windows[0].tabs).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(await probeAlive(cdp, 'dual/native')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — DUAL PATH: a POINTER-path drag survives spring-open unmounting the grip that holds pointer capture, and commits cross-group', async () => {
  test.setTimeout(120_000);
  // The one structural risk the pointer path adds: `setPointerCapture` is taken on
  // the grip, and spring-open swaps the panel mid-drag, unmounting that very grip.
  // Capture is implicitly released then — the document-level listeners must carry
  // the drag to a correct cross-group drop anyway.
  const { context, cdp } = await launch({ forcePath: null });
  try {
    await installErrorCapture(cdp);
    await selectGroup(cdp, 'Work');
    await expect
      .poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 })
      .toBeGreaterThan(2);
    const g0 = await box(cdp, '[aria-label^="Drag to reorder tab"]', 0); // "Alpha", in Work
    const playRow = await rowBoxByText(cdp, 'Play');
    expect(playRow).not.toBeNull();
    await cdp.evaluate(`globalThis.__tmDndLog = []`);

    const from = { x: Math.round(g0.x + g0.w / 2), y: Math.round(g0.y + g0.h / 2) };
    const to = { x: Math.round(playRow!.x + playRow!.w / 2), y: Math.round(playRow!.y + playRow!.h / 2) };
    // Fine nudges (pointer path), then travel, then dwell past SPRING_OPEN_MS (600ms).
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + i, button: 'left', buttons: 1 });
      await sleep(25);
    }
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(from.x + ((to.x - from.x) * i) / 8),
        y: Math.round(from.y + ((to.y - from.y) * i) / 8),
        button: 'left',
        buttons: 1
      });
      await sleep(50);
    }
    let capturedGripGone: boolean | null = null;
    for (let i = 0; i < 12; i++) {
      const jitter = i % 2 === 0 ? 1 : -1;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x + jitter, y: to.y, button: 'left', buttons: 1 });
      await sleep(80);
      if (i === 10) {
        capturedGripGone = await cdp.evaluate<boolean>(
          `!document.querySelector('[data-tm-dnd-id="work::w0::t0"]')`
        );
      }
    }
    const midCursor = await readCursor(cdp, to.x, to.y);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(700);

    const log = await readLog(cdp);
    printLog('DUAL PATH / pointer + spring-open', log);
    const decision = pathEntry(log);
    console.log('[dual] decision:', JSON.stringify(decision), ' source row unmounted by spring-open:', capturedGripGone, ' cursor during dwell:', JSON.stringify(midCursor));

    expect(decision?.stage).toBe('path:pointer');
    expect(capturedGripGone).toBe(true); // the capture element really did go away
    expect(midCursor.attr).toBe(true); // …and the grabbing cursor survived it
    expect(stageNames(log)).toEqual(expect.arrayContaining(['pointer:drop', 'onDragEnd', 'committed']));
    const work = await idbGroup(cdp, 'work');
    const play = await idbGroup(cdp, 'play');
    console.log('[dual] work:', JSON.stringify(work.windows.map((w) => w.tabs)), ' play:', JSON.stringify(play.windows.map((w) => w.tabs)));
    expect(work.windows[0].tabs).toEqual(['Bravo', 'Charlie']);
    expect(play.windows.map((w) => w.tabs)).toEqual([['Foxtrot'], ['Alpha']]);
    expect(await cdp.evaluate<boolean>(`document.documentElement.hasAttribute('data-tm-dnd-grabbing')`)).toBe(false);
    expect(await probeAlive(cdp, 'dual/spring')).toBeGreaterThan(0);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});

test('real popup — DUAL PATH: forcing the native path overrides a healthy pointer stream and commits exactly as today', async () => {
  test.setTimeout(120_000);
  const { context, cdp } = await launch({ forcePath: 'native' });
  try {
    const { from, to } = await workDragPoints(cdp);
    await cdp.evaluate(`globalThis.__tmDndLog = []`);
    // FINE nudges — enough evidence for the pointer path; the force flag must win.
    await drivePath(cdp, from, to, 1);

    const log = await readLog(cdp);
    printLog('DUAL PATH / forced native', log);
    const decision = pathEntry(log);
    console.log('[dual] decision:', JSON.stringify(decision));

    expect(decision?.stage).toBe('path:native');
    expect(decision?.detail).toMatchObject({ forced: 'native' });
    expect(Number(decision?.detail?.movesSeen)).toBeGreaterThanOrEqual(2); // the stream WAS there
    expect(stageNames(log)).toEqual(
      expect.arrayContaining(['html5:dragstart', 'onDragStart', 'html5:drop', 'onDragEnd', 'committed'])
    );
    expect(await cdp.evaluate<boolean>(`document.documentElement.hasAttribute('data-tm-dnd-grabbing')`)).toBe(false);
    const after = await idbGroup(cdp, 'work');
    expect(after.windows[0].tabs).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect((await readErrors(cdp)).pageErrors).toEqual([]);
  } finally {
    cdp.close();
    await context.close().catch(() => {});
  }
});
