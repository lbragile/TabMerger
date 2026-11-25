// Capture spec for posts that needed a cover of their own (index cards must not look alike):
// firefox-tab-groups and move-tabs-between-computers. The real TabMerger popup, production build,
// 800×600 at 2x, one test per post, with the helpers in shotHelpers.ts (see ../README.md). Each
// test seeds its own sidebar groups, not popupWithGroups()'s Work / Reading list, so the captures
// differ clearly from the other posts' covers.
//
//   BLOG_OUT=<raw> BLOG_THEME=light TM_E2E_EXT_DIR=<abs build dir> \
//     pnpm --filter @tabmerger/extension exec playwright test -c scripts/blog-screenshots/tm/playwright.covers.config.mjs
import { expect } from '../../../packages/extension/e2e/fixtures';
import { openPopup, seedIdb, seedSettings } from '../../../packages/extension/e2e/helpers';
import { RESEARCH, THEME, TITLES, TRIP, chromeGroup, dismissToasts, fav, groupSummary, openWindow, routeStubs, settle, shot, test } from './shotHelpers';
import type { BrowserContext, Page } from '@playwright/test';

test.setTimeout(180_000);

// Extra stub pages for these captures only (shotHelpers' DEV/RESEARCH/TRIP/NEWS slices are
// computed at import, so adding keys here doesn't change them).
const HOME = {
  'https://www.houzz.com/photos/kitchen-ideas-and-designs-phbr0-bp~t_709': 'Kitchen Ideas & Design Photos | Houzz',
  'https://www.ikea.com/us/en/rooms/kitchen/': 'Kitchen furniture & ideas - IKEA US',
  'https://www.homedepot.com/b/Kitchen-Kitchen-Cabinets/N-5yc1vZar4i': 'Kitchen Cabinets - The Home Depot',
  'https://www.thisoldhouse.com/bathrooms': 'Bathroom Remodeling Ideas - This Old House',
  'https://www.angi.com/': 'Angi: Find local home service pros',
  'https://www.thumbtack.com/': 'Thumbtack: Hire local pros',
  'https://www.pinterest.com/ideas/': 'Pinterest ideas',
  'https://www.bobvila.com/': 'Bob Vila: Home improvement advice',
  'https://www.consumerreports.org/appliances/': 'Appliance Ratings & Reviews - Consumer Reports',
};
Object.assign(TITLES, HOME);
const H = Object.keys(HOME);

const tab = (title: string, url: string, now: number) => ({ id: 0, title, url, favIconUrl: fav(new URL(url).hostname), savedAt: now });

/** Opens the popup with Now Open plus the given saved groups and the theme, and reloads. */
async function popupWith(context: BrowserContext, extensionId: string, groups: Parameters<typeof seedIdb>[1]) {
  await routeStubs(context);
  const page = await openPopup(context, extensionId);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.emulateMedia({ colorScheme: THEME, reducedMotion: 'reduce' });
  await expect(page.locator('[data-sidebar-group-index="0"]')).toBeVisible();
  const now = await page.evaluate(() => Date.now());
  await seedIdb(page, [
    { id: 'nowopen0001', name: 'Now Open', permanent: true, color: 'rgba(128, 128, 128, 1)', updatedAt: now, windows: [] },
    ...groups.map((g) => ({ ...g, updatedAt: now })),
  ]);
  await seedSettings(page, { appSettings: { theme: THEME }, activeGroupIndex: 0 });
  await page.evaluate((t) => localStorage.setItem('tabmerger-theme', t), THEME);
  await page.reload({ waitUntil: 'networkidle' });
  const [sw] = context.serviceWorkers();
  return { page, sw };
}

/** Clicks Add Group and names the new group. */
async function addGroup(page: Page, name: string) {
  await page.getByRole('button', { name: /^Add Group$/ }).click();
  await page.waitForTimeout(500);
  const rename = page.locator('input:focus');
  if (await rename.count()) {
    await rename.fill(name);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
}

test('firefox-tab-groups', async ({ context, extensionId }) => {
  // The post's TabMerger steps for real: windows with browser tab groups, Add Group, Merge with
  // current, close the windows. The saved tabs keep their tab-group labels.
  const slug = 'firefox-tab-groups';
  const now = Date.now();
  const { page, sw } = await popupWith(context, extensionId, [
    {
      id: 'blogjobs001', name: 'Job applications', color: 'rgba(168, 85, 247, 1)',
      windows: [{ id: 901, incognito: false, focused: false, tabs: [tab(TITLES[RESEARCH[2]], RESEARCH[2], now), tab(TITLES[RESEARCH[4]], RESEARCH[4], now)] }],
    },
    {
      id: 'blogcook001', name: 'Weekend in Sintra', color: 'rgba(236, 72, 153, 1)',
      windows: [{ id: 902, incognito: false, focused: false, tabs: [tab(TITLES[TRIP[3]], TRIP[3], now), tab(TITLES[TRIP[2]], TRIP[2], now)] }],
    },
  ]);
  const w1 = await openWindow(context, sw, [H[0], H[1], H[2], H[3]]);
  await chromeGroup(sw, w1, [H[0], H[1], H[2]], 'Kitchen', 'orange');
  const w2 = await openWindow(context, sw, [H[4], H[5], H[6]]);
  await chromeGroup(sw, w2, [H[4], H[5]], 'Quotes', 'green');
  const w3 = await openWindow(context, sw, [H[7], H[8]]);
  await settle(context, page, TITLES[H[0]]);

  await addGroup(page, 'Home renovation');
  await page.getByRole('button', { name: 'More group options' }).first().click();
  await page.getByRole('menuitem', { name: /Merge with current/ }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  // Close the windows: the group keeps every tab.
  for (const id of [w1, w2, w3]) await sw.evaluate((wid: number) => chrome.windows.remove(wid), id);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Home renovation', exact: true }).click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await expect(groupSummary(page)).toHaveText('3 Windows ◆ 9 Tabs');
  await shot(page, slug, 'kept-groups', [{ id: 'summary', label: '3 Windows ◆ 9 Tabs', locator: groupSummary(page) }]);
});

test('move-tabs-between-computers', async ({ context, extensionId }) => {
  // Step 1 of the file route: a new group to carry over, about to take every open window.
  const slug = 'move-tabs-between-computers';
  const now = Date.now();
  const { page, sw } = await popupWith(context, extensionId, [
    {
      id: 'blogspan001', name: 'Spanish course', color: 'rgba(234, 179, 8, 1)',
      windows: [{ id: 911, incognito: false, focused: false, tabs: [tab(TITLES[TRIP[0]], TRIP[0], now), tab(TITLES[TRIP[4]], TRIP[4], now)] }],
    },
    {
      id: 'bloginvo001', name: 'Tax paperwork', color: 'rgba(20, 184, 166, 1)',
      windows: [{ id: 912, incognito: false, focused: false, tabs: [tab(TITLES[RESEARCH[3]], RESEARCH[3], now)] }],
    },
  ]);
  await openWindow(context, sw, [H[8], H[7], H[3]]);
  await openWindow(context, sw, [RESEARCH[0], RESEARCH[1]]);
  await settle(context, page, TITLES[H[8]]);
  await addGroup(page, 'For the new laptop');
  await page.getByRole('button', { name: 'More group options' }).first().click();
  const merge = page.getByRole('menuitem', { name: /Merge with current/ });
  await merge.scrollIntoViewIfNeeded();
  // Highlight it with keyboard focus, not hover: shot() parks the mouse at (120, 20), and a pointer
  // leaving the item would clear a hover highlight.
  await merge.focus();
  await page.waitForTimeout(400);
  await shot(page, slug, 'merge-menu', [{ id: 'merge', label: 'Merge with current', locator: merge }]);
});
