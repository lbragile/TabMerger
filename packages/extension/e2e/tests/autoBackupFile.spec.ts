import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { BACKUP_FILE_COPY } from '@tabmerger/shared';
import { dismissTour, openPopup, seedAndReload, seedSettings, signInAsPro } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * "Last file" under Settings -> Data -> Automatic backups -> "Also save a file to this computer".
 *
 * Needs the file-copy build: a headless browser cannot answer the `downloads` permission prompt, so
 * the extension is built with `TM_E2E_GRANT_DOWNLOADS=1` (permission declared up front; see
 * e2e/TEST_CASES.md). Set `TM_E2E_DOWNLOADS_EXT_DIR` to that build's folder (default
 * `.output/chrome-mv3-dev-downloads`); without it the whole file skips itself.
 *
 * The worker's own backup run needs the network, which `page.route()` cannot reach, so the download
 * is started from the popup page the way the worker does it, and the two settings the worker writes
 * after a file (`autoBackupFileLast`, `autoBackupFileStatus`) are seeded. Everything under test (the
 * lookup by id, the path, the gone state, the buttons) is the real code against the real browser.
 *
 * `show` / `showDefaultFolder` are recorded by an init script and NOT passed on: a headless run
 * must not open a file manager.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(here, '../..', process.env.TM_E2E_DOWNLOADS_EXT_DIR?.trim() || '.output/chrome-mv3-dev-downloads');
const available = fs.existsSync(path.join(EXT_DIR, 'manifest.json'));

test.skip(!available, `no file-copy build in ${EXT_DIR} (see e2e/TEST_CASES.md)`);
test.describe.configure({ mode: 'serial' });

declare global {
  interface Window {
    __calls: Array<{ fn: string; id?: number }>;
  }
}

let context: BrowserContext;
let extensionId: string;
let downloadsDir: string;

test.beforeAll(async () => {
  if (!available) return;
  downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-e2e-downloads-'));
  context = await chromium.launchPersistentContext('', {
    headless: false,
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    args: ['--headless=new', `--load-extension=${EXT_DIR}`, `--disable-extensions-except=${EXT_DIR}`, '--no-first-run', '--no-default-browser-check'],
  });
  // Recorded, never forwarded; a path to show instead of the real one when the test asks (sessionStorage survives reloads).
  await context.addInitScript(() => {
    if (!location.protocol.startsWith('chrome-extension')) return;
    window.__calls = [];
    const d = chrome.downloads;
    if (!d) return;
    d.show = ((id: number) => void window.__calls.push({ fn: 'show', id })) as typeof d.show;
    d.showDefaultFolder = (() => void window.__calls.push({ fn: 'showDefaultFolder' })) as typeof d.showDefaultFolder;
    const search = d.search.bind(d);
    d.search = (async (query: chrome.downloads.DownloadQuery) => {
      const items = await search(query);
      const fake = sessionStorage.getItem('__fakePath');
      return fake === null ? items : items.map((item) => ({ ...item, filename: fake }));
    }) as typeof d.search;
  });
  await dismissTour(context).catch(() => undefined);
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  extensionId = new URL(sw.url()).hostname;
});

test.afterAll(async () => {
  await context?.close();
  if (downloadsDir) fs.rmSync(downloadsDir, { recursive: true, force: true });
});

async function openDataTab(page: Page): Promise<void> {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: /^data$/i }).click();
}

/** Writes a real backup-shaped file through the browser, like the worker, and records it like the worker does. */
async function writeBackupFile(page: Page): Promise<number> {
  const id = await page.evaluate(async () => {
    const url = `data:application/json;charset=utf-8;base64,${btoa('[]')}`;
    const downloadId = await chrome.downloads.download({ url, filename: 'TabMerger/TabMerger backup e2e.json', saveAs: false, conflictAction: 'uniquify' });
    for (let i = 0; i < 100; i++) {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (item?.state === 'complete') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return downloadId;
  });
  const now = Date.now();
  await seedSettings(page, {
    appSettings: { autoBackupEnabled: true, autoBackupFileEnabled: true },
    autoBackupFileLast: { id, at: now - 120_000 },
    autoBackupFileStatus: { at: now - 120_000, result: 'saved', path: 'TabMerger/TabMerger backup e2e.json' },
  });
  return id;
}

async function ready(): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
  await signInAsPro(page);
  await page.reload({ waitUntil: 'networkidle' });
  return page;
}

test('a written backup file shows its real absolute path and when it was saved under "Last file"', async () => {
  const page = await ready();
  const id = await writeBackupFile(page);
  await page.reload({ waitUntil: 'networkidle' });
  await openDataTab(page);

  const shown = (await page.getByTestId('backup-file-path').textContent()) ?? '';
  const real = await page.evaluate(async (downloadId) => (await chrome.downloads.search({ id: downloadId }))[0].filename, id);
  expect(shown).toBe(real);
  expect(path.isAbsolute(shown)).toBe(true);
  expect(shown.startsWith(downloadsDir)).toBe(true);
  expect(fs.existsSync(shown)).toBe(true);
  await expect(page.getByRole('group', { name: BACKUP_FILE_COPY.lastFileLabel })).toContainText(/Saved 2 mins ago/);
  await expect(page.getByText(BACKUP_FILE_COPY.whereToFind)).toBeVisible();

  // "Show in folder" asks the browser to show THAT download
  await page.getByRole('button', { name: BACKUP_FILE_COPY.showInFolder }).click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([{ fn: 'show', id }]);
  await page.close();
});

test('after the file is removed the block says it was moved or deleted, shows no path, and the button opens the Downloads folder', async () => {
  const page = await ready();
  const id = await writeBackupFile(page);
  const file = await page.evaluate(async (downloadId) => (await chrome.downloads.search({ id: downloadId }))[0].filename, id);
  await page.evaluate((downloadId) => chrome.downloads.removeFile(downloadId), id);
  expect(fs.existsSync(file)).toBe(false);
  await page.reload({ waitUntil: 'networkidle' });
  await openDataTab(page);

  const block = page.getByRole('group', { name: BACKUP_FILE_COPY.lastFileLabel });
  await expect(block).toContainText(BACKUP_FILE_COPY.lastFileGone);
  await expect(page.getByTestId('backup-file-path')).toHaveCount(0);
  const button = page.getByRole('button', { name: BACKUP_FILE_COPY.showDownloadsFolder });
  await expect(page.getByRole('button', { name: BACKUP_FILE_COPY.showInFolder })).toHaveCount(0);
  await button.click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([{ fn: 'showDefaultFolder' }]);
  await page.close();
});

test('a 700-character path wraps inside the popup, and markup and text-direction characters are shown as plain text', async () => {
  const page = await ready();
  await writeBackupFile(page);
  const hostile = `/home/me/${'d'.repeat(700)}/<img src=x onerror=alert(1)>backup‮nosj.exe`;
  await page.evaluate((p) => sessionStorage.setItem('__fakePath', p), hostile);
  await page.reload({ waitUntil: 'networkidle' });
  await openDataTab(page);

  const shown = page.getByTestId('backup-file-path');
  await expect(shown).toContainText('<img src=x onerror=alert(1)>backupnosj.exe');
  expect(await shown.evaluate((el) => el.querySelector('img, a') === null && !el.textContent!.includes('‮'))).toBe(true);
  const overflow = await page.getByRole('region', { name: 'Automatic backups' }).evaluate((el) => {
    const scroller = el.closest('.overflow-y-auto') as HTMLElement | null;
    return { section: el.scrollWidth - el.clientWidth, scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0 };
  });
  expect(overflow.section).toBeLessThanOrEqual(0);
  expect(overflow.scroller).toBeLessThanOrEqual(0);
  await page.close();
});

test('a newer write that failed shows an amber "Last attempt" line while the previous file stays listed', async () => {
  const page = await ready();
  await writeBackupFile(page);
  await seedSettings(page, { autoBackupFileStatus: { at: Date.now() - 30_000, result: 'failed', path: 'TabMerger/x.json' } });
  await page.reload({ waitUntil: 'networkidle' });
  await openDataTab(page);

  await expect(page.getByTestId('backup-file-path')).toBeVisible();
  await expect(page.getByText(/^Last attempt, .* ago: The file could not be saved to this computer\.$/)).toBeVisible();
  await page.close();
});
