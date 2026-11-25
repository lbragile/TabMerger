// Shared helpers for the blog's TabMerger capture specs (tier1Shots.spec.ts, tier2Shots.spec.ts):
// the extension context, stub pages, real windows and Chrome tab groups, and `shot()` with
// measured boxes. Theme from BLOG_THEME, output folder from BLOG_OUT.
import fs from 'fs';
import { test as base, expect } from '../../../packages/extension/e2e/fixtures';
import { PRODUCTION_EXTENSION_PATH } from '../../../packages/extension/e2e/extensionPath';
import { dismissTour, openPopup, seedIdb, seedSettings } from '../../../packages/extension/e2e/helpers';
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
// @ts-expect-error -- plain ESM helper shared with native.mjs (no type declarations)
import { recordBoxes } from '../boxes.mjs';

export const OUT = process.env.BLOG_OUT!;
export const THEME = (process.env.BLOG_THEME ?? 'light') as 'light' | 'dark';

export const test = base.extend({
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
export const TITLES: Record<string, string> = {
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API': 'Fetch API - Web APIs | MDN',
  'https://github.com/lbragile/TabMerger/issues': 'Issues · lbragile/TabMerger',
  'https://stackoverflow.com/questions/tagged/javascript': "Newest 'javascript' Questions - Stack Overflow",
  'https://nodejs.org/en/docs': 'Documentation | Node.js',
  'https://www.typescriptlang.org/docs/': 'TypeScript: Documentation',
  'https://react.dev/reference/react': 'React Reference Overview – React',
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
  'https://news.ycombinator.com/': 'Hacker News',
  'https://www.theverge.com/': 'The Verge',
};
export const DEV = Object.keys(TITLES).slice(0, 6);
export const RESEARCH = Object.keys(TITLES).slice(6, 11);
export const TRIP = Object.keys(TITLES).slice(11, 16);
export const NEWS = Object.keys(TITLES).slice(16);

export async function routeStubs(context: BrowserContext) {
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

/** A real window with real tabs (see blogShots.spec.ts). Returns the window id. */
export async function openWindow(context: BrowserContext, sw: Worker, urls: string[]): Promise<number> {
  const before = new Set(context.pages());
  const id = await sw.evaluate(async (n: number) => (await chrome.windows.create({ url: Array.from({ length: n }, () => 'about:blank'), focused: false }))!.id!, urls.length);
  await expect.poll(() => context.pages().filter((p) => !before.has(p)).length, { timeout: 15_000 }).toBe(urls.length);
  const fresh = context.pages().filter((p) => !before.has(p));
  for (let i = 0; i < fresh.length; i++) await fresh[i].goto(urls[i]);
  await expect
    .poll(async () => sw.evaluate(async (wid: number) => (await chrome.tabs.query({ windowId: wid })).filter((t) => t.status === 'complete' && t.favIconUrl).length, id), { timeout: 20_000 })
    .toBe(urls.length);
  await sw.evaluate(() => new Promise((r) => setTimeout(r, 800)));
  return id;
}

/** Groups some of a window's tabs into a real Chrome tab group with a title and colour. */
export async function chromeGroup(sw: Worker, windowId: number, urls: string[], title: string, color: chrome.tabGroups.Color) {
  await sw.evaluate(
    async ({ windowId, urls, title, color }) => {
      const tabs = (await chrome.tabs.query({ windowId })).filter((t) => urls.includes(t.url ?? ''));
      const groupId = await chrome.tabs.group({ tabIds: tabs.map((t) => t.id!), createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title, color });
    },
    { windowId, urls, title, color }
  );
  await sw.evaluate(() => new Promise((r) => setTimeout(r, 600)));
}

export type Target = { id: string; label: string; locator: Locator | Locator[]; all?: boolean; each?: boolean; fit?: 'content' };

export async function shot(page: Page, slug: string, name: string, targets: Target[] = []) {
  const dir = `${OUT}/${slug}`;
  fs.mkdirSync(dir, { recursive: true });
  await page.mouse.move(120, 20);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(500);
  const png = `${dir}/tm-${name}-${THEME}.png`;
  await page.screenshot({ path: png, animations: 'disabled', caret: 'hide' });
  await recordBoxes(page, png, targets);
}

export const groupSummary = (page: Page) => page.getByText(/^\d+ Windows? ◆ \d+ Tabs?$/);

export const dismissToasts = async (page: Page) => {
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
};

export const fav = (d: string) => `https://www.google.com/s2/favicons?sz=64&domain=${d}`;

/** Opens the popup, seeds two saved groups (Work, Reading list) and the theme, and reloads. */
export async function popupWithGroups(context: BrowserContext, extensionId: string, extra: Parameters<typeof seedIdb>[1] = []) {
  await routeStubs(context);
  const page = await openPopup(context, extensionId);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.emulateMedia({ colorScheme: THEME, reducedMotion: 'reduce' });
  await expect(page.locator('[data-sidebar-group-index="0"]')).toBeVisible();
  const now = await page.evaluate(() => Date.now());
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
    ...extra.map((g) => ({ ...g, updatedAt: now })),
  ]);
  await seedSettings(page, { appSettings: { theme: THEME }, activeGroupIndex: 0 });
  await page.evaluate((t) => localStorage.setItem('tabmerger-theme', t), THEME);
  await page.reload({ waitUntil: 'networkidle' });
  const [sw] = context.serviceWorkers();
  return { page, sw };
}

/** Closes the test browser's own blank starting tab and brings the popup back to the front. */
export async function settle(context: BrowserContext, page: Page, visibleTitle: string) {
  for (const p of context.pages()) if (p !== page && p.url() === 'about:blank') await p.close();
  await page.waitForTimeout(800);
  await page.bringToFront();
  await expect(page.getByRole('listitem', { name: visibleTitle }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
}

export async function openSettingsData(page: Page) {
  await page.getByRole('button', { name: /settings menu|account menu/i }).first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('tab', { name: 'Data' }).click();
  await page.waitForTimeout(600);
  return settings;
}

/** Picks a value in a Radix select (trigger by its label). */
export async function pick(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.waitForTimeout(500);
}

