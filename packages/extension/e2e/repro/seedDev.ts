/**
 * seedDev.ts — one-command manual test harness.
 *
 *   pnpm --filter @tabmerger/extension seed:dev          # append realistic saved groups
 *   pnpm --filter @tabmerger/extension seed:dev:wipe     # replace existing saved groups
 *   pnpm --filter @tabmerger/extension seed:dev:reset    # delete the persistent profile
 *
 * Launches Chrome HEADED with the built dev extension, writes a realistic
 * `GroupsState` (varied groups / windows / tabs) straight into the extension's
 * IndexedDB, opens the popup, and then just sits there until you close Chrome or
 * hit Ctrl+C. Purpose-built for clicking around the drag-and-drop work by hand —
 * it is intentionally headed and persistent.
 *
 * BUILD REQUIREMENT — this tool ONLY ever loads `.output/chrome-mv3-dev` built by
 * `wxt build --mode development` (script: `build:dev`). It refuses:
 *   - the production build (`.output/chrome-mv3`) — its popup renders BLANK because
 *     `.env.production` ships placeholder Supabase keys that throw at import time;
 *   - a dev-SERVER build (from `wxt` / `pnpm dev:extension`) — its `popup.html`
 *     pulls scripts from `http://localhost:3001`, so it's blank unless that HMR
 *     server is running;
 *   - a STALE dev build — older than the newest file in `src/`.
 * In every one of those cases it exits with the exact command to run.
 * The `seed:dev` npm script runs `wxt build --mode development` first, so the
 * normal path Just Works; the checks here catch direct `playwright test` runs.
 *
 * This is NOT a test. It is excluded from `pnpm test` / `pnpm test:e2e` /
 * `repro:dnd` via its own `playwright.seed.config.ts` (`testMatch` only picks up
 * this file). Runs on Playwright's bundled runner — no new dependencies.
 *
 * Env knobs (see README.seed.md for the full table):
 *   SEED_GROUPS   (4)   saved groups to build
 *   SEED_WINDOWS  (2)   windows per group (upper bound when SEED_VARY=1)
 *   SEED_TABS     (5)   tabs per window  (upper bound when SEED_VARY=1)
 *   SEED_VARY     (1)   vary per-group/window counts for realism; 0 = exact
 *   SEED_WIPE     (0)   1 = replace existing saved groups instead of appending
 *                        (or use the `seed:dev:wipe` script)
 *   HEADLESS      (0)   1 = run windowless (defeats the point; here for parity)
 *   SEED_OPEN_MS  (0)   auto-close after N ms instead of waiting forever
 *   SEED_CDP_PORT (9444) remote-debugging port used to attach to the popup
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  test,
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { buildSeedGroups, countSeedTabs, resolveSeedConfig, type SeedSavedGroup } from './seedData';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(here, '../../.output');
const SRC_DIR = path.resolve(here, '../../src');
/** Persistent user-data-dir so seeded data survives close/reopen. Under the
 *  already-gitignored `e2e/test-results/`. Delete it (or `seed:dev:reset`) to wipe. */
const PROFILE_DIR = path.resolve(here, '../test-results/seed-profile');

const HEADLESS = process.env.HEADLESS === '1';
const OPEN_MS = Number(process.env.SEED_OPEN_MS || 0);
const CDP_PORT = Number(process.env.SEED_CDP_PORT || 9444);
// `SEED_WIPE=1` (or the `seed:dev:wipe` script, which sets it before workers spawn).
// A bare `--wipe` arg can't be used — Playwright's CLI rejects unknown options.
const WIPE = process.env.SEED_WIPE === '1';

const REGEN_HINT =
  '    pnpm --filter @tabmerger/extension build:dev\n' +
  '  (equivalently: cd packages/extension && wxt build --mode development)\n' +
  '  Then re-run `pnpm --filter @tabmerger/extension seed:dev`.';

/** Newest mtime (ms) among files under `dir` that `keep()` accepts. 0 if none. */
function newestMtime(dir: string, keep: (absPath: string) => boolean): number {
  let newest = 0;
  const walk = (d: string): void => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        walk(p);
        continue;
      }
      if (!keep(p)) continue;
      const m = fs.statSync(p).mtimeMs;
      if (m > newest) newest = m;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return newest;
}

/**
 * Resolve — and validate — the dev extension directory. Throws (with the exact
 * fix) rather than silently loading something that renders blank.
 */
function resolveExtensionPath(): string {
  const dev = path.join(OUTPUT_DIR, 'chrome-mv3-dev');
  const prod = path.join(OUTPUT_DIR, 'chrome-mv3');
  const popupHtml = path.join(dev, 'popup.html');
  const manifest = path.join(dev, 'manifest.json');

  if (!fs.existsSync(popupHtml) || !fs.existsSync(manifest)) {
    const prodNote = fs.existsSync(prod)
      ? `\n  (A production build exists at ${prod} but it is NOT used — its popup\n` +
        '   renders blank: .env.production has placeholder Supabase keys.)\n'
      : '';
    throw new Error(
      `\n[seed:dev] No dev build at ${dev}\n${prodNote}\n  Build the dev extension:\n${REGEN_HINT}\n`
    );
  }

  // Dev-SERVER artifact? Its popup.html references the Vite HMR server on :3001.
  const html = fs.readFileSync(popupHtml, 'utf8');
  if (/@vite\/client|localhost:3001|http:\/\/localhost/i.test(html)) {
    throw new Error(
      `\n[seed:dev] ${dev} is a dev-SERVER build (from \`wxt\` / \`pnpm dev:extension\`).\n` +
        '  Its popup.html loads scripts from http://localhost:3001, so it is BLANK\n' +
        '  unless that HMR server is running. Rebuild it self-contained:\n' +
        `${REGEN_HINT}\n`
    );
  }

  // Stale? Newest src file newer than the built manifest (with a small FS-mtime slop).
  const builtAt = fs.statSync(manifest).mtimeMs;
  const newestSrc = newestMtime(
    SRC_DIR,
    (p) =>
      /\.(ts|tsx|css|html)$/.test(p) &&
      !p.includes(`${path.sep}__tests__${path.sep}`) &&
      !/\.(test|spec)\.[tj]sx?$/.test(p)
  );
  if (newestSrc - builtAt > 2000) {
    throw new Error(
      `\n[seed:dev] The dev build is STALE.\n` +
        `    build:  ${new Date(builtAt).toLocaleString()}\n` +
        `    src/:   ${new Date(newestSrc).toLocaleString()} (newer)\n` +
        `  Rebuild so the popup reflects your current code:\n${REGEN_HINT}\n`
    );
  }

  return dev;
}

async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  return existing ?? context.waitForEvent('serviceworker', { timeout: 15_000 });
}

const findPopupPage = (client: Browser): Page | undefined =>
  client
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().endsWith('/popup.html'));

/** True once React has mounted something under #root. */
async function waitForRender(page: Page, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const ok = await page
      .evaluate(() => {
        const r = document.getElementById('root');
        return !!r && r.childElementCount > 0;
      })
      .catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/**
 * Write the seed into the shared-origin IndexedDB from inside a popup.html tab.
 * Preserves the permanent "Now Open" group (index 0). `wipe` deletes every
 * non-permanent group before inserting; otherwise the new groups are appended.
 * Returns a small summary for logging.
 */
async function writeSeed(
  page: Page,
  saved: SeedSavedGroup[],
  wipe: boolean
): Promise<{ mode: 'wipe' | 'append'; before: number; added: number; total: number }> {
  return page.evaluate(
    async ({ saved, wipe }) => {
      const DB_NAME = 'tabmerger';
      const DB_VERSION = 1;

      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        // Mirrors localDb.ts's upgrade — only runs if the app hasn't opened the DB yet.
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('groups')) {
            const s = d.createObjectStore('groups', { keyPath: 'id' });
            s.createIndex('by-updatedAt', 'updatedAt');
          }
          if (!d.objectStoreNames.contains('groupsState'))
            d.createObjectStore('groupsState', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('sessions')) {
            const s = d.createObjectStore('sessions', { keyPath: 'id' });
            s.createIndex('by-createdAt', 'createdAt');
          }
          if (!d.objectStoreNames.contains('settings'))
            d.createObjectStore('settings', { keyPath: 'id' });
        };
      });

      const readAll = <T,>(store: string): Promise<T[]> =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly');
          const r = tx.objectStore(store).getAll();
          r.onsuccess = () => resolve(r.result as T[]);
          r.onerror = () => reject(r.error);
        });

      type Grp = { id: string; permanent?: boolean; updatedAt: number; name: string };
      const existing = await readAll<Grp>('groups');

      // Find (or synthesise) the permanent Now Open group so the invariant holds.
      let permanent = existing.find((g) => g.permanent) ?? null;
      const now = Date.now();
      if (!permanent) {
        permanent = {
          id: 'nowopen0001',
          name: 'Now Open',
          permanent: true,
          updatedAt: now,
        } as Grp;
      }

      const keptSaved = wipe ? [] : existing.filter((g) => !g.permanent && g.id !== permanent!.id);
      const beforeCount = existing.filter((g) => !g.permanent).length;

      const newGroups = saved.map((g, i) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        updatedAt: now + i + 1,
        windows: g.windows,
        permanent: false,
        starred: false,
        pendingSync: false,
      }));

      // Single write transaction, no awaits between ops (auto-commit safety).
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['groups', 'groupsState'], 'readwrite');
        const groups = tx.objectStore('groups');
        const state = tx.objectStore('groupsState');

        if (wipe) {
          for (const g of existing) if (!g.permanent) groups.delete(g.id);
        }
        // (re)write the permanent group first so it always exists
        groups.put({
          id: permanent!.id,
          name: permanent!.name ?? 'Now Open',
          color: 'rgba(128, 128, 128, 1)',
          updatedAt: permanent!.updatedAt ?? now,
          windows: (permanent as unknown as { windows?: unknown[] }).windows ?? [],
          permanent: true,
          starred: false,
          pendingSync: false,
        });
        for (const g of newGroups) groups.put(g);

        const order = [permanent!.id, ...keptSaved.map((g) => g.id), ...newGroups.map((g) => g.id)];
        state.put({ id: 'state', active: { id: permanent!.id, index: 0 }, order });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      return {
        mode: wipe ? ('wipe' as const) : ('append' as const),
        before: beforeCount,
        added: newGroups.length,
        total: keptSaved.length + newGroups.length,
      };
    },
    { saved, wipe }
  );
}

test('seed dev extension for manual DnD click-around', async () => {
  test.setTimeout(0); // owns its own lifetime — see the wait-for-close promise below

  const extensionPath = resolveExtensionPath();
  const cfg = resolveSeedConfig(process.env);
  const saved = buildSeedGroups(cfg);

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      ...(HEADLESS ? ['--headless=new'] : []),
      `--load-extension=${extensionPath}`,
      `--disable-extensions-except=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`,
    ],
  });

  // Capture bundle errors from any extension page we open (blank-popup diagnostics).
  const pageErrors: string[] = [];
  const watch = (p: Page): void => {
    p.on('console', (m) => {
      if (m.type() === 'error') pageErrors.push(m.text());
    });
    p.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
  };

  const sw = await getServiceWorker(context);
  const extensionId = new URL(sw.url()).hostname;

  // 1. Seed IDB via a throwaway popup.html tab (Playwright can drive that fine).
  const seedTab = await context.newPage();
  watch(seedTab);
  await seedTab.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
  const summary = await writeSeed(seedTab, saved, WIPE);

  // 2. Park that tab on a neutral focused page so openPopup() has a target window.
  await seedTab.goto('data:text/html,<title>seed host</title><h1>TabMerger seed host</h1>', {
    waitUntil: 'load',
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

  // 4. Reconnect over CDP — this fresh client surfaces the popup page target.
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  let popupPage: Page | undefined;
  for (let i = 0; i < 30 && !popupPage; i++) {
    popupPage = findPopupPage(cdp);
    if (!popupPage) await seedTab.waitForTimeout(150);
  }

  let popupMode: 'action-popup' | 'tab' = 'action-popup';
  let rendered = popupPage ? await waitForRender(popupPage) : false;

  // 5. Fall back to opening popup.html as a normal tab if the action popup never
  //    surfaced or came up blank — the user still gets a usable, visible popup.
  if (!rendered) {
    const reason = !popupPage
      ? `chrome.action.openPopup() → ${opened}`
      : 'action popup came up blank';
    console.warn(`[seed:dev] ${reason} — opening popup.html in a normal tab instead.`);
    const tab = await context.newPage();
    watch(tab);
    await tab
      .goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    await tab.bringToFront();
    popupPage = tab;
    popupMode = 'tab';
    rendered = await waitForRender(tab);
  }

  const names = await popupPage!.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('tabmerger', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('groups', 'readonly');
          tx.objectStore('groups').getAll().onsuccess = (e) => {
            const rows = (e.target as IDBRequest).result as { name: string; permanent?: boolean }[];
            resolve(rows.map((g) => `${g.permanent ? '★ ' : '  '}${g.name}`));
          };
        };
      })
  );

  console.log('\n──────────────────────────────────────────────');
  console.log(`[seed:dev] extension:  ${extensionPath}`);
  console.log(`[seed:dev] profile:    ${PROFILE_DIR}`);
  console.log(
    `[seed:dev] config:     groups=${cfg.groups} windows≤${cfg.windowsPerGroup} tabs≤${cfg.tabsPerWindow} vary=${cfg.vary}`
  );
  console.log(
    `[seed:dev] seed:       ${summary.mode} — ${summary.added} groups added, ` +
      `${summary.total} saved groups now (${countSeedTabs(saved)} tabs built)`
  );
  console.log('[seed:dev] groups in IDB:');
  for (const n of names) console.log(`             ${n}`);
  console.log(
    `[seed:dev] popup:      ${popupMode}${rendered ? ' — rendered ✓' : ' — BLANK ✗'}`
  );

  if (!rendered) {
    console.error('\n[seed:dev] ✗ The popup mounted but #root is EMPTY — the bundle threw at load.');
    if (pageErrors.length) {
      console.error('[seed:dev] page errors:');
      for (const e of pageErrors.slice(0, 12)) console.error(`             ${e}`);
    } else {
      console.error('[seed:dev] (no console errors captured — check chrome://extensions → errors)');
    }
    console.error(
      '[seed:dev] Almost always a bad build. Rebuild the dev extension:\n' +
        '             pnpm --filter @tabmerger/extension build:dev\n'
    );
  }

  console.log(
    OPEN_MS > 0
      ? `[seed:dev] auto-closing in ${OPEN_MS}ms (SEED_OPEN_MS set)`
      : '[seed:dev] Chrome will stay open. Close the window or press Ctrl+C to finish.'
  );
  console.log('──────────────────────────────────────────────\n');

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    context.on('close', finish);
    popupPage?.on('close', finish);
    seedTab.on('close', finish);
    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
    if (OPEN_MS > 0) setTimeout(finish, OPEN_MS);
  });

  await cdp.close().catch(() => {});
  await context.close().catch(() => {});
});
