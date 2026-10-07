import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, waitForStoredGroup } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

test.describe('Notes', () => {
  test('group note text persists after popup reload', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    // Open note via context menu on the Work sidebar item. This selects the group (making
    // it the active/visible one) and opens the inline note editor in the windows panel —
    // there is no longer a separate note modal (P2, popup-ui-consolidation spec).
    await page.getByRole('button', { name: 'Work', exact: true }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByText('Add note').click();

    // Scope Save to the note editor itself. A page-wide { name: 'Save' } matches by
    // substring, so it also hit the sidebar's always-visible "Save current session"
    // button (strict-mode violation). `exact: true` alone isn't enough either: the
    // inline rename controls on groups, windows and tabs are labelled exactly "Save".
    const noteEditor = page.getByPlaceholder('Add a note for this group…').locator('..');
    await noteEditor.locator('textarea').fill('Remember to update docs');
    await noteEditor.getByRole('button', { name: 'Save', exact: true }).click();

    // Save does not wait for its write: reload only once IndexedDB holds the note.
    await waitForStoredGroup(page, (g) => g.id === WORK_GROUP.id && g.note === 'Remember to update docs', 'the Work group note');
    await page.reload({ waitUntil: 'networkidle' });

    // Menu item changes to "Edit note" once a note exists
    await page.getByRole('button', { name: 'Work', exact: true }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByText('Edit note').click();

    await expect(page.locator('textarea')).toHaveValue('Remember to update docs');
  });
});
