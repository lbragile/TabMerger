// Real browser pages as index-card covers for browser-topic posts, headless, like native.mjs:
// 800×600 at 2x (1600×1200, the 4:3 cover shape), light and dark, no annotation boxes (covers
// never show any). Pages are stubbed with a <title> and the site's real favicon; bookmarks are
// made through the page's own chrome.bookmarks API. One sub-folder per post slug under <out>,
// files named cover-<browser>-<theme>.png, then convert.mjs <out>/<slug> public/blog/<slug>.
//
//   node scripts/blog-screenshots/coverNative.mjs <out> [chrome] [edge]
//
// Dark: Chrome runs with --force-dark-mode plus a dark prefers-color-scheme; Edge gets its own
// Settings → Appearance theme (Light or Dark), so both are the browsers' real dark themes.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'packages', 'extension', 'package.json'));
const { chromium } = require('@playwright/test');

const OUT = path.resolve(process.argv[2]);
fs.mkdirSync(OUT, { recursive: true });

const TITLES = {
  'https://en.wikipedia.org/wiki/Spaced_repetition': 'Spaced repetition - Wikipedia',
  'https://arxiv.org/abs/1706.03762': '[1706.03762] Attention Is All You Need',
  'https://www.nature.com/': 'Nature',
  'https://news.ycombinator.com/': 'Hacker News',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API': 'Fetch API - Web APIs | MDN',
  'https://www.typescriptlang.org/docs/': 'TypeScript: Documentation',
  'https://react.dev/reference/react': 'React Reference Overview – React',
  'https://en.wikivoyage.org/wiki/Lisbon': 'Lisbon – Travel guide at Wikivoyage',
  'https://www.seat61.com/': 'The Man in Seat 61 | The train travel guide',
  'https://en.wikivoyage.org/wiki/Sintra': 'Sintra – Travel guide at Wikivoyage',
  'https://www.timeanddate.com/weather/portugal/lisbon': 'Weather for Lisbon, Portugal',
  'https://scholar.google.com/': 'Google Scholar',
  'https://www.zotero.org/': 'Zotero | Your personal research assistant',
  'https://www.bbcgoodfood.com/recipes/collection/easy-dinner-recipes': 'Easy dinner recipes | BBC Good Food',
  'https://www.seriouseats.com/the-food-lab-5118015': 'The Food Lab | Serious Eats',
};
const urls = (...keys) => keys.map((k) => Object.keys(TITLES).find((u) => u.includes(k)));

/** Bookmark folders per capture: [folder, urls]. The first folder is the one shown open. */
const CHROME_FOLDERS = [
  ['Reference', urls('Fetch_API', 'typescriptlang', 'react.dev', 'Spaced_repetition', 'arxiv')],
  ['Recipes', urls('bbcgoodfood', 'seriouseats')],
  ['Trip to Lisbon', urls('wiki/Lisbon', 'seat61')],
];
const EDGE_FOLDERS = [
  ['Trip to Lisbon', urls('wiki/Lisbon', 'seat61', 'Sintra', 'timeanddate')],
  ['Thesis reading', urls('Spaced_repetition', 'arxiv', 'scholar', 'zotero')],
  ['Recipes', urls('bbcgoodfood', 'seriouseats')],
];

async function launch(channel, label, theme, viewport = { width: 800, height: 600 }, deviceScaleFactor = 2) {
  const userDataDir = fs.mkdtempSync(path.join(OUT, `.profile-${label}-${theme}-`));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless: false,
    args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', ...(theme === 'dark' && channel === 'chrome' ? ['--force-dark-mode'] : [])],
    viewport,
    deviceScaleFactor,
    colorScheme: theme,
  });
  await ctx.route(/^https:\/\/(?!www\.google\.com\/s2\/favicons)/, (route) => {
    if (route.request().resourceType() !== 'document') return route.abort();
    const url = route.request().url();
    const title = TITLES[url] ?? 'Page';
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset=utf-8><title>${title}</title><link rel=icon href="https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}"><h1>${title}</h1>`,
    });
  });
  return ctx;
}

async function shoot(page, slug, file) {
  const dir = path.join(OUT, slug);
  fs.mkdirSync(dir, { recursive: true });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(dir, file) });
}

/** Visits each page (so favicons are cached), then files them in folders; returns the first folder's id. */
async function makeFolders(page, bmUrl, folders, parentIndex) {
  for (const [, list] of folders) for (const u of list) { await page.goto(u).catch(() => {}); await page.waitForTimeout(700); }
  await page.goto(bmUrl);
  await page.waitForTimeout(1500);
  return page.evaluate(async ({ folders, titles, parentIndex }) => {
    const parent = (await chrome.bookmarks.getTree())[0].children[parentIndex];
    let first;
    for (const [name, list] of folders) {
      const folder = await chrome.bookmarks.create({ parentId: parent.id, title: name });
      first ??= folder.id;
      for (const url of list) await chrome.bookmarks.create({ parentId: folder.id, title: titles[url], url });
    }
    return first;
  }, { folders, titles: TITLES, parentIndex });
}

async function chrome(theme) {
  const ctx = await launch('chrome', 'chrome', theme);
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // too-many-tabs-slow-browser: Settings → Performance, Memory Saver in view.
    await page.goto('chrome://settings/performance');
    await page.waitForTimeout(2500);
    // Turn Memory Saver on (its options appear under it), then put the Memory section at the top.
    await page.getByRole('button', { name: 'Memory Saver' }).or(page.getByRole('switch', { name: /Memory Saver/ })).first().click();
    await page.waitForTimeout(1000);
    await page.getByText('Memory', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(800);
    await shoot(page, 'too-many-tabs-slow-browser', `cover-chrome-${theme}.png`);
    // tabs-vs-bookmarks: the Bookmark manager with a folder of pages (in the bookmarks bar).
    const id = await makeFolders(page, 'chrome://bookmarks/', CHROME_FOLDERS, 0);
    await page.goto(`chrome://bookmarks/?id=${id}`);
    await page.waitForTimeout(2500);
    await shoot(page, 'tabs-vs-bookmarks', `cover-chrome-${theme}.png`);
    fs.writeFileSync(path.join(OUT, 'chrome-version.txt'), String(ctx.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent))));
  } finally {
    await ctx.close();
  }
}

async function edge(theme) {
  // 1280×960 CSS px at 1.25x (still 1600×1200): wide enough for Edge to show the folder tree, which
  // it folds into a menu at 800px.
  const ctx = await launch('msedge', 'edge', theme, { width: 1280, height: 960 }, 1.25);
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('edge://settings/appearance');
    await page.waitForTimeout(1500);
    await page.getByText(theme === 'dark' ? 'Dark' : 'Light', { exact: true }).first().click();
    await page.waitForTimeout(800);
    // edge-collections-replacement: former collections as folders in Other favorites.
    const id = await makeFolders(page, 'edge://favorites/', EDGE_FOLDERS, 1);
    await page.goto(`edge://favorites/?id=${id}`);
    await page.waitForTimeout(2500);
    await shoot(page, 'edge-collections-replacement', `cover-edge-${theme}.png`);
    // restore-tabs-after-crash: History → Recently closed, after really closing some tabs. (Chrome
    // lists recently closed tabs only in its History menu, which headless can't show.)
    for (const u of urls('Fetch_API', 'typescriptlang', 'react.dev', 'news.ycombinator')) {
      const tab = await ctx.newPage();
      await tab.goto(u).catch(() => {});
      await tab.waitForTimeout(900);
      await tab.close({ runBeforeUnload: false });
      await page.waitForTimeout(400);
    }
    await page.goto('edge://history/all');
    await page.waitForTimeout(2000);
    await page.getByRole('treeitem', { name: 'Recently closed' }).click();
    await page.waitForTimeout(2000);
    await shoot(page, 'restore-tabs-after-crash', `cover-edge-${theme}.png`);
    fs.writeFileSync(path.join(OUT, 'edge-version.txt'), String(ctx.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent))));
  } finally {
    await ctx.close();
  }
}

const which = process.argv.slice(3);
let failed = false;
for (const [name, run] of [['chrome', chrome], ['edge', edge]]) {
  if (which.length && !which.includes(name)) continue;
  for (const theme of ['light', 'dark']) {
    try {
      await run(theme);
      console.log(name, theme, 'done');
    } catch (e) {
      console.error(name, theme, 'FAILED', e.message);
      failed = true;
    }
  }
}
if (failed) process.exitCode = 1;
