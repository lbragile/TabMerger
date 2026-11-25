// Capture spec for the "TabMerger guides" series (one feature per post): the real TabMerger popup,
// production build, 800×600 at 2x, one test per post, with the helpers in shotHelpers.ts (see
// ../README.md).
//
//   BLOG_OUT=<raw> BLOG_THEME=light TM_E2E_EXT_DIR=<abs build dir> \
//     pnpm --filter @tabmerger/extension exec playwright test -c scripts/blog-screenshots/tm/playwright.series.config.mjs
import { expect } from '../../../packages/extension/e2e/fixtures';
import { seedSettings } from '../../../packages/extension/e2e/helpers';
import { DEV, NEWS, RESEARCH, THEME, TRIP, chromeGroup, dismissToasts, fav, groupSummary, openSettingsData, openWindow, pick, popupWithGroups, settle, shot, test } from './shotHelpers';
import type { Page } from '@playwright/test';

test.setTimeout(180_000);

const tab = (title: string, url: string, now: number, extra: Record<string, unknown> = {}) => ({ id: 0, title, url, favIconUrl: fav(new URL(url).hostname), savedAt: now, ...extra });

/** Two more saved groups, so the sidebar looks like a real working week. */
function extraGroups(now: number) {
  return [
    {
      id: 'blogthes001', name: 'Thesis sources', color: 'rgba(168, 85, 247, 1)', updatedAt: now,
      windows: [
        { id: 801, name: 'Papers', incognito: false, focused: false, tabs: [
          tab('[1706.03762] Attention Is All You Need', 'https://arxiv.org/abs/1706.03762', now),
          tab('Spaced repetition - Wikipedia', 'https://en.wikipedia.org/wiki/Spaced_repetition', now),
        ] },
        { id: 802, name: 'Tools', incognito: false, focused: false, tabs: [
          tab('Google Scholar', 'https://scholar.google.com/', now),
          tab('Zotero | Your personal research assistant', 'https://www.zotero.org/', now),
        ] },
      ],
    },
    {
      id: 'blogtrip001', name: 'Trip to Lisbon', color: 'rgba(249, 115, 22, 1)', updatedAt: now,
      windows: [{ id: 803, incognito: false, focused: false, tabs: [
        tab('Lisbon – Travel guide at Wikivoyage', 'https://en.wikivoyage.org/wiki/Lisbon', now),
        tab('The Man in Seat 61 | The train travel guide', 'https://www.seat61.com/', now),
        tab('Weather for Lisbon, Portugal', 'https://www.timeanddate.com/weather/portugal/lisbon', now),
      ] }],
    },
  ];
}

async function saveSession(page: Page, name: string, description?: string, shotName?: string, slug?: string) {
  await page.getByRole('button', { name: 'Save current session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Session name').fill(name);
  if (description) await dialog.getByLabel(/^Description/).fill(description);
  await dialog.getByRole('radio', { name: THEME === 'dark' ? 'Cyan' : 'Purple' }).check({ force: true });
  await page.waitForTimeout(300);
  if (shotName && slug) {
    await shot(page, slug, shotName, [
      { id: 'session-name', label: 'Session name', locator: dialog.getByLabel('Session name') },
      ...(description ? [{ id: 'description', label: 'Description', locator: dialog.getByLabel(/^Description/) }] : []),
    ]);
  }
  await dialog.getByRole('button', { name: /^save$/i }).click();
  await expect(dialog).toHaveCount(0);
  await dismissToasts(page);
}

async function expandSessions(page: Page) {
  const toggle = page.getByRole('button', { name: /^sessions \(/i });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.waitForTimeout(400);
}

async function openSearch(page: Page) {
  await page.evaluate(() => window.focus());
  await page.keyboard.press('Control+K');
  const input = page.getByPlaceholder(/^Search tabs, groups/);
  if (!(await input.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Open search' }).click();
  await expect(input).toBeFocused();
  return input;
}

/** Closes the "approaching the free limit" banner, if shown, so it does not cover the overlay. */
async function dismissLimitBanner(page: Page) {
  const banner = page.getByText(/approaching the free limit/);
  if (await banner.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss', exact: true }).first().click();
    await page.waitForTimeout(400);
  }
}

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search tabs and groups' }).locator('xpath=..');

test('tabmerger-daily-workflow', async ({ context, extensionId }) => {
  const slug = 'tabmerger-daily-workflow';
  const now = Date.now();
  const { page, sw } = await popupWithGroups(context, extensionId, extraGroups(now));
  await openWindow(context, sw, DEV.slice(0, 4));
  await openWindow(context, sw, NEWS);
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  await dismissLimitBanner(page);
  await shot(page, slug, 'now-open', [
    { id: 'now-open-summary', label: '2 Windows ◆ 6 Tabs', locator: groupSummary(page) },
  ]);
  await saveSession(page, 'Monday plan');
  await expandSessions(page);
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'workspace', [
    {
      id: 'groups', label: 'Your groups',
      locator: ['Work', 'Reading list', 'Thesis sources', 'Trip to Lisbon'].map((n) => page.getByRole('button', { name: n, exact: true })),
      fit: 'content',
    },
    { id: 'session', label: 'A saved session', locator: page.getByText('Monday plan', { exact: true }).first(), fit: 'content' },
  ]);
});

test('start-your-workday-with-saved-tabs', async ({ context, extensionId }) => {
  const slug = 'start-your-workday-with-saved-tabs';
  const now = Date.now();
  const { page, sw } = await popupWithGroups(context, extensionId, extraGroups(now).slice(0, 1));
  await openWindow(context, sw, NEWS);
  await settle(context, page, 'Hacker News');
  await saveSession(page, 'Workday', 'Mail, calendar, PRs, reading and the thesis', 'save-session', slug);
  await expandSessions(page);
  await page.getByText('Workday', { exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'session-view', [
    { id: 'restore-session', label: 'Restore session', locator: page.getByRole('button', { name: 'Restore session', exact: true }) },
  ]);
  await page.getByRole('button', { name: 'Restore session', exact: true }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: 'Restore this session?' }));
  await expect(confirm.getByText('Restore this session?')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, slug, 'restore-confirm', [
    { id: 'close-all', label: 'Close all windows', locator: confirm.getByRole('button', { name: 'Close all windows', exact: true }) },
  ]);
  // Never confirm here: restoring closes every window, the test browser's included.
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForTimeout(500);
  // "Open all in new window" lives in the sidebar's right-click menu.
  await page.getByRole('button', { name: 'Work', exact: true }).click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /Open all in new window/ }).hover();
  await page.getByRole('menuitem', { name: /Open all in new window/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, slug, 'open-group', [
    { id: 'open-all', label: 'Open all in new window', locator: page.getByRole('menuitem', { name: /Open all in new window/ }) },
  ]);
});

test('never-lose-a-tab-again', async ({ context, extensionId }) => {
  const slug = 'never-lose-a-tab-again';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, TRIP.slice(0, 4));
  const research = await openWindow(context, sw, RESEARCH.slice(0, 3));
  await settle(context, page, 'Google Maps');

  const settings = await openSettingsData(page);
  await settings.getByRole('switch', { name: /^auto-save open tabs$/i }).click();
  await page.waitForTimeout(800);
  await pick(page, settings, 'Schedule', 'Every hour');
  await pick(page, settings, 'When open tabs pass', '50 open tabs');
  await dismissToasts(page);
  await shot(page, slug, 'auto-save-settings', [
    { id: 'schedule', label: 'Schedule', locator: [settings.getByText('Schedule', { exact: true }), settings.getByLabel('Schedule', { exact: true })] },
    { id: 'threshold', label: 'When open tabs pass', locator: [settings.getByText('When open tabs pass', { exact: true }), settings.getByLabel('When open tabs pass', { exact: true })] },
    { id: 'run-now', label: 'Auto-save now', locator: settings.getByRole('button', { name: 'Auto-save now' }) },
  ]);
  await settings.getByRole('button', { name: 'Auto-save now' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await dismissToasts(page);

  const autoToggle = page.getByRole('button', { name: /^auto-saved/i }).first();
  if ((await autoToggle.getAttribute('aria-expanded')) === 'false') await autoToggle.click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Open Auto-saved/ }).first().click();
  await page.waitForTimeout(900);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'auto-saved', [
    { id: 'keep', label: 'Keep as group', locator: page.getByRole('main').getByRole('button', { name: 'Keep as group', exact: true }) },
  ]);

  // Close a whole window, then find it again with closed:.
  await sw.evaluate(async (id: number) => chrome.windows.remove(id), research);
  await sw.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  await page.bringToFront();
  const input = await openSearch(page);
  await input.fill('closed: ');
  await page.waitForTimeout(800);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'closed-window', [
    { id: 'search-input', label: 'closed:', locator: searchBox(page) },
    { id: 'closed-window', label: 'A closed window', locator: page.getByText(/^Window · 3 tabs$/).first(), fit: 'content' },
  ]);
});

test('search-all-your-tabs-with-tabmerger', async ({ context, extensionId }) => {
  const slug = 'search-all-your-tabs-with-tabmerger';
  const now = Date.now();
  const { page, sw } = await popupWithGroups(context, extensionId, extraGroups(now));
  const win = await openWindow(context, sw, DEV);
  await chromeGroup(sw, win, DEV.slice(0, 3), 'Sprint', 'blue');
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  await dismissLimitBanner(page);

  const input = await openSearch(page);
  await page.waitForTimeout(500);
  await shot(page, slug, 'search-examples', [
    { id: 'search-input', label: 'Ctrl+K', locator: searchBox(page) },
    { id: 'examples', label: 'Try these searches', locator: page.getByText('Try these searches', { exact: true }), fit: 'content' },
  ]);
  await input.fill('docs');
  await page.waitForTimeout(800);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'search-results', [
    { id: 'search-input', label: 'docs', locator: searchBox(page) },
  ]);
  await input.fill('window:');
  await page.waitForTimeout(800);
  await shot(page, slug, 'search-window-picker', [
    { id: 'search-input', label: 'window:', locator: searchBox(page) },
    { id: 'pick-window', label: 'Pick a window', locator: page.getByText('Pick a window', { exact: true }), fit: 'content' },
  ]);
  // The panel behind the search, with non-matching tabs dimmed instead of hidden.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await seedSettings(page, { appSettings: { theme: THEME, searchNonMatching: 'dim' } });
  await page.reload({ waitUntil: 'networkidle' });
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  await dismissLimitBanner(page);
  const again = await openSearch(page);
  await again.fill('group:"Thesis sources" wiki');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Thesis sources', exact: true }).click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await shot(page, slug, 'search-dim', [
    { id: 'match', label: 'The match', locator: page.getByRole('main').getByRole('listitem', { name: 'Spaced repetition - Wikipedia' }), fit: 'content' },
  ]);
});
