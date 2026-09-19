/**
 * popupInstrumented.repro.ts — drive ONE tab reorder inside the real MV3 toolbar
 * action popup with `tm_dnd_debug` on, then print the `[tm-dnd]` lifecycle stage
 * sequence.
 *
 * NOTE: this cannot *prove* the real-popup fix — Playwright / CDP synthesise a
 * clean, un-coalesced event stream that never reproduced the "drag never starts"
 * bug. Use it as a fast harness + to eyeball the stage log. The authoritative
 * check is a human dragging in the real popup (see `src/lib/dndDebug.ts`).
 *
 * Run:  pnpm --filter @tabmerger/extension repro:dnd:popup
 *       REPRO_HEADED=1 REPRO_KEEP_OPEN=8000 pnpm --filter @tabmerger/extension repro:dnd:popup
 */
import { test, expect } from '@playwright/test';
import { startPopupSession, readAllGroups, dragBetween, tmDndStages } from './harness';
import { scenarios, PRIMARY_GROUP_ID, PRIMARY_GROUP_NAME } from './settings';

test('popup DnD — single tab reorder with [tm-dnd] instrumentation', async () => {
  const s = await startPopupSession(scenarios.minimal);
  try {
    await s.popup.getByRole('button', { name: PRIMARY_GROUP_NAME, exact: true }).click();
    await s.popup.waitForTimeout(300);

    const handles = s.popup.getByLabel('Drag to reorder tab');
    const count = await handles.count();
    console.log(`\n[repro] "${PRIMARY_GROUP_NAME}" tab drag handles: ${count}`);
    expect(count).toBeGreaterThanOrEqual(2);

    const before = (await readAllGroups(s.popup)).find((g) => g.id === PRIMARY_GROUP_ID);
    console.log('[repro] before:', JSON.stringify(before?.tabs));

    // drag the first tab down onto the last
    await dragBetween(s.popup, handles.nth(0), handles.nth(count - 1));

    const after = (await readAllGroups(s.popup)).find((g) => g.id === PRIMARY_GROUP_ID);
    console.log('[repro] after: ', JSON.stringify(after?.tabs));

    const stages = tmDndStages(s.consoleLog);
    console.log('\n[repro] [tm-dnd] stages seen:');
    for (const line of stages) console.log('   ', line);
    if (stages.length === 0) {
      console.log('    (none — tm_dnd_debug off, or nothing logged)');
    }

    const reordered = JSON.stringify(before?.tabs) !== JSON.stringify(after?.tabs);
    console.log(`\n[repro] IndexedDB order changed? ${reordered}`);
    console.log(
      '[repro] reminder: a green result here does NOT prove the real-popup fix — ' +
        'CDP events are synthetic. Verify by hand per src/lib/dndDebug.ts.\n'
    );
  } finally {
    await s.teardown();
  }
});
