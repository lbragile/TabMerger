/**
 * Measurement harness (not part of the e2e suite): how long is a user action's write "in the
 * air" in the popup, and is it lost when the popup goes away in that time?
 *
 * Run from `packages/extension/e2e`:
 *   TM_E2E_EXT_DIR=.output/chrome-mv3 npx playwright test --config repro/playwright.repro.config.ts writeWindow
 *
 * Env:
 *   TM_E2E_EXT_DIR        build to load (see ../fixtures.ts)
 *   TM_E2E_CPU_THROTTLE   CPU slowdown factor (see ../fixtures.ts)
 *   TM_WW_RUNS            timeline samples per case (default 10)
 *   TM_WW_DELAYS          comma-separated "leave the page N ms after the click" delays
 *   TM_WW_TRIES           tries per delay (default 5)
 *
 * What it records, inside the popup page, with `performance.now()`:
 *   click            the Apply click (capture phase, before React's handler)
 *   lock.request     `navigator.locks.request('tabmerger-groups-write')` called
 *   lock.granted     its callback started
 *   tx.readonly      first IndexedDB transaction created after the click
 *   tx.readwrite     the readwrite transaction created
 *   tx.commit        `commit()` called explicitly on it (absent in builds that rely on auto-commit)
 *   tx.complete      its `complete` event (the write is durable from the page's point of view)
 */
import { test, expect } from '../fixtures';
import type { Page, Worker } from '@playwright/test';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

const RUNS = Number(process.env.TM_WW_RUNS ?? 10);
const TRIES = Number(process.env.TM_WW_TRIES ?? 5);
const DELAYS = (process.env.TM_WW_DELAYS ?? '0,1,2,4,8,16,32,64').split(',').map(Number);

interface Mark { t: number; what: string; detail?: string }

/** Installed before any page script: timestamps locks and IndexedDB transactions. */
function instrument(): void {
  const w = globalThis as unknown as { __tmMarks: Mark[]; __tmLocks: { name: string; requested: number; granted?: number; released?: number }[] };
  w.__tmMarks = [];
  w.__tmLocks = [];
  const mark = (what: string, detail?: string) => w.__tmMarks.push({ t: performance.now(), what, detail });

  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const el = e.target as HTMLElement | null;
      mark('click', el?.textContent?.trim().slice(0, 20));
    }, true);
  }

  const locks = navigator.locks;
  if (locks?.request) {
    const original = locks.request.bind(locks);
    (locks as unknown as { request: unknown }).request = (name: string, ...rest: unknown[]) => {
      const callback = rest[rest.length - 1] as (lock: unknown) => unknown;
      const entry: { name: string; requested: number; granted?: number; released?: number } = { name, requested: performance.now() };
      w.__tmLocks.push(entry);
      mark('lock.request', name);
      rest[rest.length - 1] = async (lock: unknown) => {
        entry.granted = performance.now();
        mark('lock.granted', name);
        try {
          return await callback(lock);
        } finally {
          entry.released = performance.now();
          mark('lock.released', name);
        }
      };
      return (original as (...a: unknown[]) => Promise<unknown>)(name, ...rest);
    };
  }

  const originalTx = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: unknown[]) {
    const tx = (originalTx as (...a: unknown[]) => IDBTransaction).apply(this, args);
    const mode = tx.mode;
    mark(`tx.${mode}`, [...tx.objectStoreNames].join('+'));
    tx.addEventListener('complete', () => mark(`tx.${mode}.complete`));
    tx.addEventListener('abort', () => mark(`tx.${mode}.abort`));
    return tx;
  } as typeof IDBDatabase.prototype.transaction;
  const originalCommit = IDBTransaction.prototype.commit;
  IDBTransaction.prototype.commit = function (this: IDBTransaction) {
    mark(`tx.${this.mode}.commit`);
    return originalCommit.call(this);
  };
}

/** The stored colour of the Work group, read through a context that survives the popup. */
async function storedColor(reader: Page | Worker): Promise<string | undefined> {
  return reader.evaluate(
    () =>
      new Promise<string | undefined>((resolve, reject) => {
        const req = indexedDB.open('tabmerger');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('groups', 'readonly').objectStore('groups').getAll();
          get.onsuccess = () => {
            db.close();
            resolve((get.result as { name: string; color: string }[]).find((g) => g.name === 'Work')?.color);
          };
          get.onerror = () => reject(get.error);
        };
      })
  );
}

function summarize(label: string, samples: number[]): string {
  if (samples.length === 0) return `${label}: no samples`;
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return `${label}: n=${sorted.length} min=${sorted[0].toFixed(1)} median=${pick(0.5).toFixed(1)} p90=${pick(0.9).toFixed(1)} max=${sorted[sorted.length - 1].toFixed(1)} ms`;
}

test.describe('write window', () => {
  test.setTimeout(600_000);

  test('timeline: Apply click to IndexedDB commit', async ({ context, extensionId }) => {
    await context.addInitScript(instrument);
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    const segments: Record<string, number[]> = {};
    const add = (key: string, value: number | undefined) => {
      if (value === undefined || Number.isNaN(value)) return;
      (segments[key] ??= []).push(value);
    };
    let firstTimeline = '';

    for (let run = 0; run < RUNS; run++) {
      const hex = `#${(0x101010 + run * 0x030507).toString(16).padStart(6, '0')}`;
      const swatch = page.locator('[data-sidebar-group-index="1"]').getByRole('button', { name: 'Change group color' });
      await swatch.click();
      await page.getByPlaceholder('#rrggbb').fill(hex);
      await page.waitForTimeout(300); // let the Now Open sync and any refetch settle
      await page.evaluate(() => {
        (globalThis as unknown as { __tmMarks: Mark[] }).__tmMarks.length = 0;
      });
      await page.getByRole('button', { name: 'Apply' }).click();
      await page.waitForFunction(() =>
        (globalThis as unknown as { __tmMarks: Mark[] }).__tmMarks.some((m) => m.what === 'tx.readwrite.complete')
      );
      const marks = await page.evaluate(() => (globalThis as unknown as { __tmMarks: Mark[] }).__tmMarks);
      const at = (what: string, after = 0) => marks.find((m) => m.what === what && m.t >= after)?.t;
      const click = marks.filter((m) => m.what === 'click').pop()?.t ?? 0;
      const lockRequest = at('lock.request', click);
      const lockGranted = at('lock.granted', click);
      const readTx = at('tx.readonly', click);
      const writeTx = at('tx.readwrite', click);
      const commit = at('tx.readwrite.commit', click);
      const complete = at('tx.readwrite.complete', click);
      add('click -> lock.request', lockRequest === undefined ? undefined : lockRequest - click);
      add('lock.request -> lock.granted', lockRequest === undefined || lockGranted === undefined ? undefined : lockGranted - lockRequest);
      add('click -> first readonly tx', readTx === undefined ? undefined : readTx - click);
      add('click -> readwrite tx created', writeTx === undefined ? undefined : writeTx - click);
      add('click -> commit() called', commit === undefined ? undefined : commit - click);
      add('click -> readwrite tx complete', complete === undefined ? undefined : complete - click);
      if (run === 0) {
        firstTimeline = marks.map((m) => `  +${(m.t - click).toFixed(1)}ms ${m.what}${m.detail ? ` (${m.detail})` : ''}`).join('\n');
      }
    }

    console.log(`\n[write window] first run timeline (relative to the click):\n${firstTimeline}`);
    for (const [key, values] of Object.entries(segments)) console.log(`[write window] ${summarize(key, values)}`);
    expect(segments['click -> readwrite tx complete']?.length).toBe(RUNS);
  });

  test('lock holders around popup start', async ({ context, extensionId }) => {
    await context.addInitScript(instrument);
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    const waits: number[] = [];
    const holds: number[] = [];
    for (let i = 0; i < Math.max(3, Math.floor(RUNS / 2)); i++) {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const locks = await page.evaluate(
        () => (globalThis as unknown as { __tmLocks: { name: string; requested: number; granted?: number; released?: number }[] }).__tmLocks
      );
      if (i === 0) {
        console.log('[write window] popup start, lock requests (ms since navigation start):');
        locks.forEach((l) =>
          console.log(`  ${l.name} requested=${l.requested.toFixed(1)} waited=${((l.granted ?? NaN) - l.requested).toFixed(1)} held=${((l.released ?? NaN) - (l.granted ?? NaN)).toFixed(1)}`)
        );
      }
      locks.filter((l) => l.name === 'tabmerger-groups-write' && l.granted !== undefined).forEach((l) => {
        waits.push(l.granted! - l.requested);
        if (l.released !== undefined) holds.push(l.released - l.granted!);
      });
    }
    console.log(`[write window] ${summarize('popup groups lock wait (request -> granted)', waits)}`);
    console.log(`[write window] ${summarize('popup groups lock hold (granted -> released)', holds)}`);

    // What the service worker does with the same lock while a popup opens.
    const [sw] = context.serviceWorkers();
    await sw.evaluate(instrument);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const swLocks = await sw.evaluate(
      () => (globalThis as unknown as { __tmLocks: { name: string; requested: number; granted?: number; released?: number }[] }).__tmLocks
    );
    console.log(`[write window] service worker lock requests during a popup start: ${swLocks.length}`);
    swLocks.forEach((l) =>
      console.log(`  ${l.name} waited=${((l.granted ?? NaN) - l.requested).toFixed(1)} held=${((l.released ?? NaN) - (l.granted ?? NaN)).toFixed(1)}`)
    );
  });

  test('loss: leave the page N ms after the Apply click', async ({ context, extensionId }) => {
    const [sw] = context.serviceWorkers();
    const lines: string[] = [];
    for (const how of ['reload', 'close'] as const) {
      for (const delay of DELAYS) {
        let saved = 0;
        for (let attempt = 0; attempt < TRIES; attempt++) {
          const page = await openPopup(context, extensionId);
          await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
          const hex = `#${(0x202020 + (delay * 7 + attempt) * 0x010203).toString(16).padStart(6, '0').slice(0, 6)}`;
          await page.locator('[data-sidebar-group-index="1"]').getByRole('button', { name: 'Change group color' }).click();
          await page.getByPlaceholder('#rrggbb').fill(hex);
          await page.waitForTimeout(300);
          const before = await storedColor(sw);
          // Leave from INSIDE the page, a fixed time after the click reached the document: the
          // delay is then exact, with no CDP round trip in it.
          await page.evaluate(
            async ({ delay, how }) => {
              // `window.close()` is ignored for a tab the script did not open, so the close case
              // removes the page's own tab (id resolved up front, so only the remove call is timed).
              const self = await chrome.tabs.getCurrent();
              document.addEventListener(
                'click',
                (e) => {
                  if ((e.target as HTMLElement | null)?.textContent?.trim() !== 'Apply') return;
                  const leave = () => (how === 'close' ? void chrome.tabs.remove(self!.id!) : location.reload());
                  if (delay === 0) queueMicrotask(leave);
                  else setTimeout(leave, delay);
                },
                true
              );
            },
            { delay, how }
          );
          const gone = how === 'close' ? page.waitForEvent('close') : page.waitForEvent('load');
          await page.getByRole('button', { name: 'Apply' }).click({ noWaitAfter: true }).catch(() => undefined);
          await gone.catch(() => undefined);
          // Give an orphaned-but-sent write every chance to land before judging it lost.
          await new Promise((r) => setTimeout(r, 500));
          const after = await storedColor(sw);
          if (after !== before) saved++;
          if (!page.isClosed()) await page.close();
        }
        lines.push(`${how} ${String(delay).padStart(3)} ms after click: saved ${saved}/${TRIES}`);
      }
    }
    console.log(`\n[write window] does the write survive?\n${lines.map((l) => `  ${l}`).join('\n')}`);
  });
});
