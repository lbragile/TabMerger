// Capture spec for the Tier-3 blog posts: the real TabMerger popup, production build, 800×600 at
// 2x, one test per post, with the helpers in shotHelpers.ts (see ../README.md).
//
//   BLOG_OUT=<raw> BLOG_THEME=light TM_E2E_EXT_DIR=<abs build dir> \
//     pnpm --filter @tabmerger/extension exec playwright test -c scripts/blog-screenshots/tm/playwright.tier3.config.mjs
import { expect } from '../../../packages/extension/e2e/fixtures';
import { DEV, RESEARCH, THEME, TRIP, dismissToasts, fav, openSettingsData, openWindow, popupWithGroups, settle, shot, test } from './shotHelpers';
import type { Page } from '@playwright/test';

test.setTimeout(180_000);

const tab = (title: string, url: string, now: number, extra: Record<string, unknown> = {}) => ({ id: 0, title, url, favIconUrl: fav(new URL(url).hostname), savedAt: now, ...extra });

/** Opens Settings on a tab other than Data. */
async function openSettings(page: Page) {
  await page.getByRole('button', { name: /settings menu|account menu/i }).first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.waitForTimeout(600);
  return page.getByRole('dialog');
}

test('edge-collections-replacement', async ({ context, extensionId }) => {
  const slug = 'edge-collections-replacement';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, DEV.slice(0, 2));
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  // A favorites export in the standard bookmarks HTML format, with two folders the way Edge's
  // "Move to Favorites" leaves former collections (one folder per collection).
  const html = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    '<DT><H3>Trip to Lisbon</H3>',
    '<DL><p>',
    '<DT><A HREF="https://en.wikivoyage.org/wiki/Lisbon">Lisbon – Travel guide at Wikivoyage</A>',
    '<DT><A HREF="https://www.seat61.com/">The Man in Seat 61 | The train travel guide</A>',
    '<DT><A HREF="https://www.timeanddate.com/weather/portugal/lisbon">Weather for Lisbon, Portugal</A>',
    '</DL><p>',
    '<DT><H3>Thesis reading</H3>',
    '<DL><p>',
    '<DT><A HREF="https://arxiv.org/abs/1706.03762">[1706.03762] Attention Is All You Need</A>',
    '<DT><A HREF="https://scholar.google.com/">Google Scholar</A>',
    '</DL><p>',
    '</DL><p>',
  ].join('\n');
  const settings = await openSettingsData(page);
  await settings.locator('input[type="file"]').setInputFiles({ name: 'favorites_edge.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: 'Import 2 groups?' }));
  await expect(confirm.getByText('Import 2 groups?')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, slug, 'import-confirm', [
    { id: 'import-confirm', label: 'Import 2 groups', locator: confirm.getByRole('button', { name: 'Import 2 groups', exact: true }) },
  ]);
  await confirm.getByRole('button', { name: 'Import 2 groups', exact: true }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  await page.getByRole('button', { name: 'Trip to Lisbon', exact: true }).click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'imported-groups', [
    { id: 'imported', label: 'Groups named after the folders', locator: [page.getByRole('button', { name: 'Trip to Lisbon', exact: true }), page.getByRole('button', { name: 'Thesis reading', exact: true })], fit: 'content' },
  ]);
});

test('tab-management-for-developers', async ({ context, extensionId }) => {
  const slug = 'tab-management-for-developers';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, DEV.slice(0, 3));
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.waitForTimeout(500);
  const rules = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'URL Rules', exact: true }) });
  await rules.getByRole('button', { name: /Add rule/ }).click();
  await page.waitForTimeout(300);
  const add = page.getByRole('dialog', { name: 'Add URL Rule' });
  await add.getByPlaceholder(/Pattern, e\.g\./).fill('github.com/lbragile/*');
  await add.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Work', exact: true }).click();
  await page.waitForTimeout(300);
  await add.getByRole('button', { name: /Add rule/ }).click();
  await page.waitForTimeout(500);
  await shot(page, slug, 'url-rules', [
    { id: 'rule', label: 'github.com/lbragile/* → Work', locator: rules.getByText('github.com/lbragile/*', { exact: true }) },
  ]);
  await rules.getByRole('button', { name: 'Save all rules', exact: true }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // A tab that matches the rule: it lands in Work on its own (and stays open).
  await openWindow(context, sw, ['https://github.com/lbragile/TabMerger/issues']);
  await page.bringToFront();
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'rule-result', [
    { id: 'new-tab', label: 'Added by the rule', locator: page.getByRole('main').getByRole('listitem', { name: 'Issues · lbragile/TabMerger' }), fit: 'content' },
  ]);
});

test('organize-tabs-for-research', async ({ context, extensionId }) => {
  const slug = 'organize-tabs-for-research';
  const now = Date.now();
  const { page, sw } = await popupWithGroups(context, extensionId, [
    {
      id: 'blogthes001', name: 'Thesis sources', color: 'rgba(168, 85, 247, 1)', updatedAt: now,
      windows: [{ id: 801, incognito: false, focused: false, tabs: [
        tab('[1706.03762] Attention Is All You Need', 'https://arxiv.org/abs/1706.03762', now, { note: 'Section 3.2: the attention formula I cite in chapter 2' }),
        tab('Spaced repetition - Wikipedia', 'https://en.wikipedia.org/wiki/Spaced_repetition', now),
        tab('Google Scholar', 'https://scholar.google.com/', now),
        tab('Zotero | Your personal research assistant', 'https://www.zotero.org/', now),
      ] }],
    },
  ]);
  await openWindow(context, sw, RESEARCH.slice(2, 4));
  await settle(context, page, 'Google Scholar');
  await page.getByRole('button', { name: 'Thesis sources', exact: true }).click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  const row = page.getByRole('main').getByRole('listitem', { name: 'Spaced repetition - Wikipedia' });
  await row.click({ button: 'right' });
  await page.waitForTimeout(400);
  await shot(page, slug, 'tab-menu', [
    { id: 'add-note', label: 'Add note', locator: page.getByRole('menuitem', { name: /Add note/ }) },
    { id: 'remind-me', label: 'Remind me…', locator: page.getByRole('menuitem', { name: /Remind me/ }) },
  ]);
  await page.getByRole('menuitem', { name: /Remind me/ }).click();
  await page.waitForTimeout(500);
  await shot(page, slug, 'reminder', [
    { id: 'remind-in', label: 'Remind me in…', locator: page.getByText('Remind me in…', { exact: true }) },
  ]);
});

test('share-a-set-of-tabs', async ({ context, extensionId }) => {
  const slug = 'share-a-set-of-tabs';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, TRIP.slice(0, 3));
  await settle(context, page, 'Google Maps');
  // Ctrl+click (⌘ on a Mac) selects groups; the selection bar offers Share.
  await page.getByRole('button', { name: 'Work', exact: true }).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Reading list', exact: true }).click({ modifiers: ['Control'] });
  await page.waitForTimeout(600);
  await shot(page, slug, 'selection-share', [
    { id: 'share', label: 'Share', locator: page.getByRole('button', { name: /^Share$/ }) },
  ]);
  void THEME;
});
