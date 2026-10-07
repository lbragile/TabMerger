import { test, expect } from '../fixtures';
import type { Frame, Page } from '@playwright/test';
import { openPopup, seedAndReload, waitForStoredGroup } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * A change must survive the popup going away.
 *
 * Chrome destroys the action popup the moment it loses focus, and a destroyed page takes any
 * IndexedDB transaction whose commit was not yet requested with it. A group write therefore
 * asks for its commit in the same tick as its last request (see `writeGroupsState`); these tests
 * destroy the popup at exactly that instant and expect the change on disk.
 *
 * The popup runs in an iframe so it can be destroyed SYNCHRONOUSLY from inside (removing the
 * frame element). A reload or `page.close()` cannot do that: the old document keeps running for
 * a few milliseconds while the navigation or the close is in flight, which is long enough for an
 * unfinished transaction to complete on its own and hide the bug.
 */

const WORK_ID = WORK_GROUP.id;
const SEEDED_COLOR = WORK_GROUP.color;

/**
 * Runs in every frame before the app's scripts. Once armed (`__tmDestroyOnWrite = groupId`), the
 * first groups write that changes that group's colour destroys the frame: in a microtask queued
 * by the write's LAST request, i.e. after the code issuing the write finished its synchronous run
 * and before any IndexedDB event can be delivered to the page.
 */
function destroyFrameOnGroupsWrite(seededColor: string): void {
  const w = window as unknown as { __tmDestroyOnWrite?: string; __tmDestroyed?: boolean };
  const changedTx = new WeakSet<IDBTransaction>();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: [unknown, IDBValidKey?]) {
    const request = put.apply(this, args);
    const armedFor = w.__tmDestroyOnWrite;
    if (!armedFor || this.transaction.mode !== 'readwrite') return request;
    const value = args[0] as { id?: string; color?: string };
    if (this.name === 'groups' && value.id === armedFor && value.color !== seededColor) changedTx.add(this.transaction);
    if (this.name === 'groupsState' && changedTx.has(this.transaction)) {
      w.__tmDestroyOnWrite = undefined;
      queueMicrotask(() => {
        w.__tmDestroyed = true;
        window.frameElement?.remove();
      });
    }
    return request;
  } as typeof IDBObjectStore.prototype.put;
}

/** Hosts the popup in an iframe of a plain same-origin extension page (which runs no app code). */
async function openPopupInFrame(page: Page, extensionId: string): Promise<Frame> {
  await page.goto(`chrome-extension://${extensionId}/manifest.json`);
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.id = 'popup';
    frame.src = 'popup.html';
    frame.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;border:0;background:#fff';
    document.body.appendChild(frame);
  });
  const handle = await page.waitForSelector('#popup');
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('popup frame did not attach');
  await frame.waitForLoadState('networkidle');
  return frame;
}

test.describe('Persistence — a change survives the popup going away', () => {
  test('a colour change is on disk when the popup is destroyed the instant its write was handed to IndexedDB', async ({ context, extensionId }) => {
    await context.addInitScript(destroyFrameOnGroupsWrite, SEEDED_COLOR);
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    const popup = await openPopupInFrame(page, extensionId);
    await popup.locator('[data-sidebar-group-index="1"]').getByRole('button', { name: 'Change group color' }).click();
    await popup.getByPlaceholder('#rrggbb').fill('#112233');
    await popup.evaluate((id) => {
      (window as unknown as { __tmDestroyOnWrite?: string }).__tmDestroyOnWrite = id;
    }, WORK_ID);

    // The click's write destroys the popup, so the click itself may never "finish".
    await popup.getByRole('button', { name: 'Apply' }).click({ noWaitAfter: true }).catch(() => undefined);
    await expect(page.locator('#popup')).toHaveCount(0);

    // Nothing of the popup is alive any more: only a commit that was already requested can land.
    await waitForStoredGroup(page, (g) => g.id === WORK_ID && g.color !== SEEDED_COLOR, 'the Work group with its new colour');

    // ...and a popup opened afterwards shows it.
    const reopened = await openPopup(context, extensionId);
    await expect(
      reopened.locator('[data-sidebar-group-index="1"]').getByRole('button', { name: 'Change group color' })
    ).toHaveCSS('background-color', 'rgb(17, 34, 51)');
  });
});
