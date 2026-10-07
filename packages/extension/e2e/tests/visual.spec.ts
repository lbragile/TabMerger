import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { PRODUCTION_EXTENSION_PATH } from '../extensionPath';
import { openPopup, seedIdb, seedSettings, signInAsPro, type E2eEncryption } from '../helpers';
import { FROZEN_NOW, INCOGNITO, LONG_CONTENT, NOW_OPEN_LIVE, OVER_FREE_LIMIT, POPULATED, URL_RULES, WORK_INDEX } from '../visualSeed';

/**
 * Visual regression for the popup: the layout risks behaviour tests cannot see (overflow in the
 * fixed 800x600 popup, the sidebar/header seam, colour tints, both themes). Playwright's
 * `toHaveScreenshot()`; baselines live in `visual.spec.ts-snapshots/` as
 * `popup-<state>-<theme>-<platform>.png`.
 *
 * Run and update: see "Visual regression" in `e2e/TEST_CASES.md`.
 *
 * Every shot is taken under the same fixed conditions (see `openSeededPopup` and `shoot`):
 *  - the production-mode build, never the dev build (they render differently);
 *  - an 800x600 viewport, the real popup size;
 *  - the page clock frozen at `FROZEN_NOW` before the popup loads, seed timestamps relative to it;
 *  - no network: http(s) is aborted in the page and nothing but loopback resolves in the browser.
 *    Favicons are inline or the built-in fallback, and Supabase is stubbed by `signInAsPro`;
 *  - the theme stored the way the app stores it, and asserted before the shot;
 *  - "Now Open" mirrors the test browser, which is always one window with one `about:blank` tab;
 *  - pointer parked where nothing reacts to it, fonts and images loaded, no toast on screen.
 */

/** The real popup size. */
const POPUP_SIZE = { width: 800, height: 600 };

/** A point on the header logo: no hover style, no tooltip, never covered by a control. */
const NEUTRAL_POINT = { x: 120, y: 20 };

/**
 * The ONE comparison setting for every shot.
 *
 * `maxDiffPixelRatio: 0.001` is 480 of the popup's 480,000 pixels. Against a baseline from the
 * same platform a shot is normally identical, so this only absorbs a few glyphs of antialiasing
 * noise. It is well under the smallest layout change worth catching: a full-height line (the
 * sidebar edge) moving by one pixel changes about 1,200 pixels before counting the content that
 * moves with it. Do not raise it for a single test: an unstable shot is a bug in the test.
 */
const SCREENSHOT = {
  animations: 'disabled',
  caret: 'hide',
  scale: 'css',
  maxDiffPixelRatio: 0.001,
} as const;

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

type SeedGroups = Parameters<typeof seedIdb>[1];

interface PopupSeed {
  groups: SeedGroups;
  /** Index (in `groups`) of the group whose windows the main panel shows. Default 0, Now Open. */
  activeGroupIndex?: number;
  /** Extra `settings` store records, by id. */
  settings?: Record<string, unknown>;
  /** Sign in as a Pro account whose encryption key is in this state. Default: signed out (free). */
  account?: E2eEncryption;
}

/** Opens the popup at 800x600 with a frozen clock, no network, the theme and the seed applied. */
async function openSeededPopup(context: BrowserContext, extensionId: string, theme: Theme, seed: PopupSeed): Promise<Page> {
  // Before any page exists, so the popup never sees the real time or reaches a real host.
  await context.clock.setFixedTime(FROZEN_NOW);
  await context.route(/^https?:\/\//, (route) => route.abort());

  const page = await openPopup(context, extensionId);
  await page.setViewportSize(POPUP_SIZE);
  // `system` is never stored below, but anything keyed off the OS preference agrees with the theme.
  // Reduced motion: the group colour swatch grows on hover (`hover:scale-125`, off under
  // `motion-reduce`), and the colour picker is positioned against it. With motion on, the picker
  // landed one pixel apart depending on how far that hover transition had run at the click.
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  expect(await page.evaluate(() => Date.now()), 'the page clock is frozen').toBe(FROZEN_NOW);
  // The first load has finished creating its own empty state once the sidebar shows.
  await expect(page.locator('[data-sidebar-group-index="0"]')).toBeVisible();

  await seedIdb(page, seed.groups);
  // The theme lives in the `appSettings` record; `tabmerger-theme` in localStorage is the copy
  // the popup reads synchronously before React mounts (src/lib/theme.ts, public/theme-init.js).
  await seedSettings(page, { appSettings: { theme }, activeGroupIndex: seed.activeGroupIndex ?? 0, ...seed.settings });
  await page.evaluate((t) => localStorage.setItem('tabmerger-theme', t), theme);
  if (seed.account) await signInAsPro(page, seed.account);

  await page.reload({ waitUntil: 'networkidle' });

  // Now Open has been rebuilt from the test browser: one window, one tab.
  await expect(page.locator('[data-sidebar-group-index="0"]')).toContainText(/1\s*◆\s*1/);
  // By attribute, not by role: a dialog that opens on load hides the rest of the page from the accessibility tree.
  await expect(page.locator('[data-sidebar-group-index]')).toHaveCount(seed.groups.length);
  return page;
}

/** Asserts the theme took effect: the class on <html> and the copy the app itself writes back. */
async function expectTheme(page: Page, theme: Theme): Promise<void> {
  const html = page.locator('html');
  if (theme === 'dark') await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  // `applyTheme` writes the value it applied, so this is the app's stored setting, not the seed.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tabmerger-theme'))).toBe(theme);
}

/** Takes the screenshot for `state`, after putting the page in a state that cannot differ between runs. */
async function shoot(page: Page, state: string, theme: Theme): Promise<void> {
  await page.mouse.move(NEUTRAL_POINT.x, NEUTRAL_POINT.y);
  await expectTheme(page, theme);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Every image decoded. A favicon that fails to load swaps to the inline fallback, which then loads.
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0));
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page).toHaveScreenshot(`popup-${state}-${theme}.png`, SCREENSHOT);
}

/** Opens Settings from the header menu (signed out: "Settings menu"). */
async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Settings' })).toBeVisible();
}

test.use({ extensionPath: PRODUCTION_EXTENSION_PATH, blockNetwork: true });

for (const theme of THEMES) {
  test.describe(`Visual @visual: popup states, ${theme} theme`, () => {
    test('empty: no saved groups', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: [NOW_OPEN_LIVE] });

      await expect(page.getByRole('listitem', { name: 'about:blank' })).toBeVisible();
      await shoot(page, 'empty', theme);
    });

    test('populated: coloured groups, a starred group with a note, windows and tabs', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: POPULATED, activeGroupIndex: WORK_INDEX });

      await expect(page.getByRole('listitem', { name: 'Sprint board' })).toBeVisible();
      // One tab was saved 45 days before the frozen instant: the stale marker depends on the clock.
      await expect(page.getByRole('button', { name: 'Remove 1 stale tab' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit group note' })).toBeVisible();
      await shoot(page, 'populated', theme);
    });

    test('incognito: a starred and a plain incognito window in a coloured group', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: INCOGNITO, activeGroupIndex: 1 });

      await expect(page.getByText('Incognito', { exact: true })).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Unstar window' })).toHaveCount(1);
      await shoot(page, 'incognito', theme);
    });

    test('colour picker open on a sidebar group', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: POPULATED, activeGroupIndex: WORK_INDEX });

      await page.locator(`[data-sidebar-group-index="${WORK_INDEX}"]`).getByRole('button', { name: 'Change group color' }).click();
      await expect(page.locator('.react-colorful__saturation')).toBeInViewport({ ratio: 1 });
      await expect(page.getByPlaceholder('#rrggbb')).toBeInViewport({ ratio: 1 });
      await shoot(page, 'color-picker', theme);
    });

    test('Settings modal', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: POPULATED, activeGroupIndex: WORK_INDEX });

      await openSettings(page);
      // The version badge changes with every release: pin its text so a release is not a diff.
      const version = page.getByRole('dialog').getByText(/^v\d+\.\d+\.\d+/);
      await expect(version).toHaveCount(1);
      await version.evaluate((el) => {
        el.textContent = 'v0.0.0';
      });
      await shoot(page, 'settings-modal', theme);
    });

    test('URL rules modal: at the free limit, with a very long pattern', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, {
        groups: POPULATED,
        activeGroupIndex: WORK_INDEX,
        settings: { urlRules: URL_RULES },
      });

      await openSettings(page);
      await page.getByRole('dialog').getByRole('button', { name: 'Manage' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'URL Rules' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Edit rule' })).toHaveCount(URL_RULES.length);
      await expect(dialog.getByText('3/3 used')).toBeVisible();
      await shoot(page, 'url-rules-modal', theme);
    });

    test('search overlay with matching tabs', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: POPULATED, activeGroupIndex: WORK_INDEX });

      await page.getByRole('button', { name: 'Open search' }).click();
      const input = page.getByPlaceholder('Search tabs, groups…');
      await expect(input).toBeFocused();
      await input.fill('docs');
      await expect(page.getByText('Tabs', { exact: true })).toBeVisible();
      // The panel behind the overlay dims the tabs that do not match.
      await expect(page.getByRole('listitem', { name: 'Sprint board' })).toHaveClass(/opacity-30/);
      await expect(page.getByRole('listitem', { name: 'API docs: payments' })).not.toHaveClass(/opacity-30/);
      await shoot(page, 'search', theme);
    });

    test('encryption: first-time setup for a signed-in Pro account', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: POPULATED, activeGroupIndex: WORK_INDEX, account: 'none' });

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Set up encryption' })).toBeVisible();
      await expect(dialog.getByPlaceholder('Confirm passphrase')).toBeVisible();
      await shoot(page, 'encryption-setup', theme);
    });

    test('encryption: unlock on a device that does not hold the key', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: POPULATED, activeGroupIndex: WORK_INDEX, account: 'locked' });

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Unlock encryption' })).toBeVisible();
      await expect(dialog.getByPlaceholder('Passphrase', { exact: true })).toBeVisible();
      await expect(dialog.getByPlaceholder('Confirm passphrase')).toHaveCount(0);
      await shoot(page, 'encryption-unlock', theme);
    });

    test('free plan: upgrade banner and locked groups past the limit', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: OVER_FREE_LIMIT, activeGroupIndex: WORK_INDEX });

      await expect(page.getByText(/approaching the free limit/)).toBeVisible();
      await expect(page.getByLabel('Pro required')).toHaveCount(2);
      await shoot(page, 'free-limit', theme);
    });

    test('selection: two tabs selected, action bar visible', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: POPULATED, activeGroupIndex: WORK_INDEX });

      await page.getByRole('button', { name: 'Select items' }).click();
      const checkboxes = page.getByRole('listitem').getByRole('checkbox', { name: /^Select /i });
      await checkboxes.nth(0).click();
      await checkboxes.nth(1).click();
      await expect(page.getByText('2 tabs selected', { exact: true })).toBeVisible();
      await shoot(page, 'selection', theme);
    });

    test('long content: very long group name, window name, tab titles, URL and notes', async ({ context, extensionId }) => {
      const page = await openSeededPopup(context, extensionId, theme, { groups: LONG_CONTENT, activeGroupIndex: 1 });

      await expect(page.getByRole('button', { name: 'Edit group note' })).toBeVisible();
      // Nothing may push the document past the popup: the outer popup never scrolls.
      const overflow = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      }));
      expect(overflow).toEqual(POPUP_SIZE);
      await shoot(page, 'long-content', theme);
    });
  });
}
