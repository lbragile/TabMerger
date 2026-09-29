import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

test.describe('Group colour picker', () => {
  test('typing a hex live-previews the sidebar dot before Apply, and Apply persists it', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    const workRow = page.locator('[data-sidebar-group-index="1"]');
    const swatch = workRow.getByRole('button', { name: 'Change group color' });
    // Opens straight into the picker: no separate "Custom colour" step.
    await swatch.click();

    const hexInput = page.getByPlaceholder('#rrggbb');
    await hexInput.fill('#112233');

    // Live preview: the sidebar dot updates BEFORE Apply is clicked.
    await expect(swatch).toHaveCSS('background-color', 'rgb(17, 34, 51)');

    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(swatch).toHaveCSS('background-color', 'rgb(17, 34, 51)');

    // Persisted — survives a reopen (reload re-reads from IndexedDB).
    await page.reload({ waitUntil: 'networkidle' });
    const swatchAfterReload = page
      .locator('[data-sidebar-group-index="1"]')
      .getByRole('button', { name: 'Change group color' });
    await expect(swatchAfterReload).toHaveCSS('background-color', 'rgb(17, 34, 51)');
  });

  test('the preset swatches live in the picker: clicking one previews it, Apply persists it', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    const swatch = page.locator('[data-sidebar-group-index="1"]').getByRole('button', { name: 'Change group color' });
    await swatch.click();

    // Same panel as the saturation/hue picker, no mode switch.
    await expect(page.locator('.react-colorful__saturation')).toHaveCount(1);
    const preset = page.locator('button[title^="rgba("]').nth(3);
    const presetColor = await preset.evaluate((el) => getComputedStyle(el).backgroundColor);
    await preset.click();

    // Loaded into the draft, previewed on the sidebar dot, picker still open for fine-tuning.
    await expect(preset).toHaveAttribute('aria-pressed', 'true');
    await expect(swatch).toHaveCSS('background-color', presetColor);
    await expect(page.getByPlaceholder('#rrggbb')).toBeVisible();

    await page.getByRole('button', { name: 'Apply' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(
      page.locator('[data-sidebar-group-index="1"]').getByRole('button', { name: 'Change group color' })
    ).toHaveCSS('background-color', presetColor);
  });

  test('has no alpha slider — only saturation + hue — and the hex field is 6-digit only', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    const workRow = page.locator('[data-sidebar-group-index="1"]');
    const swatch = workRow.getByRole('button', { name: 'Change group color' });
    await swatch.click();

    // No alpha slider — only the saturation area + hue slider (react-colorful's own
    // `.react-colorful__alpha` class is only rendered by the *Alpha/Rgba/Hsla/Hsva pickers,
    // which this picker deliberately does not use).
    await expect(page.locator('.react-colorful__alpha')).toHaveCount(0);
    await expect(page.locator('.react-colorful__saturation')).toHaveCount(1);
    await expect(page.locator('.react-colorful__hue')).toHaveCount(1);

    // Typing an 8-digit (alpha) hex is truncated to 6 digits by HexColorInput (no `alpha`
    // prop) rather than accepted — the resulting colour is always opaque.
    const hexInput = page.getByPlaceholder('#rrggbb');
    await hexInput.fill('#6900ffa1');
    await expect(hexInput).toHaveValue(/^#[0-9a-f]{6}$/i);
    const previewColor = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(previewColor.startsWith('rgba')).toBe(false);
  });

  test('Cancel reverts the live preview and does not persist', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    const workRow = page.locator('[data-sidebar-group-index="1"]');
    const swatch = workRow.getByRole('button', { name: 'Change group color' });
    const originalColor = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);

    await swatch.click();
    await page.getByPlaceholder('#rrggbb').fill('#ff00ff');
    await expect(swatch).toHaveCSS('background-color', 'rgb(255, 0, 255)');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(swatch).toHaveCSS('background-color', originalColor);

    // Never persisted — still the original colour after a reload.
    await page.reload({ waitUntil: 'networkidle' });
    const swatchAfterReload = page
      .locator('[data-sidebar-group-index="1"]')
      .getByRole('button', { name: 'Change group color' });
    await expect(swatchAfterReload).toHaveCSS('background-color', originalColor);
  });

  test('the colour picker popover does not close the Add Group dialog (opened via "Create new group…")', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work', exact: true }).click();
    const tabRow = page.getByRole('listitem', { name: 'Jira Board' });
    await tabRow.click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Move to group' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Create new group…' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Color' }).click();
    // The picker renders in a portal, outside the dialog's DOM subtree.
    await page.getByPlaceholder('#rrggbb').fill('#654321');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog.getByRole('button', { name: 'Color' })).toContainText('#654321');

    // Dialog is still open and usable after the nested popup interaction.
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /create/i }).click();
    await expect(dialog).not.toBeVisible();
  });
  test('dragging the saturation area and hue slider live-previews without any page error (no update-depth loop)', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // Seeded tabs' favicons 404 offline — a network miss, not a script error
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(msg.text());
    });
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    const swatch = page.locator('[data-sidebar-group-index="1"]').getByRole('button', { name: 'Change group color' });
    const before = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
    await swatch.click();

    // Drag across each react-colorful surface in several steps, like a real pointer drag.
    for (const selector of ['.react-colorful__saturation', '.react-colorful__hue']) {
      const box = await page.locator(selector).boundingBox();
      if (!box) throw new Error(`${selector} not rendered`);
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + 2, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 3, { steps: 12 });
      await page.mouse.up();
    }

    // The sidebar dot previews the dragged colour before Apply…
    await expect.poll(() => swatch.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
    // …and Cancel puts it back.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => swatch.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(before);

    expect(errors).toEqual([]);
  });
});
