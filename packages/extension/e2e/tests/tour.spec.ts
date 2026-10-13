import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { TOUR_STORAGE_KEY, openPopup, seedAndReload, waitForRenameInputReady, waitForStoredGroup } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/** Reads the tour record from `chrome.storage.local` through the service worker. */
async function readTour(context: BrowserContext): Promise<unknown> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return sw.evaluate(async (key) => (await chrome.storage.local.get(key))[key], TOUR_STORAGE_KEY);
}

/** The install handler writes the flag asynchronously: opening the popup before it lands would see no record. */
async function waitForTour(context: BrowserContext, matches: (record: any) => boolean, what: string): Promise<void> {
  await expect.poll(async () => matches(await readTour(context)), { message: what, timeout: 10_000 }).toBe(true);
}

const dialog = (page: Page) => page.getByRole('dialog', { name: /./ }).filter({ has: page.getByText(/^Step \d+ of \d+$/) });
const title = async (page: Page) => (await dialog(page).getByRole('heading').textContent()) ?? '';

async function openSettingsGeneral(page: Page) {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
}

test.describe('Guided tour — first install', () => {
  test.use({ tour: 'pending' });

  test('the first popup open after install starts at step 1', async ({ context, extensionId }) => {
    await waitForTour(context, (r) => r?.status === 'pending', 'install marks the tour pending');
    const page = await openPopup(context, extensionId);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading')).toHaveText('Welcome to TabMerger');
    await expect(dialog(page).getByText(/^Step 1 of \d+$/)).toBeVisible();
    await expect(page.locator('#root > [inert]')).not.toHaveCount(0);
  });

  test('closing and reopening the popup resumes on the same step', async ({ context, extensionId }) => {
    await waitForTour(context, (r) => r?.status === 'pending', 'install marks the tour pending');
    const page = await openPopup(context, extensionId);
    await dialog(page).getByRole('button', { name: 'Next' }).click();
    await dialog(page).getByRole('button', { name: 'Next' }).click();
    const reached = await title(page);
    expect(reached).not.toBe('Welcome to TabMerger');
    await waitForTour(context, (r) => r?.status === 'pending' && typeof r.stepId === 'string' && r.stepId !== 'welcome', 'progress stored');
    await page.close();

    const again = await openPopup(context, extensionId);
    await expect(dialog(again)).toBeVisible();
    expect(await title(again)).toBe(reached);
  });

  test('Skip tour means it never starts by itself again', async ({ context, extensionId }) => {
    await waitForTour(context, (r) => r?.status === 'pending', 'install marks the tour pending');
    const page = await openPopup(context, extensionId);
    await dialog(page).getByRole('button', { name: 'Skip tour' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('#root > [inert]')).toHaveCount(0);
    await waitForTour(context, (r) => r?.status === 'done' && r.stepId === undefined, 'skip stored as done');
    await page.close();

    const again = await openPopup(context, extensionId);
    await again.waitForTimeout(500);
    await expect(dialog(again)).toHaveCount(0);
  });

  test('Escape skips, and it never starts by itself again', async ({ context, extensionId }) => {
    await waitForTour(context, (r) => r?.status === 'pending', 'install marks the tour pending');
    const page = await openPopup(context, extensionId);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await waitForTour(context, (r) => r?.status === 'done', 'escape stored as done');
    await page.close();

    const again = await openPopup(context, extensionId);
    await again.waitForTimeout(500);
    await expect(dialog(again)).toHaveCount(0);
  });

  test('finishing with Done means it never starts by itself again', async ({ context, extensionId }) => {
    await waitForTour(context, (r) => r?.status === 'pending', 'install marks the tour pending');
    const page = await openPopup(context, extensionId);
    await expect(dialog(page)).toBeVisible();
    // Interactive steps offer "Skip this step" where the others offer "Next"
    for (let i = 0; i < 40; i++) {
      const done = dialog(page).getByRole('button', { name: 'Done' });
      if (await done.isVisible()) break;
      const before = await title(page);
      await dialog(page).getByRole('button', { name: /^(Next|Skip this step)$/ }).click();
      await expect(dialog(page).getByRole('heading')).not.toHaveText(before);
    }
    await expect(dialog(page).getByRole('heading')).toHaveText('You are all set');
    // nothing was made along the way, so there is nothing to offer for removal
    await expect(dialog(page).getByRole('button', { name: 'Remove the practice group' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Done' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await waitForTour(context, (r) => r?.status === 'done', 'done stored');
    // focus goes back to the "?" button the last step pointed at
    await expect(page.getByRole('button', { name: 'Take the tour' })).toBeFocused();
    await page.close();

    const again = await openPopup(context, extensionId);
    await again.waitForTimeout(500);
    await expect(dialog(again)).toHaveCount(0);
  });
});

test.describe('Guided tour — replay and lock (tour already finished)', () => {
  test('the default fixture shows no tour', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await page.waitForTimeout(500);
    await expect(dialog(page)).toHaveCount(0);
    expect(await readTour(context)).toEqual({ status: 'done' });
  });

  test('the "?" button in the header replays the tour from step 1', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Take the tour' }).click();
    await expect(dialog(page).getByRole('heading')).toHaveText('Welcome to TabMerger');
    await expect(dialog(page).getByText(/^Step 1 of \d+$/)).toBeVisible();
  });

  test('Settings > General > Take the tour closes Settings and starts the tour', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await openSettingsGeneral(page);
    await expect(page.getByText('A quick walkthrough of TabMerger')).toBeVisible();
    await page.getByRole('button', { name: 'Start the tour' }).click();
    await expect(page.getByRole('tab', { name: /data/i })).toHaveCount(0);
    await expect(dialog(page).getByRole('heading')).toHaveText('Welcome to TabMerger');
  });

  test('the app underneath cannot be clicked or driven from the keyboard while the tour is up', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    const work = page.getByRole('button', { name: 'Work', exact: true });
    await expect(work).toBeVisible();
    await page.getByRole('button', { name: 'Take the tour' }).click();
    await expect(dialog(page)).toBeVisible();

    // A real mouse click on the group lands on the tour's backdrop
    const box = (await work.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText('Jira Board')).toHaveCount(0);

    // Up/Down do not reach the app's group navigation (the tour only reacts to Left/Right)
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByText('Jira Board')).toHaveCount(0);
    await expect(dialog(page).getByRole('heading')).toHaveText('Welcome to TabMerger');

    // Tab cannot leave the card
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-modal="true"]'))).toBe(true);
    }

    // Control: with the tour gone the same click works
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await work.click();
    await expect(page.getByText('Jira Board')).toBeVisible();
  });

  test('interactive steps: the user makes, colours and pins a group, searches and changes the theme, then removes the practice group', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await page.setViewportSize({ width: 800, height: 600 });
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await page.getByRole('button', { name: 'Take the tour' }).click();
    const card = page.locator('[data-tour-card]');
    const goTo = async (id: string) => {
      for (let i = 0; i < 40 && (await card.getAttribute('data-tour-card')) !== id; i++) {
        const before = await card.getAttribute('data-tour-card');
        await card.locator('button', { hasText: /^(Next|Skip this step)$/ }).click();
        await expect(card).not.toHaveAttribute('data-tour-card', before ?? '');
      }
      await expect(card).toHaveAttribute('data-tour-card', id);
    };
    const practice = page.locator('[data-sidebar-group-index]').filter({ hasText: 'Practice' });

    // Make a group: "Next" is not offered until it exists and has a name
    await goTo('make-group');
    await expect(card).toHaveAttribute('data-tour-task', 'todo');
    await expect(card.locator('button', { hasText: /^Next$/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add Group' }).click();
    await waitForRenameInputReady(page);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Practice');
    await page.keyboard.press('Enter');
    await expect(card).toHaveAttribute('data-tour-task', 'done');
    await expect(practice).toHaveCount(1);
    await waitForTour(context, (r) => r?.status === 'pending' && typeof r.practiceGroupId === 'string', 'practice group remembered');

    // Colour: only the practice group's dot works, and the step completes on the stored colour
    await goTo('group-colour');
    await expect(card).toHaveAttribute('data-tour-task', 'todo');
    const workBox = (await page.getByRole('button', { name: 'Work', exact: true }).boundingBox())!;
    await page.mouse.click(workBox.x + workBox.width / 2, workBox.y + workBox.height / 2);
    await expect(page.getByText('Jira Board')).toHaveCount(0);
    await practice.locator('[data-tour="group-color"]').click();
    const picker = page.locator('[data-tour="color-picker"]');
    await expect(picker).toBeVisible();
    // the ring goes around the row and the picker, fully inside the popup
    const ring = await page.locator('[data-tour-spotlight]').boundingBox();
    expect(ring!.x).toBeGreaterThanOrEqual(10);
    expect(ring!.y + ring!.height).toBeLessThanOrEqual(590);
    await picker.locator('button[title^="rgba"]').nth(4).click();
    await picker.getByRole('button', { name: 'Apply' }).click();
    await expect(card).toHaveAttribute('data-tour-task', 'done');

    // Pin
    await goTo('group-pin');
    await practice.locator('[data-tour="group-pin"]').click();
    await expect(card).toHaveAttribute('data-tour-task', 'done');
    await expect(practice.getByRole('button', { name: 'Unpin group' })).toHaveCount(1);

    // Search: typing completes it, leaving the step clears the search again
    await goTo('search');
    await page.locator('[data-tour="search"]').click();
    await page.keyboard.type('jira');
    await expect(card).toHaveAttribute('data-tour-task', 'done');
    await card.locator('button', { hasText: /^Next$/ }).click();
    await expect(page.locator('[data-tour="search-overlay"]')).toHaveCount(0);
    await expect(page.locator('[data-tour="search"]')).toContainText('Search tabs and groups');

    // Theme: Escape in the menu closes the menu, not the tour; only "Settings" works in it
    await goTo('theme');
    await page.locator('[data-tour="account-menu"]').click();
    await expect(page.locator('[data-tour="account-menu-content"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-tour="account-menu-content"]')).toHaveCount(0);
    await expect(card).toHaveAttribute('data-tour-card', 'theme');
    await page.locator('[data-tour="account-menu"]').click();
    await expect(page.locator('[data-tour="account-menu-content"] [inert]')).not.toHaveCount(0);
    await page.locator('[data-tour="menu-settings"]').click();
    const settings = page.locator('[role="dialog"]:not([data-tour-card])');
    await expect(settings).toBeVisible();
    // the rest of Settings is locked: the Data tab is inert (Playwright's role query does not skip inert)
    expect(await settings.getByRole('tab', { name: 'Data' }).evaluate((el) => !!el.closest('[inert]'))).toBe(true);
    await settings.locator('[data-tour="settings-theme"]').getByRole('combobox').click();
    await page.getByRole('option', { name: 'Dark' }).click();
    await settings.getByRole('button', { name: 'Save changes' }).click();
    await expect(card).toHaveAttribute('data-tour-task', 'done');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await card.locator('button', { hasText: /^Next$/ }).click();
    await expect(settings).toHaveCount(0);

    // The end: the practice group is offered for removal, and only it goes
    await goTo('finish');
    await card.getByRole('button', { name: 'Remove the practice group' }).click();
    await expect(practice).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Work', exact: true })).toHaveCount(1);
    await card.getByRole('button', { name: 'Done' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('[inert]')).toHaveCount(0);
    await waitForTour(context, (r) => r?.status === 'done' && r.practiceGroupId === undefined, 'done, no practice group left');
  });

  test('an interactive step survives the popup closing, and a skipped tour offers to remove the practice group', async ({ context, extensionId }) => {
    let page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await page.getByRole('button', { name: 'Take the tour' }).click();
    const cardOf = (p: Page) => p.locator('[data-tour-card]');
    for (let i = 0; i < 10 && (await cardOf(page).getAttribute('data-tour-card')) !== 'make-group'; i++) {
      await cardOf(page).locator('button', { hasText: /^Next$/ }).click();
    }
    await page.getByRole('button', { name: 'Add Group' }).click();
    await waitForRenameInputReady(page);
    // Escape in the name field cancels the new group. It does not skip the tour.
    await page.keyboard.press('Escape');
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'todo');
    await expect(page.locator('[data-sidebar-group-index]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Add Group' }).click();
    await waitForRenameInputReady(page);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Practice');
    await page.keyboard.press('Enter');
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await cardOf(page).locator('button', { hasText: /^Next$/ }).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'group-colour');
    await waitForTour(context, (r) => r?.stepId === 'group-colour' && typeof r.practiceGroupId === 'string', 'progress stored');
    await waitForStoredGroup(page, (g) => g.name === 'Practice', 'practice group written');
    await page.close();

    page = await openPopup(context, extensionId);
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'group-colour');
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'todo');

    await cardOf(page).getByRole('button', { name: 'Skip tour' }).click();
    await expect(cardOf(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove it' }).click();
    await expect(page.locator('[data-sidebar-group-index]').filter({ hasText: 'Practice' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Work', exact: true })).toHaveCount(1);
  });

  test('at the free group limit the group steps are shown, not tried', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    const five = [1, 2, 3, 4, 5].map((i) => ({ ...WORK_GROUP, id: `limit-${i}`, name: `Group ${i}` }));
    await seedAndReload(page, [NOW_OPEN, ...five]);
    await page.getByRole('button', { name: 'Take the tour' }).click();
    const card = page.locator('[data-tour-card]');
    for (const id of ['make-group', 'group-colour', 'group-pin']) {
      for (let i = 0; i < 10 && (await card.getAttribute('data-tour-card')) !== id; i++) {
        await card.locator('button', { hasText: /^Next$/ }).click();
      }
      await expect(card).toHaveAttribute('data-tour-card', id);
      await expect(card).toHaveAttribute('data-tour-task', 'none');
    }
    await expect(page.locator('[data-sidebar-group-index]')).toHaveCount(6);
    await card.getByRole('button', { name: 'Skip chapter' }).click();
    await expect(card).toHaveAttribute('data-tour-card', 'save-tabs');
  });

  test('a tour step has no serious or critical accessibility violations', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await page.getByRole('button', { name: 'Take the tour' }).click();
    await expect(dialog(page)).toBeVisible();

    for (let step = 0; step < 2; step++) {
      // nested-interactive is the app's known pre-existing pattern, see a11y.spec.ts
      const results = await new AxeBuilder({ page }).disableRules(['nested-interactive']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
      await dialog(page).getByRole('button', { name: 'Next' }).click();
    }
  });
});
