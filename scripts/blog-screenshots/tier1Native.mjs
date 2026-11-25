// Native browser captures for the Tier-1 blog posts, headless, like native.mjs: Chrome's and
// Edge's own settings pages (light theme, 2x), each with its measured annotation boxes. One
// sub-folder per post slug under <out>.
//
//   node scripts/blog-screenshots/tier1Native.mjs <out> [extension-dir]
//
// extension-dir: a built TabMerger (chrome-mv3) to load into Edge for its keyboard-shortcuts
// page. Branded Chrome ignores --load-extension, so that page is captured in Edge only.
// BLOG_ARIA_DUMP=1 writes each page's accessibility tree next to its PNG.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'packages', 'extension', 'package.json'));
const { chromium } = require('@playwright/test');
import { recordBoxes } from './boxes.mjs';

const OUT = path.resolve(process.argv[2]);
const EXT = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
async function shoot(page, slug, file, targets) {
  const dir = path.join(OUT, slug);
  fs.mkdirSync(dir, { recursive: true });
  const png = path.join(dir, file);
  if (process.env.BLOG_ARIA_DUMP) fs.writeFileSync(png.replace(/\.png$/, '.aria.yml'), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: png });
  await recordBoxes(page, png, targets).catch((e) => failures.push(`${file}: ${e.message}`));
}

async function launch(channel, label, extraArgs = []) {
  const userDataDir = fs.mkdtempSync(path.join(OUT, `.profile-${label}-`));
  return chromium.launchPersistentContext(userDataDir, {
    channel,
    headless: false,
    args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', ...extraArgs],
    viewport: { width: 1100, height: 600 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
}

/** The visible label's row: the text plus the control on its line (Chrome settings toggles). */
const row = (page, text) => page.getByText(text, { exact: true }).first();

async function chrome() {
  const ctx = await launch('chrome', 'chrome');
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // Memory Saver (Settings → Performance).
    await page.goto('chrome://settings/performance');
    await page.waitForTimeout(2500);
    // Scroll the page so the Memory section sits under General.
    await page.mouse.move(1000, 400);
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(800);
    await shoot(page, 'manage-too-many-tabs', 'chrome-memory-saver.png', [
      { id: 'memory-saver', label: 'Memory Saver', locator: [row(page, 'Memory Saver'), page.getByRole('button', { name: 'Memory Saver' }).or(page.getByRole('switch', { name: /Memory Saver/ })).first()] },
    ]);
    // Tab groups in the bookmarks bar (Settings → Appearance).
    await page.goto('chrome://settings/appearance');
    await page.waitForTimeout(2500);
    const tg = row(page, 'Show tab groups in bookmarks bar');
    await tg.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(600);
    await shoot(page, 'chrome-tab-groups', 'chrome-tab-groups-setting.png', [
      { id: 'tab-groups-setting', label: 'Show tab groups in bookmarks bar', locator: tg, fit: 'content' },
      { id: 'auto-pin', label: 'Automatically pin new tab groups', locator: row(page, 'Automatically pin new tab groups created on any device to the bookmarks bar'), fit: 'content' },
    ]);
    fs.writeFileSync(path.join(OUT, 'chrome-version.txt'), String(ctx.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent))));
  } finally {
    await ctx.close();
  }
}

async function edge() {
  const extArgs = EXT ? [`--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`] : [];
  const ctx = await launch('msedge', 'edge', extArgs);
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('edge://settings/appearance');
    await page.waitForTimeout(1500);
    await page.getByText('Light', { exact: true }).first().click().catch((e) => console.log('edge light', e.message));
    await page.waitForTimeout(800);
    // Sleeping tabs (Settings → System and performance).
    await page.goto('edge://settings/system');
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Performance', exact: true }).click();
    await page.waitForTimeout(2500);
    const sleeping = page.getByText('Automatically put tabs to sleep', { exact: true }).first();
    await sleeping.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(600);
    await shoot(page, 'manage-too-many-tabs', 'edge-sleeping-tabs.png', [
      { id: 'sleeping-tabs', label: 'Automatically put tabs to sleep', locator: sleeping, fit: 'content' },
    ]);
    if (EXT) {
      // Taller, so all five TabMerger commands fit.
      await page.setViewportSize({ width: 1100, height: 1000 });
      await page.goto('edge://extensions/shortcuts');
      await page.waitForTimeout(2500);
      await shoot(page, 'tab-keyboard-shortcuts', 'edge-extension-shortcuts.png', [
        { id: 'save-current-tab', label: 'Save the current tab: Ctrl+Shift+S', locator: page.getByText('Save the current tab to TabMerger', { exact: true }), fit: 'content' },
      ]);
      await page.setViewportSize({ width: 1100, height: 600 });
    }
    fs.writeFileSync(path.join(OUT, 'edge-version.txt'), String(ctx.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent))));
  } finally {
    await ctx.close();
  }
}

for (const [name, run] of [['chrome', chrome], ['edge', edge]]) {
  try {
    await run();
    console.log(name, 'done');
  } catch (e) {
    console.error(name, 'FAILED', e.message);
    failures.push(`${name}: ${e.message}`);
  }
}
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.join('\n')}`);
  process.exitCode = 1;
}
