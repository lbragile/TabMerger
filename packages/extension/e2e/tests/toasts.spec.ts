import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN } from '../seed';

/**
 * Regression coverage for the "toast doesn't dismiss when I click on it" bug.
 *
 * Root cause: Radix Dialog sets `pointer-events: none` directly on <body> while any modal
 * (e.g. Settings) is open, as its own outside-interaction guard. Sonner's <Toaster> portals
 * to <body> too — a sibling of the dialog, not a descendant — and never sets
 * `pointer-events: auto` anywhere in its own injected stylesheet. With nothing overriding
 * that inherited `none`, every toast fired *while a modal is open* (which covers most real
 * toast call sites: Settings Save, Auth, Import/Export, encryption setup…) rendered
 * visually but was fully unclickable — neither the × close button nor an action button could
 * dismiss it. Fixed with `[data-sonner-toaster] { pointer-events: auto !important; }` in
 * globals.css.
 */
test.describe('Toast dismissal', () => {
  test('a plain toast dismisses via its close button', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);

    // Windows panel → "More group options" menu → "Deduplicate tabs" fires
    // toast.info('No duplicates found') with no modal open — the baseline case that already
    // worked before this fix (Now Open has no duplicate tabs by default).
    await page.getByRole('button', { name: 'More group options' }).click();
    await page.getByRole('menuitem', { name: /deduplicate tabs/i }).click();

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'No duplicates found' });
    await expect(toast).toBeVisible();

    await toast.getByRole('button', { name: /close toast/i }).click();
    await expect(toast).toHaveCount(0);
  });

  test('a toast fired from inside an open modal (Settings Save) dismisses via its close button', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);

    await page.locator('header').getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    // Dirty the draft so "Save changes" is enabled, then save while the dialog stays open —
    // Settings.tsx's handleSave() never calls onClose().
    await page.getByRole('switch').first().click();
    await page.getByRole('button', { name: 'Save changes' }).click();

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Settings saved' });
    await expect(toast).toBeVisible();
    // The modal must still be open — this is exactly the scenario that was unclickable.
    await expect(page.getByRole('dialog')).toBeVisible();

    // Dirty the draft again (a second, still-unsaved switch flip) *before* touching the
    // toast, so a false-positive "dialog still open" isn't masking a lost draft — Radix's
    // DismissableLayer treats a click on the toast (outside DialogContent) as an
    // outside-interaction and would unmount+remount SettingsModal, resetting `draft` back
    // to `saved` and silently discarding this flip.
    const secondSwitch = page.getByRole('switch').nth(1);
    const wasChecked = await secondSwitch.getAttribute('aria-checked');
    await secondSwitch.click();

    await toast.getByRole('button', { name: /close toast/i }).click();
    await expect(toast).toHaveCount(0);

    // The dialog must still be the SAME live instance — not dismissed-then-nothing, and not
    // dismissed-and-silently-reopened with the draft reset.
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(secondSwitch).not.toHaveAttribute('aria-checked', wasChecked ?? 'false');
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    // Keyboard/focus semantics must survive too: the dialog's own focus trap should still be
    // intact (Escape closes the dialog, not something else; a stray outside-interaction that
    // silently swallowed focus would leave Escape doing nothing observable).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('an action-button toast fired before a modal opens does not get dismissed by the modal opening, and clicking it afterward does not close the modal', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    // Free plan caps at 5 non-permanent groups — hit the cap from the sidebar (no modal open
    // yet) to get an action-button toast, then open Settings *while the toast is still up*
    // (sonner's default 4s lifetime is plenty of time). This reproduces the real risk: once
    // the toaster is clickable (this bug's fix), a click on ITS action button must not read
    // as an outside-interaction on whatever dialog happens to be open at the time.
    const groups = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, name: `Group ${i}` }));
    await seedAndReload(page, [NOW_OPEN, ...groups]);

    await page.getByRole('button', { name: 'Add Group' }).click();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: /allows up to 5 groups/i });
    await expect(toast).toBeVisible();

    await page.locator('header').getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Opening the dialog must not have torn down the still-live toast either.
    await expect(toast).toBeVisible();

    const actionBtn = toast.getByRole('button', { name: 'Upgrade' });
    await actionBtn.click();
    await expect(toast).toHaveCount(0);
    // The Settings dialog the user was reading must still be there.
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('an action-button toast (Upgrade, free-tier group cap) dismisses on action click', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    // Free plan caps at 5 non-permanent groups (FREE_TIER_LIMITS.maxGroups) — seed straight
    // at the cap so "Add Group" hits SidePanel's warnGroupLimit() immediately, no modal
    // involved. This exercises hypothesis (4): the action button's onClick must not call
    // preventDefault(), or sonner would skip its own post-click auto-dismiss.
    const groups = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, name: `Group ${i}` }));
    await seedAndReload(page, [NOW_OPEN, ...groups]);

    await page.getByRole('button', { name: 'Add Group' }).click();

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: /allows up to 5 groups/i });
    await expect(toast).toBeVisible();

    const actionBtn = toast.getByRole('button', { name: 'Upgrade' });
    await actionBtn.click();
    await expect(toast).toHaveCount(0);
  });
});
