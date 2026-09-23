import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, startFixtureServer } from '../helpers';
import { NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP } from '../seed';

test.describe('Core — sidebar and basic invariants', () => {
  test('popup shows seeded groups in the sidebar', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP]);

    await expect(page.getByRole('button', { name: 'Now Open', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Work Stuff', exact: true })).toBeVisible();
    // 'Reading List' (12 chars > 10) is truncated in span but aria-label is untruncated
    await expect(page.getByRole('button', { name: 'Reading List', exact: true })).toBeVisible();
  });

  test('Now Open is first in sidebar and has no delete option', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await expect(page.getByRole('button', { name: 'Now Open', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Now Open', exact: true }).click({ button: 'right' });
    await page.waitForTimeout(300);
    await expect(page.getByText('Delete group')).not.toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('creating a new group adds it to the sidebar', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await page.getByRole('button', { name: /add group|new group|\+/i }).click();

    await expect(page.locator('[data-sidebar-group-index]')).toHaveCount(3, { timeout: 5_000 });
  });

  test('Now Open sidebar badge is visible', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    // useCurrentTabs overwrites seed data with real browser tabs — don't assert specific count
    const nowOpenItem = page.locator('[data-sidebar-group-index="0"]');
    await expect(nowOpenItem.getByText('◆')).toBeVisible();
  });

  test('dragging a sidebar group reorders it', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP]);

    const items = page.locator('[data-sidebar-group-index]');
    expect(await items.nth(1).getAttribute('aria-label')).toBe('Work Stuff');
    expect(await items.nth(2).getAttribute('aria-label')).toBe('Reading List');

    // Drag must originate from the grip handle — dnd-kit listeners are only
    // attached to `[aria-label="Drag to reorder group"]`, not the whole row.
    const fromBox = await items.nth(1).getByRole('button', { name: 'Drag to reorder group' }).boundingBox();
    const toBox = await items.nth(2).boundingBox();
    if (!fromBox || !toBox) throw new Error('Could not locate group items for drag');

    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2 + 10, { steps: 3 });
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2 + 5, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(500);
    expect(await items.nth(1).getAttribute('aria-label')).toBe('Reading List');
    expect(await items.nth(2).getAttribute('aria-label')).toBe('Work Stuff');
  });

  test('selection mode bulk delete then undo restores tabs', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await page.getByRole('button', { name: 'Work Stuff', exact: true }).click();

    await page.getByRole('button', { name: /select/i }).click();
    await page.getByRole('listitem').getByRole('checkbox', { name: /^select /i }).first().click();
    await page.getByRole('button', { name: /delete/i }).click();

    await expect(page.getByText('Jira Board')).not.toBeVisible();

    await page.getByRole('button', { name: /undo/i }).click();
    await expect(page.getByText('Jira Board')).toBeVisible();
  });

  test('right-click "Rename tab" allows renaming it (double-click no longer triggers rename)', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await page.getByRole('button', { name: 'Work Stuff', exact: true }).click();

    // Double-click must NOT enter rename mode
    await page.getByText('Jira Board').dblclick();
    await expect(page.getByRole('textbox')).not.toBeVisible();

    // Right-click → "Rename tab" is the only rename trigger
    await page.getByRole('listitem', { name: 'Jira Board' }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Rename tab' }).click();

    const input = page.getByRole('textbox');
    await input.fill('Sprint Tracker');
    await input.press('Enter');

    await expect(page.getByText('Sprint Tracker')).toBeVisible();
  });

  test('URL rule auto-assigns a new tab to the matching group', async ({ context, extensionId }) => {
    // Two popup opens (seed, then verify) plus polling headroom for the background
    // write push this past the default 30s test timeout even without any real network call.
    test.setTimeout(45_000);
    // A real loopback server, not `context.route()`/`page.route()` — request interception
    // at the CDP level was tried here and made the background worker stop seeing the tab
    // as a normal navigation (chrome.tabs.onUpdated with status:'complete' never fired
    // reliably), which broke this test even locally. A genuine TCP navigation avoids that
    // while still not depending on the public internet.
    const fixture = await startFixtureServer('torvalds/linux — fixture repo page');
    try {
      const RULE_GROUP = {
        id: 'githubgroup1',
        name: 'Rule Match',
        color: 'rgba(59,130,246,1)',
        windows: [{ id: 10, incognito: false, focused: false, tabs: [] }],
      };

      // Seed via a short-lived popup page, then CLOSE it before triggering the real
      // navigation. Keeping the popup open here would leave its useCurrentTabs hook
      // listening to the SAME chrome.tabs.onUpdated events as the background worker's
      // applyUrlRule and racing it — both do a read-modify-write of the FULL GroupsState,
      // and the write-serialization in localDb.ts is per-JS-context, so it does NOT
      // protect a popup write against a background write (this is a real, documented,
      // pre-existing bug — not something this test should paper over by retrying).
      // Closing the popup before the tab opens matches the equally-common real usage of
      // this feature (a URL rule firing while the toolbar popup isn't open) and sidesteps
      // the race entirely instead of masking it.
      const seedPage = await openPopup(context, extensionId);
      await seedAndReload(seedPage, [NOW_OPEN, RULE_GROUP]);

      const host = new URL(fixture.url).host;
      await seedPage.evaluate((h) => {
        return new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('tabmerger', 1);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('settings', 'readwrite');
            // settings store uses an inline keyPath ('id') — value must carry its own
            // id field, matching localDb.ts's setSetting shape { id, value }.
            // Pattern matcher only supports a single `*` glob, wildcarded past the fixed
            // 127.0.0.1 prefix since the port changes every run.
            tx.objectStore('settings').put({
              id: 'urlRules',
              value: [{ id: 'rule-1', pattern: `${h}/*`, groupId: 'githubgroup1', createdAt: Date.now() }],
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        });
      }, host);
      await seedPage.close();

      const newTab = await context.newPage();
      await newTab.goto(`${fixture.url}/torvalds/linux`, { waitUntil: 'domcontentloaded', timeout: 20_000 });

      // Wait on the real synchronization point — the background worker's applyUrlRule
      // write landing in IndexedDB — instead of a fixed sleep guessing how long that
      // takes. Read through the service worker (not a popup page) so this check itself
      // doesn't mount another useCurrentTabs listener while we're waiting. Re-fetch the
      // worker on every attempt (not once, up front): MV3 service workers get discarded
      // and respawned on their own schedule, and `.evaluate()` on a since-terminated
      // `Worker` handle from Playwright hangs forever instead of rejecting — the first
      // poll attempt would wedge the whole `expect.poll` if the worker it grabbed died
      // in the gap between the `newTab.goto` and the read.
      const currentSw = async () => {
        let [w] = context.serviceWorkers();
        if (!w) w = await context.waitForEvent('serviceworker', { timeout: 5_000 });
        return w;
      };
      await expect.poll(async () => {
        const sw = await currentSw();
        // A short per-attempt race, not just the outer expect.poll timeout: if THIS
        // particular worker handle dies mid-`.evaluate()`, the call hangs rather than
        // rejecting, and without this race that would wedge the whole poll on one dead
        // handle instead of retrying with a freshly-fetched worker next tick.
        return Promise.race([
          sw.evaluate((groupId) => new Promise<number>((resolve) => {
            const open = indexedDB.open('tabmerger', 1);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('groups', 'readonly');
              tx.objectStore('groups').get(groupId).onsuccess = (e) => {
                const g = (e.target as IDBRequest).result;
                resolve(g?.windows?.[0]?.tabs?.length ?? 0);
              };
            };
          }), 'githubgroup1'),
          new Promise<number>((resolve) => setTimeout(() => resolve(0), 2_000)),
        ]);
      }, { timeout: 15_000, message: 'waiting for applyUrlRule to persist the matched tab to IndexedDB' }).toBeGreaterThan(0);

      const page = await openPopup(context, extensionId);
      await page.getByRole('button', { name: 'Rule Match', exact: true }).click();
      await expect(page.getByText(/torvalds|linux/i).first()).toBeVisible();

      await newTab.close();
    } finally {
      await fixture.close();
    }
  });
});
