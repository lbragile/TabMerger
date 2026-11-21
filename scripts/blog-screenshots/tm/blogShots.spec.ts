// Capture spec for the blog post: the real TabMerger popup (production build in
// packages/extension/.output/chrome-mv3, never the dev build) at 2x. Reuses the extension's e2e
// fixtures and helpers. Run through scripts/blog-screenshots/run.mjs (see README.md).
import { test as base, expect } from '../../../packages/extension/e2e/fixtures';
import { PRODUCTION_EXTENSION_PATH } from '../../../packages/extension/e2e/extensionPath';
import { dismissTour, openPopup, seedIdb, seedSettings } from '../../../packages/extension/e2e/helpers';
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
// @ts-expect-error -- plain ESM helper shared with native.mjs (no type declarations)
import { recordBoxes } from '../boxes.mjs';

const OUT = process.env.BLOG_OUT!;
const THEME = (process.env.BLOG_THEME ?? 'light') as 'light' | 'dark';

const test = base.extend({
  context: async ({ playwright }, use) => {
    const ext = PRODUCTION_EXTENSION_PATH;
    const context = await playwright.chromium.launchPersistentContext('', {
      headless: false,
      deviceScaleFactor: 2,
      viewport: { width: 800, height: 600 },
      colorScheme: THEME,
      reducedMotion: 'reduce',
      args: ['--headless=new', `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, '--no-first-run', '--no-default-browser-check'],
    });
    await dismissTour(context);
    await use(context);
    await context.close();
  },
});

// Stub pages: real URLs, a <title>, and the site's real favicon (via Google's favicon service).
const TITLES: Record<string, string> = {
  'https://en.wikipedia.org/wiki/Spaced_repetition': 'Spaced repetition - Wikipedia',
  'https://arxiv.org/abs/1706.03762': '[1706.03762] Attention Is All You Need',
  'https://scholar.google.com/': 'Google Scholar',
  'https://www.nature.com/': 'Nature',
  'https://www.zotero.org/': 'Zotero | Your personal research assistant',
  'https://en.wikivoyage.org/wiki/Lisbon': 'Lisbon – Travel guide at Wikivoyage',
  'https://www.google.com/maps': 'Google Maps',
  'https://www.seat61.com/': 'The Man in Seat 61 | The train travel guide',
  'https://en.wikivoyage.org/wiki/Sintra': 'Sintra – Travel guide at Wikivoyage',
  'https://www.timeanddate.com/weather/portugal/lisbon': 'Weather for Lisbon, Portugal',
};
const RESEARCH = Object.keys(TITLES).slice(0, 5);
/** The group the post saves every open tab into (its date is the capture day's in the post's copy). */
const GROUP_NAME = 'Open tabs, Nov 19';
const TRIP = Object.keys(TITLES).slice(5);

async function routeStubs(context: BrowserContext) {
  await context.route(/^https:\/\//, (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('https://www.google.com/s2/favicons')) return route.continue();
    if (req.resourceType() !== 'document') return route.abort();
    const title = TITLES[url] ?? TITLES[Object.keys(TITLES).find((k) => url.startsWith(k)) ?? ''] ?? 'Page';
    const host = new URL(url).hostname;
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset=utf-8><title>${title}</title><link rel=icon href="https://www.google.com/s2/favicons?sz=64&domain=${host}"><h1>${title}</h1>`,
    });
  });
}

/**
 * A real window with real tabs: the extension creates it with blank tabs, then Playwright
 * navigates each tab (Playwright navigations go through the context route, so stubs + favicons apply).
 */
async function openWindow(context: BrowserContext, sw: Worker, urls: string[]): Promise<number> {
  const before = new Set(context.pages());
  const id = await sw.evaluate(async (n: number) => (await chrome.windows.create({ url: Array.from({ length: n }, () => 'about:blank'), focused: false }))!.id!, urls.length);
  await expect.poll(() => context.pages().filter((p) => !before.has(p)).length, { timeout: 15_000 }).toBe(urls.length);
  const fresh = context.pages().filter((p) => !before.has(p));
  const order: number[] = await sw.evaluate(async (wid: number) => (await chrome.tabs.query({ windowId: wid })).map((t) => t.index), id);
  for (let i = 0; i < fresh.length; i++) await fresh[i].goto(urls[i] ?? urls[order[i]]);
  await expect
    .poll(async () => sw.evaluate(async (wid: number) => (await chrome.tabs.query({ windowId: wid })).filter((t) => t.status === 'complete' && t.favIconUrl).length, id), { timeout: 20_000 })
    .toBe(urls.length);
  await sw.evaluate(() => new Promise((r) => setTimeout(r, 800)));
  return id;
}

/** An annotation box for boxes.json: measured from the live DOM right after the screenshot. */
type Target = { id: string; label: string; locator: Locator | Locator[]; all?: boolean; each?: boolean; fit?: 'content' };

async function shot(page: Page, name: string, targets: Target[] = []) {
  await page.mouse.move(120, 20);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(500);
  const png = `${OUT}/tm-${name}-${THEME}.png`;
  await page.screenshot({ path: png, animations: 'disabled', caret: 'hide' });
  await recordBoxes(page, png, targets);
}

/** The "N Windows ◆ M Tabs" count above a group's windows (never the sidebar footer, which starts with groups). */
const groupSummary = (page: Page) => page.getByText(/^\d+ Windows? ◆ \d+ Tabs?$/);

const dismissToasts = async (page: Page) => {
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
};

test.setTimeout(180_000);

test('blog screenshots', async ({ context, extensionId }) => {
  await routeStubs(context);
  const page = await openPopup(context, extensionId);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.emulateMedia({ colorScheme: THEME, reducedMotion: 'reduce' });
  await expect(page.locator('[data-sidebar-group-index="0"]')).toBeVisible();

  // Two saved groups so the sidebar looks lived-in.
  const now = await page.evaluate(() => Date.now());
  const fav = (d: string) => `https://www.google.com/s2/favicons?sz=64&domain=${d}`;
  await seedIdb(page, [
    { id: 'nowopen0001', name: 'Now Open', permanent: true, color: 'rgba(128, 128, 128, 1)', updatedAt: now, windows: [] },
    {
      id: 'blogwork001', name: 'Work', color: 'rgba(59, 130, 246, 1)', starred: true, updatedAt: now,
      windows: [{ id: 501, incognito: false, focused: false, tabs: [
        { id: 0, title: 'Inbox - Gmail', url: 'https://mail.google.com/mail/u/0/', favIconUrl: fav('mail.google.com'), savedAt: now },
        { id: 0, title: 'Calendar - Week of Nov 16', url: 'https://calendar.google.com/calendar/u/0/r/week', favIconUrl: fav('calendar.google.com'), savedAt: now },
        { id: 0, title: 'Pull requests · lbragile/TabMerger', url: 'https://github.com/lbragile/TabMerger/pulls', favIconUrl: fav('github.com'), savedAt: now },
      ] }],
    },
    {
      id: 'blogread001', name: 'Reading list', color: 'rgba(34, 197, 94, 1)', updatedAt: now,
      windows: [{ id: 502, incognito: false, focused: false, tabs: [
        { id: 0, title: 'Tab (interface) - Wikipedia', url: 'https://en.wikipedia.org/wiki/Tab_(interface)', favIconUrl: fav('en.wikipedia.org'), savedAt: now },
        { id: 0, title: 'chrome.tabs API | Chrome for Developers', url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs', favIconUrl: fav('developer.chrome.com'), savedAt: now },
      ] }],
    },
  ]);
  await seedSettings(page, { appSettings: { theme: THEME }, activeGroupIndex: 0 });
  await page.evaluate((t) => localStorage.setItem('tabmerger-theme', t), THEME);
  await page.reload({ waitUntil: 'networkidle' });

  const [sw] = context.serviceWorkers();
  await openWindow(context, sw, RESEARCH);
  await openWindow(context, sw, TRIP);
  // The test browser's own starting tab (about:blank) is not part of the story.
  for (const p of context.pages()) if (p !== page && p.url() === 'about:blank') await p.close();
  await page.waitForTimeout(800);
  await page.bringToFront();
  await expect(page.getByRole('listitem', { name: 'Google Scholar' })).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));

  // 1. Now Open: every open tab, by window.
  await shot(page, 'now-open', [
    { id: 'now-open-row', label: 'The Now Open row', locator: page.getByRole('button', { name: 'Now Open', exact: true }), fit: 'content' },
    { id: 'now-open-summary', label: '2 Windows ◆ 10 Tabs', locator: groupSummary(page) },
  ]);

  // 1b. Save every open tab into a group: new group → ⋯ → Merge with current.
  await page.getByRole('button', { name: /^Add Group$/ }).click();
  await page.waitForTimeout(500);
  const rename = page.locator('input:focus');
  if (await rename.count()) {
    await rename.fill(GROUP_NAME);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'More group options' }).first().click();
  await page.getByRole('menuitem', { name: /Merge with current/ }).hover();
  await page.waitForTimeout(400);
  // The open menu hides everything else from the accessibility tree (aria-hidden), hence includeHidden.
  await shot(page, 'merge-menu', [
    { id: 'new-group-row', label: 'The new group', locator: page.getByRole('button', { name: GROUP_NAME, exact: true, includeHidden: true }), fit: 'content' },
    { id: 'group-menu-button', label: 'The ⋯ menu', locator: page.getByRole('button', { name: 'More group options', includeHidden: true }) },
    { id: 'merge-with-current', label: 'Merge with current', locator: page.getByRole('menuitem', { name: /Merge with current/ }) },
  ]);
  await page.getByRole('menuitem', { name: /Merge with current/ }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  await shot(page, 'merged-group', [{ id: 'merged-summary', label: 'Both windows saved in the group', locator: groupSummary(page) }]);

  // 2. Save session dialog, then the saved session's read-only view (a session = your saved groups).
  await page.getByRole('button', { name: 'Save current session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Session name').fill('Before the trip');
  await shot(page, 'save-session-dialog', [{ id: 'session-name', label: 'Session name', locator: dialog.getByLabel('Session name') }]);
  // A fixed colour (the default is Random) so the session view looks the same on every run.
  await dialog.getByRole('radio', { name: THEME === 'dark' ? 'Cyan' : 'Purple' }).check({ force: true });
  await dialog.getByRole('button', { name: /^save$/i }).click();
  await expect(dialog).toHaveCount(0);
  await dismissToasts(page);
  const sessionsToggle = page.getByRole('button', { name: /^sessions \(/i });
  if ((await sessionsToggle.getAttribute('aria-expanded')) !== 'true') await sessionsToggle.click();
  await page.getByText('Before the trip').first().click();
  await page.waitForTimeout(600);
  await shot(page, 'session-view', [{ id: 'restore-session', label: 'Restore session', locator: page.getByRole('button', { name: 'Restore session', exact: true }) }]);

  // 3. Recently closed: close three trip tabs, open today's view.
  for (const url of TRIP.slice(1, 4)) {
    await sw.evaluate(async (u: string) => {
      const t = (await chrome.tabs.query({})).find((x) => x.url === u);
      if (t?.id) await chrome.tabs.remove(t.id);
    }, url);
    await sw.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  }
  const rc = page.getByRole('button', { name: /^recently closed \(/i });
  await expect(rc).toBeVisible();
  if ((await rc.getAttribute('aria-expanded')) !== 'true') await rc.click();
  await page.getByRole('button', { name: 'Show tabs closed today' }).click({ timeout: 15_000 });
  await expect(page.getByTestId('closed-day-view')).toBeVisible();
  await page.waitForTimeout(600);
  const strip = page.getByRole('toolbar', { name: 'Tabs closed per hour' });
  await shot(page, 'recently-closed', [
    { id: 'today-row', label: 'Today, 3 tabs', locator: page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Show tabs closed today' }) }), fit: 'content' },
    // The bars plus the hour labels under them (an aria-hidden row right after the toolbar).
    { id: 'hour-strip', label: 'Tabs closed per hour', locator: [strip, strip.locator('xpath=following-sibling::div[1]')] },
  ]);

  // 4. Search across open, saved and closed tabs, then closed: only.
  await page.getByRole('button', { name: 'Open search' }).click();
  const input = page.getByPlaceholder(/^Search tabs, groups/);
  await input.fill('lisbon');
  await page.waitForTimeout(700);
  await shot(page, 'search', [
    // One box per tag: a single box around the column would cut through the shorter tags' titles.
    { id: 'group-tag', label: 'Group tag', locator: page.getByRole('listbox', { name: 'Results' }).getByRole('option').getByText(new RegExp(`^(Now Open|${GROUP_NAME})$`)), each: true },
  ]);
  await input.fill('closed: seat');
  await page.waitForTimeout(700);
  // The whole input row (search icon, query, clear button, shortcut) around the combobox.
  await shot(page, 'search-closed', [{ id: 'search-input', label: 'closed: seat', locator: page.getByRole('combobox', { name: 'Search tabs and groups' }).locator('xpath=..') }]);
  await page.keyboard.press('Escape');

  // 5. Settings → Data.
  await page.getByRole('button', { name: /settings menu|account menu/i }).first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('tab', { name: 'Data' }).click();
  await page.waitForTimeout(600);
  await shot(page, 'settings-data', [
    { id: 'auto-save-toggle', label: 'Auto-save open tabs', locator: settings.getByRole('switch', { name: /^auto-save open tabs$/i }) },
    { id: 'remember-closed-toggle', label: 'Remember closed tabs', locator: settings.getByRole('switch', { name: /^remember closed tabs$/i }) },
  ]);
});
