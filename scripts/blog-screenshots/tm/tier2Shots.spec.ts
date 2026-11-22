// Capture spec for the Tier-2 blog posts (tabs-vs-bookmarks ... too-many-tabs-slow-browser): the
// real TabMerger popup, production build, 800×600 at 2x, one test per post, with the helpers in
// shotHelpers.ts. Also saves the real JSON that Settings → Data → Export JSON downloads
// (BLOG_OUT/export-open-tabs/tabmerger-export.json), quoted in the export post.
//
//   BLOG_OUT=<raw> BLOG_THEME=light TM_E2E_EXT_DIR=<abs build dir> \
//     pnpm --filter @tabmerger/extension exec playwright test -c scripts/blog-screenshots/tm/playwright.tier2.config.mjs
import fs from 'fs';
import { expect } from '../../../packages/extension/e2e/fixtures';
import {
  DEV, NEWS, OUT, RESEARCH, THEME, TRIP, chromeGroup, dismissToasts, fav, groupSummary, openSettingsData, openWindow, popupWithGroups, settle, shot, test,
} from './shotHelpers';
import type { Page } from '@playwright/test';

test.setTimeout(180_000);

/** Opens the ⋯ menu of the sidebar group named `name`. */
async function groupMenu(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'More group options' }).first().click();
  await page.waitForTimeout(300);
}

const tab = (title: string, url: string, now: number) => ({ id: 0, title, url, favIconUrl: fav(new URL(url).hostname), savedAt: now });

test('tabs-vs-bookmarks', async ({ context, extensionId }) => {
  const slug = 'tabs-vs-bookmarks';
  const now = Date.now();
  const { page, sw } = await popupWithGroups(context, extensionId, [
    {
      id: 'blogread002', name: 'Read this week', color: 'rgba(249, 115, 22, 1)', note: 'Skim on Friday, bookmark the keepers', updatedAt: now,
      windows: [{ id: 601, incognito: false, focused: false, tabs: [
        tab('Spaced repetition - Wikipedia', 'https://en.wikipedia.org/wiki/Spaced_repetition', now),
        tab('[1706.03762] Attention Is All You Need', 'https://arxiv.org/abs/1706.03762', now),
        tab('Nature', 'https://www.nature.com/', now),
        tab('Hacker News', 'https://news.ycombinator.com/', now),
      ] }],
    },
  ]);
  await openWindow(context, sw, DEV.slice(0, 3));
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  await page.getByRole('button', { name: 'Read this week', exact: true }).click();
  await page.waitForTimeout(800);
  await shot(page, slug, 'read-later-group', [
    { id: 'group-row', label: 'Read this week', locator: page.getByRole('button', { name: 'Read this week', exact: true }), fit: 'content' },
    { id: 'group-note', label: 'The group note', locator: page.getByRole('button', { name: 'Edit group note' }) },
  ]);
});

test('find-a-tab-among-hundreds', async ({ context, extensionId }) => {
  const slug = 'find-a-tab-among-hundreds';
  const { page, sw } = await popupWithGroups(context, extensionId);
  const win = await openWindow(context, sw, [...DEV.slice(0, 3), ...RESEARCH.slice(0, 3)]);
  await chromeGroup(sw, win, DEV.slice(0, 3), 'Sprint', 'blue');
  await openWindow(context, sw, TRIP);
  await settle(context, page, 'Google Maps');
  await page.getByRole('button', { name: 'Open search' }).click();
  const input = page.getByPlaceholder(/^Search tabs, groups/);
  await expect(input).toBeFocused();
  await page.waitForTimeout(500);
  await shot(page, slug, 'search-filters', [
    { id: 'search-input', label: 'Search box', locator: page.getByRole('combobox', { name: 'Search tabs and groups' }).locator('xpath=..') },
  ]);
  // tag: first, while Now Open (where the Chrome group's tabs are) is still the selected group.
  await input.fill('tag:Sprint');
  await page.waitForTimeout(700);
  await shot(page, slug, 'search-tag-filter', [
    { id: 'search-input', label: 'tag:Sprint', locator: page.getByRole('combobox', { name: 'Search tabs and groups' }).locator('xpath=..') },
  ]);
  await input.fill('group:"Work" pull');
  await page.waitForTimeout(700);
  await shot(page, slug, 'search-group-filter', [
    { id: 'search-input', label: 'group:"Work" pull', locator: page.getByRole('combobox', { name: 'Search tabs and groups' }).locator('xpath=..') },
  ]);
});

test('merge-browser-windows', async ({ context, extensionId }) => {
  const slug = 'merge-browser-windows';
  const { page, sw } = await popupWithGroups(context, extensionId);
  const w1 = await openWindow(context, sw, [DEV[0], DEV[4], DEV[5]]);
  const w2 = await openWindow(context, sw, RESEARCH.slice(0, 3));
  const w3 = await openWindow(context, sw, TRIP.slice(0, 3));
  await settle(context, page, 'Google Scholar');
  await shot(page, slug, 'three-windows', [{ id: 'summary', label: '3 Windows ◆ 9 Tabs', locator: groupSummary(page) }]);

  await page.getByRole('button', { name: /^Add Group$/ }).click();
  await page.waitForTimeout(500);
  const rename = page.locator('input:focus');
  if (await rename.count()) {
    await rename.fill('All in one');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'More group options' }).first().click();
  await page.getByRole('menuitem', { name: /Merge with current/ }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  // "Open all in new window" is in the sidebar row's menu (right-click the group).
  await page.getByRole('button', { name: 'All in one', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Open all in new window/ }).hover();
  await page.waitForTimeout(400);
  await shot(page, slug, 'open-all-menu', [
    { id: 'open-all', label: 'Open all in new window', locator: page.getByRole('menuitem', { name: /Open all in new window/ }) },
  ]);
  const before = new Set(context.pages());
  await page.getByRole('menuitem', { name: /Open all in new window/ }).click();
  // The new window's tabs load before Playwright's stubs apply to them: reload each through the
  // stubs (same address), like openWindow() does, so titles and icons match the other captures.
  await expect.poll(() => context.pages().filter((p) => !before.has(p)).length, { timeout: 20_000 }).toBe(9);
  for (const p of context.pages().filter((x) => !before.has(x))) await p.goto(p.url()).catch(() => {});
  // Wait until the new window's nine tabs have loaded (title and icon) before closing the others.
  await expect
    .poll(async () => sw.evaluate(async (old: number[]) => (await chrome.tabs.query({})).filter((t) => !old.includes(t.windowId) && t.status === 'complete' && t.favIconUrl).length, [w1, w2, w3]), { timeout: 30_000 })
    .toBe(9);
  // Close the three original windows: what's left is one window with every tab.
  for (const id of [w1, w2, w3]) await sw.evaluate((wid: number) => chrome.windows.remove(wid), id);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Now Open', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'one-window', [{ id: 'summary', label: '1 Window ◆ 9 Tabs', locator: groupSummary(page) }]);
});

test('close-duplicate-tabs', async ({ context, extensionId }) => {
  // Live duplicates across two real windows: Deduplicate on Now Open closes the extra browser tabs.
  const slug = 'close-duplicate-tabs';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, [RESEARCH[0], RESEARCH[1], RESEARCH[2], RESEARCH[0]]);
  await openWindow(context, sw, [RESEARCH[3], RESEARCH[1], RESEARCH[4], RESEARCH[2]]);
  await settle(context, page, 'Nature');
  await shot(page, slug, 'before', [{ id: 'summary', label: '2 Windows ◆ 8 Tabs', locator: groupSummary(page) }]);
  await page.getByRole('button', { name: 'More group options' }).first().click();
  await page.getByRole('menuitem', { name: /Deduplicate tabs/ }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog.getByRole('button', { name: /^Remove \d+ duplicates?$/ })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, slug, 'confirm', [
    { id: 'confirm', label: 'Remove 3 duplicates', locator: dialog.getByRole('button', { name: /^Remove \d+ duplicates?$/ }) },
  ]);
  await dialog.getByRole('button', { name: /^Remove \d+ duplicates?$/ }).click();
  await page.waitForTimeout(2000);
  await dismissToasts(page);
  // The extra browser tabs are really gone.
  expect(await sw.evaluate(async () => (await chrome.tabs.query({})).filter((t) => t.url?.startsWith('https://')).length)).toBe(5);
  await shot(page, slug, 'after', [{ id: 'summary', label: '2 Windows ◆ 5 Tabs', locator: groupSummary(page) }]);
});

test('export-open-tabs', async ({ context, extensionId }) => {
  const slug = 'export-open-tabs';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, RESEARCH.slice(0, 3));
  await settle(context, page, 'Google Scholar');
  const settings = await openSettingsData(page);
  const exportButton = settings.getByRole('button', { name: 'Export JSON', exact: true });
  await exportButton.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, slug, 'settings-export', [
    { id: 'export-json', label: 'Export JSON', locator: exportButton },
    { id: 'import-file', label: 'Import file', locator: settings.getByRole('button', { name: 'Import file', exact: true }) },
  ]);
  if (THEME === 'light') {
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    fs.mkdirSync(`${OUT}/${slug}`, { recursive: true });
    await download.saveAs(`${OUT}/${slug}/tabmerger-export.json`);
  }
});

test('too-many-tabs-slow-browser', async ({ context, extensionId }) => {
  const slug = 'too-many-tabs-slow-browser';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, DEV);
  await openWindow(context, sw, RESEARCH);
  await settle(context, page, 'Google Scholar');
  await page.getByRole('button', { name: /^Add Group$/ }).click();
  await page.waitForTimeout(500);
  const rename = page.locator('input:focus');
  if (await rename.count()) {
    await rename.fill('Parked for later');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'More group options' }).first().click();
  await page.getByRole('menuitem', { name: /Merge with current/ }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  // Now Open's sidebar menu (right-click) closes every open browser window; the group keeps them.
  await page.getByRole('button', { name: 'Now Open', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Close all windows/ }).hover();
  await page.waitForTimeout(400);
  await shot(page, slug, 'close-all-menu', [
    { id: 'close-all', label: 'Close all windows', locator: page.getByRole('menuitem', { name: /Close all windows/ }) },
  ]);
});
