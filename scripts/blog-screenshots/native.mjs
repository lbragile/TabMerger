// Captures real native browser pages (Chrome, Edge) headless for the blog post.
// Pages the article mentions are stubbed with a <title> so history/bookmarks look like a real
// research session; favicon requests go to the real sites.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The repo root, from this file's place in it (scripts/blog-screenshots/).
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Playwright comes from the extension package (the repo root has no node_modules of its own).
const require = createRequire(path.join(REPO, 'packages', 'extension', 'package.json'));
const { chromium } = require('@playwright/test');
import { recordBoxes } from './boxes.mjs';

const OUT = path.resolve(process.argv[2]);
fs.mkdirSync(OUT, { recursive: true });

const FOLDER = 'Tab manager research';

export const PAGES = [
  ['https://developer.chrome.com/docs/extensions/reference/api/tabs', 'chrome.tabs API | Chrome for Developers'],
  ['https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sessions', 'sessions - Mozilla | MDN'],
  ['https://support.google.com/chrome/answer/2391819', 'Use tab groups - Computer - Google Chrome Help'],
  ['https://support.mozilla.org/en-US/kb/restore-previous-session', 'Restore previous session | Firefox Help'],
  ['https://en.wikipedia.org/wiki/Tab_(interface)', 'Tab (interface) - Wikipedia'],
  ['https://github.com/lbragile/TabMerger', 'GitHub - lbragile/TabMerger: Save, organize and sync your browser tabs'],
];

// BLOG_ARIA_DUMP=1 writes each page's accessibility tree next to its PNG: the quickest way to find
// a role + name for a new annotation target, or to fix one a browser update renamed.
// A target that can't be measured is reported (and fails the run at the end) without stopping the
// other captures.
const failures = [];
async function shoot(page, file, targets) {
  const png = path.join(OUT, file);
  if (process.env.BLOG_ARIA_DUMP) fs.writeFileSync(png.replace(/\.png$/, '.aria.yml'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: png });
  await recordBoxes(page, png, targets).catch((e) => failures.push(e.message));
}

async function run(channel, label) {
  const userDataDir = fs.mkdtempSync(path.join(OUT, `.profile-${label}-`));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless: false,
    args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
    viewport: { width: 1100, height: 600 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  await ctx.route(/^https:\/\/(?!.*favicon)/, (route) => {
    if (route.request().resourceType() !== 'document') return route.abort();
    const hit = PAGES.find(([u]) => route.request().url().startsWith(u));
    const title = hit ? hit[1] : 'Page';
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>${title}</title><link rel=icon href="https://www.google.com/s2/favicons?sz=64&domain=${new URL(route.request().url()).hostname}"><h1>${title}</h1>` });
  });
  try {
    await capture(ctx, label);
  } finally {
    await ctx.close();
  }
}

async function capture(ctx, label) {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  for (const [url] of PAGES) { await page.goto(url).catch(() => {}); await page.waitForTimeout(1200); }
  if (label === 'edge') { await page.goto('edge://settings/appearance'); await page.waitForTimeout(1500); await page.getByText('Light', { exact: true }).first().click().catch((e) => console.log('edge light', e.message)); await page.waitForTimeout(800); }

  const scheme = label === 'edge' ? 'edge' : 'chrome';

  // 1. Bookmarks manager: a folder that "Bookmark all tabs" made. Created through the page's own
  //    chrome.bookmarks API, exactly what the dialog does.
  const bmPath = label === 'edge' ? 'edge://favorites/' : 'chrome://bookmarks/';
  await page.goto(bmPath);
  await page.waitForTimeout(1500);
  const folderId = await page.evaluate(async ({ pages, folder: title }) => {
    const bar = (await chrome.bookmarks.getTree())[0].children[0];
    const folder = await chrome.bookmarks.create({ parentId: bar.id, title });
    for (const [url, title] of pages) await chrome.bookmarks.create({ parentId: folder.id, title, url });
    return folder.id;
  }, { pages: PAGES, folder: FOLDER });
  await page.goto(`${bmPath}?id=${folderId}`);
  await page.waitForTimeout(2500);
  // Chrome's selected folder row runs to the window's left edge, so its box hugs the icon and name
  // (fit: 'content'); Edge draws the selected row as an inset pill, boxed whole.
  // Edge's favorites tree is made of <fluent-tree-item> web components whose roles live in
  // ElementInternals, which getByRole can't see: take the innermost tree item holding the name.
  const folderRow = label === 'edge'
    ? page.locator('fluent-tree-item').filter({ has: page.getByText(FOLDER, { exact: true }) }).filter({ hasNot: page.locator('fluent-tree-item') })
    : page.getByRole('treeitem', { name: FOLDER });
  await shoot(page, `${label}-bookmarks-folder.png`, [
    { id: 'folder', label: label === 'edge' ? 'The Tab manager research favorites folder' : 'The Tab manager research bookmark folder', locator: folderRow, fit: label === 'edge' ? undefined : 'content' },
  ]);

  // 2. Startup setting: pick "Continue where you left off" / "Open tabs from the previous session".
  const startup = label === 'edge' ? 'edge://settings/startHomeNTP' : 'chrome://settings/onStartup';
  await page.goto(startup);
  await page.waitForTimeout(2000);
  const radioText = label === 'edge' ? 'Open tabs from the previous session' : 'Continue where you left off';
  await page.getByText(radioText, { exact: true }).first().click().catch((e) => console.log(label, 'radio', e.message));
  await page.waitForTimeout(800);
  await shoot(page, `${label}-startup-setting.png`, [
    // Chrome: the radio's own box is only its disc, so the box spans the disc and its label.
    // Edge: its settings radios are web components with ElementInternals roles (invisible to
    // getByRole); box the option's row (the grey bar the click leaves on it).
    {
      id: 'startup-option',
      label: radioText,
      locator: label === 'edge'
        ? page.locator('settings-radio-row').filter({ has: page.getByText(radioText, { exact: true }) }).locator('div.box')
        : [page.getByRole('radio', { name: radioText }), page.getByText(radioText, { exact: true })],
    },
  ]);

  // 3. History page.
  await page.goto(`${scheme}://history/`);
  await page.waitForTimeout(2000);
  await shoot(page, `${label}-history.png`, [
    label === 'edge'
      ? { id: 'recently-closed', label: 'Recently closed', locator: page.getByRole('treeitem', { name: 'Recently closed' }), fit: 'content' }
      : { id: 'by-group', label: 'The By group tab', locator: page.getByRole('tab', { name: 'By group' }), fit: 'content' },
  ]);

  const version = ctx.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent));
  fs.writeFileSync(path.join(OUT, `${label}-version.txt`), String(version));
  console.log(label, 'done', version);
}

const which = process.argv.slice(3);
for (const [channel, label] of [['chrome', 'chrome'], ['msedge', 'edge']]) {
  if (which.length && !which.includes(label)) continue;
  try { await run(channel, label); } catch (e) { console.error(label, 'FAILED', e.message); failures.push(`${label}: ${e.message}`); }
}
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.join('\n')}`);
  process.exitCode = 1;
}

