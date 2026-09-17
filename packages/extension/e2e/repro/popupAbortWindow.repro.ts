/**
 * popupAbortWindow.repro.ts — EMPIRICAL measurement of which DOM mutations, at
 * which delay after `dragstart`, abort a native HTML5 drag in the REAL MV3
 * toolbar popup (the constraint every DnD visual in this extension is built
 * around — see `src/lib/dndHtml5Sensor.ts`).
 *
 * No app code is changed: a document-capture script is injected into the popup
 * (it runs BEFORE React's root listeners), and on `dragstart` it schedules ONE
 * mutation of the configured `kind` at the configured `timing`, then records
 * whether `drop` fires and what `dragend.dropEffect` was. One popup, reloaded
 * between trials.
 *
 *   EXP_KINDS   comma list (default below) — see `mutate()` in the injected script
 *   EXP_TIMINGS comma list: sync | raf | raf2 | t<ms> | drag<n> | over<n>
 *
 * Run: cd e2e && npx playwright test --config repro/playwright.repro.config.ts popupAbortWindow
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedIdb } from '../helpers';
import { RawCdp } from '../rawCdp';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../../.output/chrome-mv3-dev');

const tab = (t: string) => ({ id: 0, title: t, url: `https://example.com/${t.toLowerCase()}` });
const GROUPS = [
  { id: 'now-open', name: 'Now Open', permanent: true, windows: [] },
  {
    id: 'work',
    name: 'Work',
    windows: [
      { id: 1, incognito: false, focused: false, tabs: [tab('Alpha'), tab('Bravo'), tab('Charlie'), tab('Golf')] },
      { id: 2, incognito: false, focused: false, tabs: [tab('Delta'), tab('Echo')] }
    ]
  },
  { id: 'play', name: 'Play', windows: [{ id: 3, incognito: false, focused: false, tabs: [tab('Foxtrot')] }] }
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function launch(): Promise<{ context: BrowserContext; cdp: RawCdp }> {
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
  await seedIdb(seedPage, GROUPS);
  await seedPage.evaluate(() => localStorage.setItem('tm_dnd_debug', '1'));
  await seedPage.close();
  const host = await context.newPage();
  await host.goto('about:blank');
  await host.bringToFront();
  await sw.evaluate(async () => {
    await chrome.action.openPopup();
  });
  const cdp = await RawCdp.attach(port, '/popup.html');
  await cdp.send('Runtime.enable');
  return { context, cdp };
}

async function ready(cdp: RawCdp) {
  await expect
    .poll(() => cdp.evaluate<number>(`document.getElementById('root')?.childElementCount ?? 0`), { timeout: 8_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => cdp.evaluate<boolean>(`!![...document.querySelectorAll('span')].find(s => s.textContent === 'Work')`), { timeout: 5_000 })
    .toBe(true);
  await cdp.evaluate(`[...document.querySelectorAll('span')].find(s => s.textContent === 'Work').click()`);
  await expect
    .poll(() => cdp.evaluate<number>(`document.querySelectorAll('[data-window-index="0"] [aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 })
    .toBeGreaterThan(2);
  await sleep(300);
}

const INJECT = (cfg: { kind: string; timing: string }) => `(() => {
  const cfg = ${JSON.stringify(cfg)};
  const R = globalThis.__exp = { cfg, events: [], t0: null };
  const now = () => performance.now();
  const log = (type, extra) => R.events.push([type, R.t0 == null ? null : Math.round(now() - R.t0), extra ?? null]);
  let mutated = false, dragCount = 0, overCount = 0, row = null, grip = null;
  const size = () => ({ iw: innerWidth, ih: innerHeight, sh: document.documentElement.scrollHeight });
  const mutate = (why) => {
    if (mutated || !row) return; mutated = true;
    const h = row.getBoundingClientRect().height;
    const before = size();
    switch (cfg.kind) {
      case 'none': break;
      case 'rowDisplayNone': row.style.display = 'none'; break;
      case 'rowHeight0': row.style.cssText += ';height:0px;min-height:0px;padding-top:0px;padding-bottom:0px;overflow:hidden'; break;
      case 'rowDetach': row.remove(); break;
      case 'rowAttrOnly': row.setAttribute('data-exp', '1'); break;
      // the exact mutation dnd-kit makes on the grip at pickup (the "pinned" attribute)
      case 'gripAriaPressed': grip.setAttribute('aria-pressed', 'true'); break;
      case 'rowTransform': row.style.transform = 'translate3d(0,1px,0)'; break;
      case 'siblingMargin': { const s = row.nextElementSibling; if (s) s.style.marginTop = (-h) + 'px'; break; }
      case 'unrelatedLayout': { const o = document.querySelector('[data-window-index="1"] [role="listitem"]'); if (o) o.style.display = 'none'; break; }
      case 'ancestorChildAppend': { const list = row.parentElement; const d = document.createElement('div'); d.style.height = '0px'; list.appendChild(d); break; }
      case 'gripChildHidden': if (grip.firstElementChild) grip.firstElementChild.style.visibility = 'hidden'; break;
    }
    log('mutate', { why, h, before, after: size(), gripConnected: grip.isConnected });
  };
  document.addEventListener('dragstart', (e) => {
    R.t0 = now(); log('dragstart');
    const t = e.target;
    grip = (t.closest && t.closest('[aria-label^="Drag to reorder"]')) || t;
    row = grip.closest('[role="listitem"]');
    grip.addEventListener('dragend', (ev) => log('dragend@node', { dropEffect: ev.dataTransfer && ev.dataTransfer.dropEffect }), { once: true });
    const tm = cfg.timing;
    if (tm === 'sync') mutate('sync');
    else if (tm === 'micro') queueMicrotask(() => mutate('micro'));
    else if (tm === 'raf') requestAnimationFrame(() => mutate('raf'));
    else if (tm === 'raf2') requestAnimationFrame(() => requestAnimationFrame(() => mutate('raf2')));
    else if (/^t\\d+$/.test(tm)) setTimeout(() => mutate(tm), Number(tm.slice(1)));
  }, true);
  document.addEventListener('drag', () => { dragCount++; if (cfg.timing === 'drag' + dragCount) mutate('drag' + dragCount); }, true);
  document.addEventListener('dragover', () => { overCount++; if (cfg.timing === 'over' + overCount) mutate('over' + overCount); }, true);
  document.addEventListener('drop', () => log('drop', { dragCount, overCount }), true);
  document.addEventListener('dragend', (e) => log('dragend@doc', { dropEffect: e.dataTransfer && e.dataTransfer.dropEffect, dragCount, overCount }), true);
})()`;

async function slowDrag(cdp: RawCdp, from: { x: number; y: number }, to: { x: number; y: number }, durationMs: number) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 3; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + i, y: from.y + i * 3, button: 'left', buttons: 1 });
    await sleep(30);
  }
  const stepMs = 25;
  const n = Math.round(durationMs / stepMs);
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
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
}

const KINDS = (process.env.EXP_KINDS ?? 'none,rowDisplayNone,rowHeight0,rowDetach,siblingMargin,unrelatedLayout,rowAttrOnly').split(',');
const TIMINGS = (process.env.EXP_TIMINGS ?? 'sync,raf,t60,t150,t300,t600,drag1,drag3,over1').split(',');

test('real popup — MEASURE the native-drag abort window per mutation kind × delay', async () => {
  test.setTimeout(30 * 60_000);
  const { context, cdp } = await launch();
  const rows: string[] = [];
  try {
    for (const kind of KINDS) {
      for (const timing of TIMINGS) {
        await cdp.send('Page.reload', {});
        await sleep(800);
        await ready(cdp);
        await cdp.evaluate(INJECT({ kind, timing }));
        const g = await cdp.evaluate<{ x: number; y: number; w: number; h: number }[]>(
          `[...document.querySelectorAll('[data-window-index="0"] [aria-label^="Drag to reorder tab"]')].map(e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height }; })`
        );
        const from = { x: Math.round(g[0].x + g[0].w / 2), y: Math.round(g[0].y + g[0].h / 2) };
        const to = { x: from.x, y: Math.round(g[2].y + g[2].h / 2 + 4) };
        await slowDrag(cdp, from, to, 1400);
        const res = await cdp.evaluate<string>(`JSON.stringify({ exp: globalThis.__exp, app: (globalThis.__tmDndLog || []).map(e => e[1]) })`);
        const { exp, app } = JSON.parse(res) as { exp: { events: [string, number | null, unknown][] }; app: string[] };
        const ev = (t: string) => exp.events.find((e) => e[0] === t);
        const mut = ev('mutate');
        const drop = ev('drop');
        const endDoc = ev('dragend@doc');
        const endNode = ev('dragend@node');
        const end = endDoc ?? endNode;
        const effect = (end?.[2] as { dropEffect?: string } | null)?.dropEffect ?? '?';
        const verdict = !ev('dragstart') ? 'NO-DRAGSTART' : drop ? 'OK' : 'ABORT';
        const line = `${kind.padEnd(16)} ${timing.padEnd(6)} ${verdict.padEnd(12)} mut@${String(mut?.[1] ?? '-').padStart(4)}ms end@${String(end?.[1] ?? '-').padStart(5)}ms effect=${effect.padEnd(4)} endSeenOn=${endDoc ? 'doc' : endNode ? 'node' : 'none'} committed=${app.includes('committed')} mutDetail=${JSON.stringify(mut?.[2] ?? null)}`;
        console.log('[abort-window]', line);
        rows.push(line);
      }
    }
  } finally {
    console.log('\n[abort-window] SUMMARY\n' + rows.join('\n'));
    cdp.close();
    await context.close().catch(() => {});
  }
});
