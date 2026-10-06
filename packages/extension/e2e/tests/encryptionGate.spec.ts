import { test, expect } from '../fixtures';
import { E2E_PASSPHRASE, openPopup, seedAndReload, signInAsPro } from '../helpers';
import { NOW_OPEN } from '../seed';

// First-time encryption setup is offered only when the server ANSWERS that the account has no
// key. A check that fails (offline, 401, 5xx) is "unknown": no dialog, the popup stays usable.
test.describe('Encryption setup prompt (signed-in Pro user)', () => {
  test('a failed encryption check does not open "Set up encryption" and leaves the popup usable', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);
    await signInAsPro(page, 'error');

    const checked = page.waitForResponse('**/rest/v1/encryption_keys*');
    await page.reload({ waitUntil: 'networkidle' });
    await checked;
    await page.waitForTimeout(500); // the dialog used to open right after this response

    await expect(page.getByRole('dialog')).toHaveCount(0);
    // not hidden behind a modal: the header is still in the accessibility tree and clickable
    await page.locator('header').getByRole('button').last().click();
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  });

  test('an account the server reports as having no key is asked to set up encryption', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);
    await signInAsPro(page, 'none');

    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Set up encryption' })).toBeVisible();
  });

  // The passphrase is checked against the account's existing key, so unlocking asks for it once:
  // a confirmation field belongs to first-time setup only.
  test('a device that has not unlocked the account key asks for the passphrase once, with no confirmation', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);
    await signInAsPro(page, 'locked');

    await page.reload({ waitUntil: 'networkidle' });

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Unlock encryption' })).toBeVisible();
    await expect(dialog.getByPlaceholder('Confirm passphrase')).toHaveCount(0);
    const passphrase = dialog.getByPlaceholder('Passphrase', { exact: true });
    const unlock = dialog.getByRole('button', { name: 'Unlock', exact: true });
    await expect(unlock).toBeDisabled();

    await passphrase.fill('not-the-passphrase');
    await unlock.click();
    await expect(dialog.getByText('Wrong passphrase')).toBeVisible();

    await passphrase.fill(E2E_PASSPHRASE);
    await passphrase.press('Enter');
    await expect(page.getByText('Encryption unlocked')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unlock encryption' })).toHaveCount(0);
  });
});
