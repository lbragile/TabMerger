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

/**
 * Regression coverage for the countdown bar jumping ABOVE a hovered toast.
 *
 * Root cause: globals.css draws the countdown bar on `[data-sonner-toast]::after`, and sonner's
 * own stylesheet uses the same pseudo-element as its hover gap filler
 * (`[data-expanded='true']::after { bottom: 100%; height: var(--gap) }`). Sonner's sheet loads
 * later at equal specificity, so on hover the paused bar moved into the gap above the toast.
 * Fixed by scoping the bar rules under `[data-sonner-toaster]` and moving the gap filler to
 * ::before.
 */
test.describe('Toast countdown bar', () => {
  test('stays on the bottom edge while hovered, and stacked toasts stay expanded across the gap', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const groups = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, name: `Group ${i}` }));
    await seedAndReload(page, [NOW_OPEN, ...groups]);

    // Two stacked toasts (the free-tier group cap toast, fired twice).
    const addGroup = page.getByRole('button', { name: 'Add Group' });
    await addGroup.click();
    await addGroup.click();
    const toasts = page.locator('[data-sonner-toast]');
    await expect(toasts).toHaveCount(2);

    const front = page.locator('[data-sonner-toast][data-front="true"]');
    await front.hover();
    await expect(front).toHaveAttribute('data-expanded', 'true');

    const after = await front.evaluate((el) => {
      const cs = getComputedStyle(el, '::after');
      return { bottom: cs.bottom, top: cs.top, height: cs.height, playState: cs.animationPlayState };
    });
    expect(after.bottom).toBe('0px');
    expect(after.height).toBe('3px');
    expect(after.top).not.toMatch(/^-/);
    expect(after.playState).toBe('paused');

    // The gap filler now lives on ::before and spans the gap above the toast.
    const before = await front.evaluate((el) => {
      const cs = getComputedStyle(el, '::before');
      return { content: cs.content, bottom: cs.bottom };
    });
    expect(before.content).toBe('""');
    expect(before.bottom).not.toBe('0px');

    // Move the pointer into the gap between the two expanded toasts: the stack must not collapse.
    const back = page.locator('[data-sonner-toast][data-front="false"]');
    // Sonner animates the stack open (~400ms), so wait for a real gap before measuring.
    const gapBetween = async () => {
      const f = (await front.boundingBox())!;
      const b = (await back.boundingBox())!;
      return f.y - (b.y + b.height);
    };
    await expect.poll(gapBetween).toBeGreaterThan(2);
    await page.waitForTimeout(500);
    const frontBox = (await front.boundingBox())!;
    const backBox = (await back.boundingBox())!;
    const gapY = (backBox.y + backBox.height + frontBox.y) / 2;
    await page.mouse.move(frontBox.x + frontBox.width / 2, gapY, { steps: 4 });
    await page.waitForTimeout(150);
    await expect(front).toHaveAttribute('data-expanded', 'true');
    await expect(back).toHaveAttribute('data-expanded', 'true');
  });
});
