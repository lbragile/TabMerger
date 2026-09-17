/**
 * dndMatrix.repro.ts — run every drag-and-drop kind against the real MV3 toolbar
 * action popup and log the resulting IndexedDB state after each:
 *
 *   1. tab reorder within a window
 *   2. tab move across windows (same group)
 *   3. window reorder within a group
 *   4. window → another group (sidebar row drop)
 *   5. tab → another group (sidebar row drop)
 *   6. group reorder in the sidebar
 *
 * Same caveat as popupInstrumented.repro.ts: CDP synthesises a clean event
 * stream, so this cannot prove the real-popup fix — it's a fast harness + a
 * before/after dump for eyeballing.
 *
 * Run:  pnpm --filter @tabmerger/extension repro:dnd:matrix
 */
import { test } from '@playwright/test';
import { startPopupSession, readAllGroups, dragBetween } from './harness';
import { scenarios, PRIMARY_GROUP_ID, PRIMARY_GROUP_NAME, SECONDARY_GROUP_NAME } from './settings';

test('popup DnD — full drag matrix', async () => {
  const s = await startPopupSession(scenarios.matrix);
  const { popup } = s;
  const dump = async (label: string) => {
    const all = await readAllGroups(popup);
    console.log(`\n[matrix] ${label}`);
    for (const g of all) console.log(`   ${g.name}: ${g.windows} win  ${JSON.stringify(g.tabs)}`);
  };

  try {
    await popup.getByRole('button', { name: PRIMARY_GROUP_NAME }).click();
    await popup.waitForTimeout(300);
    await dump('seed');

    // 1. tab reorder within window 0
    let tabHandles = popup.getByLabel('Drag to reorder tab');
    if ((await tabHandles.count()) >= 2) {
      await dragBetween(popup, tabHandles.nth(0), tabHandles.nth(1));
      await dump('1. tab reorder within window');
    }

    // 2. tab across windows — last handle up onto the first
    tabHandles = popup.getByLabel('Drag to reorder tab');
    const tc = await tabHandles.count();
    if (tc >= 2) {
      await dragBetween(popup, tabHandles.nth(tc - 1), tabHandles.nth(0));
      await dump('2. tab across windows');
    }

    // 3. window reorder within the group
    let winHandles = popup.getByLabel(/reorder window/i);
    console.log(`\n[matrix] window drag handles: ${await winHandles.count()}`);
    if ((await winHandles.count()) >= 2) {
      await dragBetween(popup, winHandles.nth(0), winHandles.nth(1));
      await dump('3. window reorder within group');
    }

    // 4. window → another group's sidebar row
    winHandles = popup.getByLabel(/reorder window/i);
    if ((await winHandles.count()) >= 1) {
      await dragBetween(
        popup,
        winHandles.nth(0),
        popup.getByRole('button', { name: SECONDARY_GROUP_NAME })
      );
      await dump(`4. window → "${SECONDARY_GROUP_NAME}"`);
    }

    // 5. tab → another group's sidebar row
    tabHandles = popup.getByLabel('Drag to reorder tab');
    if ((await tabHandles.count()) >= 1) {
      await dragBetween(
        popup,
        tabHandles.nth(0),
        popup.getByRole('button', { name: SECONDARY_GROUP_NAME })
      );
      await dump(`5. tab → "${SECONDARY_GROUP_NAME}"`);
    }

    // 6. group reorder in the sidebar
    const groupHandles = popup.getByLabel(/reorder group/i);
    console.log(`\n[matrix] group drag handles: ${await groupHandles.count()}`);
    if ((await groupHandles.count()) >= 2) {
      await dragBetween(popup, groupHandles.nth(0), groupHandles.nth(1));
      await dump('6. group reorder in sidebar');
    }

    const primary = (await readAllGroups(popup)).find((g) => g.id === PRIMARY_GROUP_ID);
    console.log(`\n[matrix] final "${PRIMARY_GROUP_NAME}":`, JSON.stringify(primary));
  } finally {
    await s.teardown();
  }
});
