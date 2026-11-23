// Capture spec for batch 2 of the "TabMerger guides" series: the real TabMerger popup, a
// production build pointed at the LOCAL Supabase stack and web app (built with VITE_* overrides
// in the scratchpad, AI flag off as in production), 800×600 at 2x, one test per post.
//
// The sync test signs in as the local seed Pro user and resets that user's sync rows in the local
// database first (docker exec into supabase_db_tabmerger). It never talks to preview or production.
//
//   BLOG_OUT=<raw> BLOG_THEME=light TM_E2E_EXT_DIR=<abs local build dir> SYNC_EMAIL=... SYNC_PASSWORD=... \
//     pnpm --filter @tabmerger/extension exec playwright test -c scripts/blog-screenshots/tm/playwright.series2.config.mjs
import { execSync } from 'child_process';
import { expect } from '../../../packages/extension/e2e/fixtures';
import { PRODUCTION_EXTENSION_PATH } from '../../../packages/extension/e2e/extensionPath';
import { dismissTour, openPopup } from '../../../packages/extension/e2e/helpers';
import { DEV, NEWS, RESEARCH, THEME, TRIP, dismissToasts, fav, openSettingsData, openWindow, popupWithGroups, routeStubs, settle, shot, test } from './shotHelpers';
import type { BrowserContext, Page } from '@playwright/test';

test.setTimeout(240_000);

const tab = (title: string, url: string, now: number, extra: Record<string, unknown> = {}) => ({ id: 0, title, url, favIconUrl: fav(new URL(url).hostname), savedAt: now, ...extra });
const DAY = 24 * 60 * 60 * 1000;

/** Closes the "approaching the free limit" banner, if shown. */
async function dismissLimitBanner(page: Page) {
  const banner = page.getByText(/approaching the free limit/);
  if (await banner.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss', exact: true }).first().click();
    await page.waitForTimeout(400);
  }
}

async function openSettingsTab(page: Page, tabName: string) {
  await page.getByRole('button', { name: /settings menu|account menu/i }).first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('tab', { name: tabName }).click();
  await page.waitForTimeout(700);
  return settings;
}

const imagesLoaded = (page: Page) => page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));

// ---------------------------------------------------------------------------------------------

test('organize-tabs-by-project', async ({ context, extensionId }) => {
  const slug = 'organize-tabs-by-project';
  const now = Date.now();
  const { page, sw } = await popupWithGroups(context, extensionId, [
    {
      id: 'blogproj001', name: 'Website redesign', color: 'rgba(168, 85, 247, 1)', updatedAt: now,
      note: 'Launch review on Friday. Feedback goes in the Feedback window.',
      windows: [
        { id: 901, name: 'Design', incognito: false, focused: false, starred: true, tabs: [
          tab('Material Design 3', 'https://m3.material.io/', now),
          tab('Color contrast checker | WebAIM', 'https://webaim.org/resources/contrastchecker/', now),
        ] },
        { id: 902, name: 'Build', incognito: false, focused: false, tabs: [
          tab('Pull requests · lbragile/TabMerger', 'https://github.com/lbragile/TabMerger/pulls', now),
          tab('Documentation | Node.js', 'https://nodejs.org/en/docs', now),
          tab('React Reference Overview – React', 'https://react.dev/reference/react', now),
        ] },
        { id: 903, name: 'Feedback', incognito: false, focused: false, tabs: [
          tab('Issues · lbragile/TabMerger', 'https://github.com/lbragile/TabMerger/issues', now),
        ] },
      ],
    },
  ]);
  await openWindow(context, sw, NEWS);
  await settle(context, page, 'Hacker News');
  await page.getByRole('button', { name: 'Website redesign', exact: true }).click();
  await page.waitForTimeout(800);
  await imagesLoaded(page);
  await shot(page, slug, 'project-group', [
    { id: 'windows', label: 'Windows by stage', locator: ['Design', 'Build', 'Feedback'].map((n) => page.getByRole('main').getByText(n, { exact: true }).first()), fit: 'content' },
  ]);
  // Archive a finished project from the sidebar menu.
  await page.getByRole('button', { name: 'Reading list', exact: true }).click({ button: 'right' });
  await page.waitForTimeout(400);
  const archive = page.getByRole('menuitem', { name: /Archive group/ });
  await archive.hover();
  await archive.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, slug, 'archive-menu', [{ id: 'archive', label: 'Archive group', locator: archive }]);
  await archive.click();
  await page.waitForTimeout(800);
  await dismissToasts(page);
  const archivedToggle = page.getByRole('button', { name: /^archived \(/i });
  if ((await archivedToggle.getAttribute('aria-expanded')) !== 'true') await archivedToggle.click();
  await page.waitForTimeout(400);
  await page.getByText('Reading list', { exact: true }).first().click();
  await page.waitForTimeout(800);
  await imagesLoaded(page);
  await shot(page, slug, 'archived', [
    { id: 'banner', label: 'Read-only until restored', locator: page.getByText(/^Archived .*Read-only/).first(), fit: 'content' },
  ]);
});

test('tabs-as-a-to-do-list', async ({ context, extensionId }) => {
  const slug = 'tabs-as-a-to-do-list';
  const now = Date.now();
  const { page, sw } = await popupWithGroups(context, extensionId, [
    {
      id: 'blogtodo001', name: 'This week', color: 'rgba(239, 68, 68, 1)', updatedAt: now,
      windows: [{ id: 911, name: 'To read', incognito: false, focused: false, tabs: [
        tab('Spaced repetition - Wikipedia', 'https://en.wikipedia.org/wiki/Spaced_repetition', now, { note: 'Summarise for Thursday’s team notes' }),
        tab('Issues · lbragile/TabMerger', 'https://github.com/lbragile/TabMerger/issues', now, { customTitle: 'Triage new issues', reminder: { fireAt: now + 3 * 60 * 60 * 1000, note: 'Before stand-up' } }),
        tab('Weather for Lisbon, Portugal', 'https://www.timeanddate.com/weather/portugal/lisbon', now - 40 * DAY),
        tab('The Man in Seat 61 | The train travel guide', 'https://www.seat61.com/', now - 40 * DAY),
        tab('Documentation | Node.js', 'https://nodejs.org/en/docs', now),
      ] }],
    },
  ]);
  await openWindow(context, sw, DEV.slice(0, 2));
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await page.waitForTimeout(800);
  await imagesLoaded(page);
  await shot(page, slug, 'todo-group', [
    { id: 'note', label: 'A note on the tab', locator: page.getByRole('main').getByRole('button', { name: 'Edit tab note' }).first() },
    { id: 'reminder', label: 'A reminder is set', locator: page.getByRole('main').getByRole('button', { name: 'Edit tab reminder' }).first() },
    { id: 'stale', label: 'Clear stale tabs', locator: page.getByRole('button', { name: /^Remove \d+ stale tabs?$/ }).first() },
  ]);
  const row = page.getByRole('main').getByRole('listitem', { name: /Documentation \| Node\.js/ });
  await row.click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /Remind me/ }).click();
  await page.waitForTimeout(500);
  const note = page.getByPlaceholder('Optional note…');
  if (await note.isVisible().catch(() => false)) await note.fill('Read before the review');
  await page.waitForTimeout(300);
  await shot(page, slug, 'reminder', [
    { id: 'remind-in', label: 'Remind me in…', locator: page.getByText('Remind me in…', { exact: true }) },
  ]);
});

test('auto-sort-tabs-with-url-rules', async ({ context, extensionId }) => {
  const slug = 'auto-sort-tabs-with-url-rules';
  const now = Date.now();
  const { page, sw } = await popupWithGroups(context, extensionId, [
    { id: 'blogtrip001', name: 'Trip to Lisbon', color: 'rgba(249, 115, 22, 1)', updatedAt: now, windows: [{ id: 921, incognito: false, focused: false, tabs: [tab('Lisbon – Travel guide at Wikivoyage', 'https://en.wikivoyage.org/wiki/Lisbon', now)] }] },
  ]);
  await openWindow(context, sw, DEV.slice(0, 2));
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  await page.getByRole('button', { name: /settings menu|account menu/i }).first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('dialog').getByRole('button', { name: 'Manage', exact: true }).click();
  await page.waitForTimeout(500);
  const rules = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'URL Rules', exact: true }) });
  const add = async (pattern: string, group: string, snap?: string) => {
    await rules.getByRole('button', { name: /Add rule/ }).click();
    await page.waitForTimeout(300);
    const dialog = page.getByRole('dialog', { name: 'Add URL Rule' });
    await dialog.getByPlaceholder(/Pattern, e\.g\./).fill(pattern);
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: group, exact: true }).click();
    await page.waitForTimeout(300);
    if (snap) {
      await shot(page, slug, snap, [
        { id: 'pattern', label: 'The address pattern', locator: dialog.getByPlaceholder(/Pattern, e\.g\./) },
        { id: 'group', label: 'The target group', locator: dialog.getByRole('combobox') },
      ]);
    }
    await dialog.getByRole('button', { name: /Add rule/ }).click();
    await page.waitForTimeout(400);
  };
  await add('github.com/lbragile/*', 'Work');
  await add('*.wikipedia.org/wiki/*', 'Reading list');
  await add('*wikivoyage.org/wiki/*', 'Trip to Lisbon', 'add-rule');
  await shot(page, slug, 'rules-list', [
    { id: 'order', label: 'Checked top to bottom', locator: rules.getByRole('button', { name: 'Move rule up' }).first() },
    { id: 'used', label: 'Free plan count', locator: rules.getByText(/^3\/3 used$/) },
  ]);
  await rules.getByRole('button', { name: 'Save all rules', exact: true }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await openWindow(context, sw, ['https://en.wikivoyage.org/wiki/Sintra']);
  await page.bringToFront();
  await page.getByRole('button', { name: 'Trip to Lisbon', exact: true }).click();
  await page.waitForTimeout(1200);
  await imagesLoaded(page);
  await shot(page, slug, 'rule-result', [
    { id: 'new-tab', label: 'Filed by the rule', locator: page.getByRole('main').getByRole('listitem', { name: /Sintra/ }), fit: 'content' },
  ]);
});

test('import-tabs-into-tabmerger', async ({ context, extensionId }) => {
  const slug = 'import-tabs-into-tabmerger';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, RESEARCH.slice(0, 2));
  await settle(context, page, 'Spaced repetition - Wikipedia');
  const settings = await openSettingsData(page);
  const importBtn = settings.getByRole('button', { name: 'Import file', exact: true });
  await importBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, slug, 'data-tab', [
    { id: 'import', label: 'Import a file', locator: importBtn },
    { id: 'export', label: 'Export your groups', locator: settings.getByRole('button', { name: 'Export JSON', exact: true }) },
  ]);
  // A OneTab export: "url | title" per line, a blank line between lists.
  const onetab = [
    'https://en.wikivoyage.org/wiki/Lisbon | Lisbon – Travel guide at Wikivoyage',
    'https://www.seat61.com/ | The Man in Seat 61 | The train travel guide',
    'https://www.timeanddate.com/weather/portugal/lisbon | Weather for Lisbon, Portugal',
    '',
    'https://arxiv.org/abs/1706.03762 | [1706.03762] Attention Is All You Need',
    'https://scholar.google.com/ | Google Scholar',
  ].join('\n');
  await settings.locator('input[type="file"]').setInputFiles({ name: 'onetab-export.txt', mimeType: 'text/plain', buffer: Buffer.from(onetab) });
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: 'Import 2 groups?' }));
  await expect(confirm.getByText('Import 2 groups?')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, slug, 'import-confirm', [
    { id: 'import-confirm', label: 'Import 2 groups', locator: confirm.getByRole('button', { name: 'Import 2 groups', exact: true }) },
  ]);
  await confirm.getByRole('button', { name: 'Import 2 groups', exact: true }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  await page.getByRole('button', { name: 'Imported 1', exact: true }).click();
  await page.waitForTimeout(900);
  await imagesLoaded(page);
  await shot(page, slug, 'imported', [
    { id: 'imported', label: 'One group per list', locator: [page.getByRole('button', { name: 'Imported 1', exact: true }), page.getByRole('button', { name: 'Imported 2', exact: true })], fit: 'content' },
  ]);
});

test('tabmerger-free-vs-pro', async ({ context, extensionId }) => {
  const slug = 'tabmerger-free-vs-pro';
  const now = Date.now();
  const g = (id: string, name: string, color: string, urls: string[]) => ({
    id, name, color, updatedAt: now,
    windows: [{ id: Math.floor(Math.random() * 1e6), incognito: false, focused: false, tabs: urls.map((u) => tab(u.split('/')[2], u, now)) }],
  });
  const { page, sw } = await popupWithGroups(context, extensionId, [
    g('blogfvp0001', 'Thesis sources', 'rgba(168, 85, 247, 1)', RESEARCH.slice(0, 3)),
    g('blogfvp0002', 'Trip to Lisbon', 'rgba(249, 115, 22, 1)', TRIP.slice(0, 3)),
    g('blogfvp0003', 'Side project', 'rgba(20, 184, 166, 1)', DEV.slice(3, 6)),
    g('blogfvp0004', 'Gift ideas', 'rgba(236, 72, 153, 1)', NEWS),
    g('blogfvp0005', 'Old sprint', 'rgba(107, 114, 128, 1)', DEV.slice(0, 2)),
  ]);
  await openWindow(context, sw, DEV.slice(0, 2));
  await settle(context, page, 'Fetch API - Web APIs | MDN');
  await page.waitForTimeout(500);
  await shot(page, slug, 'over-limit', [
    { id: 'banner', label: 'Free plan notice', locator: page.getByText(/approaching the free limit/).first(), fit: 'content' },
    { id: 'locked', label: 'Over the limit', locator: [page.getByRole('button', { name: /^Gift ideas/ }).first(), page.getByRole('button', { name: /^Old sprint/ }).first()], fit: 'content' },
  ]);
});

// ---------------------------------------------------------------------------------------------
// Sync: two browser profiles, one real Pro account on the local Supabase stack.

const SYNC_EMAIL = process.env.SYNC_EMAIL ?? '';
const SYNC_PASSWORD = process.env.SYNC_PASSWORD ?? '';
const SYNC_USER_ID = process.env.SYNC_USER_ID ?? '';
const PASSPHRASE = 'blog-demo-passphrase';

/** Removes the local seed user's synced rows so every run starts from "never synced". Local DB only. */
function resetLocalSyncRows() {
  if (!/^[0-9a-f-]{36}$/.test(SYNC_USER_ID)) throw new Error('SYNC_USER_ID must be a uuid');
  const sql = ['groups', 'sessions', 'device_sessions', 'shared_bundles', 'encryption_keys']
    .map((t) => `delete from public.${t} where user_id = '${SYNC_USER_ID}';`)
    .join(' ');
  execSync(`docker exec supabase_db_tabmerger psql -U postgres -c "${sql}"`, { stdio: 'pipe' });
}

async function signIn(page: Page) {
  await page.getByRole('button', { name: /settings menu|account menu/i }).first().click();
  await page.getByRole('menuitem', { name: 'Sign in' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(SYNC_EMAIL);
  await dialog.getByLabel('Password', { exact: true }).fill(SYNC_PASSWORD);
  return dialog;
}

async function secondProfile(playwright: Parameters<Parameters<typeof test>[2]>[0]['playwright']): Promise<BrowserContext> {
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
  return context;
}

test('sync-tabs-between-devices-with-tabmerger', async ({ context, extensionId, playwright }) => {
  test.skip(!SYNC_EMAIL || !SYNC_PASSWORD, 'SYNC_EMAIL / SYNC_PASSWORD not set');
  const slug = 'sync-tabs-between-devices-with-tabmerger';
  resetLocalSyncRows();

  // Device 1: groups made locally, then sign in and set up encryption.
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, TRIP.slice(0, 3));
  await settle(context, page, 'Google Maps');
  const auth = await signIn(page);
  // The capture shows a placeholder address; the real (local seed) one is filled back before signing in.
  await auth.getByLabel('Email').fill('you@example.com');
  await shot(page, slug, 'sign-in', [{ id: 'email', label: 'Your account email', locator: auth.getByLabel('Email') }]);
  await auth.getByLabel('Email').fill(SYNC_EMAIL);
  await auth.getByRole('button', { name: 'Sign In', exact: true }).last().click();
  const setup = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Set up encryption' }) });
  await expect(setup).toBeVisible({ timeout: 30_000 });
  await dismissToasts(page);
  await setup.getByPlaceholder('New passphrase').fill(PASSPHRASE);
  await setup.getByPlaceholder('Confirm passphrase').fill(PASSPHRASE);
  await page.waitForTimeout(300);
  await shot(page, slug, 'setup-encryption', [
    { id: 'passphrase', label: 'Only you know it', locator: setup.getByPlaceholder('New passphrase') },
  ]);
  await setup.getByRole('button', { name: 'Set up encryption', exact: true }).click();
  await expect(page.getByText('Encryption set up')).toBeVisible({ timeout: 60_000 });
  await dismissToasts(page);
  await page.waitForTimeout(3000); // first sync
  // The device snapshot is pushed when Now Open changes: open one more tab.
  await openWindow(context, sw, TRIP.slice(3, 4));
  await page.bringToFront();
  await page.waitForTimeout(6000); // the snapshot's debounce and upload
  const devices1 = await openSettingsTab(page, 'Devices');
  await expect(devices1.getByRole('button', { name: 'Rename this device' })).toBeVisible({ timeout: 30_000 });
  await devices1.getByRole('button', { name: 'Rename this device' }).click();
  await devices1.getByLabel('This device name').fill('Home laptop');
  await devices1.getByLabel('Save', { exact: true }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Device 2: a fresh browser profile with nothing in it.
  const context2 = await secondProfile(playwright);
  try {
    await routeStubs(context2);
    let [sw2] = context2.serviceWorkers();
    if (!sw2) sw2 = await context2.waitForEvent('serviceworker');
    const extId2 = sw2.url().split('/')[2];
    const page2 = await openPopup(context2, extId2);
    await page2.setViewportSize({ width: 800, height: 600 });
    await page2.emulateMedia({ colorScheme: THEME, reducedMotion: 'reduce' });
    await page2.evaluate((t) => localStorage.setItem('tabmerger-theme', t), THEME);
    await page2.reload({ waitUntil: 'networkidle' });
    await openWindow(context2, sw2, DEV.slice(0, 2));
    for (const p of context2.pages()) if (p !== page2 && p.url() === 'about:blank') await p.close();
    await page2.bringToFront();
    const auth2 = await signIn(page2);
    await auth2.getByRole('button', { name: 'Sign In', exact: true }).last().click();
    const unlock = page2.getByRole('dialog').filter({ has: page2.getByRole('heading', { name: 'Unlock encryption' }) });
    await expect(unlock).toBeVisible({ timeout: 30_000 });
    await dismissToasts(page2);
    await unlock.getByPlaceholder('Passphrase', { exact: true }).fill(PASSPHRASE);
    await page2.waitForTimeout(300);
    await shot(page2, slug, 'unlock', [
      { id: 'unlock', label: 'Once per device', locator: unlock.getByRole('button', { name: 'Unlock', exact: true }) },
    ]);
    await unlock.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page2.getByText('Encryption unlocked')).toBeVisible({ timeout: 60_000 });
    await dismissToasts(page2);
    await expect(page2.getByRole('button', { name: 'Work', exact: true })).toBeVisible({ timeout: 60_000 });
    await page2.getByRole('button', { name: 'Work', exact: true }).click();
    await page2.waitForTimeout(1500);
    await imagesLoaded(page2);
    await shot(page2, slug, 'synced-groups', [
      { id: 'groups', label: 'From the other device', locator: [page2.getByRole('button', { name: 'Work', exact: true }), page2.getByRole('button', { name: 'Reading list', exact: true })], fit: 'content' },
    ]);
    await page2.waitForTimeout(4000);
    const devices2 = await openSettingsTab(page2, 'Devices');
    await expect(devices2.getByText('Home laptop')).toBeVisible({ timeout: 30_000 });
    await devices2.getByRole('button', { name: /Home laptop/ }).first().click();
    await page2.waitForTimeout(800);
    await shot(page2, slug, 'devices', [
      { id: 'other-device', label: 'Your other browser', locator: devices2.getByText('Home laptop').first(), fit: 'content' },
      { id: 'restore', label: 'Open its tabs here', locator: devices2.getByRole('button', { name: /^Restore \d+ tabs?$/ }) },
    ]);
    const settingsGeneral = await (async () => {
      await devices2.getByRole('tab', { name: 'General' }).click();
      await page2.waitForTimeout(600);
      return devices2;
    })();
    const sync = settingsGeneral.getByText('Cloud sync', { exact: true });
    // Cloud sync at the top of the scrolled list (the rows above it are not part of this post).
    await sync.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page2.waitForTimeout(400);
    await shot(page2, slug, 'cloud-sync', [{ id: 'sync', label: 'Sync on or off', locator: settingsGeneral.getByRole('switch', { name: /cloud sync/i }) }]);
  } finally {
    await context2.close();
  }
});
