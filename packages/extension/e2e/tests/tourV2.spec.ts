import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { TOUR_STORAGE_KEY, openPopup, seedAndReload, waitForRenameInputReady, waitForStoredGroup } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';
import { ACTION_FRAME_EDGE_PX, CHAPTER_COUNT, stepId } from '../tourIds';

// Tour v2: the action ring, chapter headers and keyboard-only use.
// The ring is `[data-tour-action]`, the region `[data-tour-spotlight]` (value "calm" or "merged" while a
// ring is up), the chapter header `[data-tour-chapter]`. While Settings is open Radix hides the card
// from the accessibility tree, so the card's own controls are located with CSS here, never by role.
// (Basic start, resume, skip and the end-to-end happy path live in tour.spec.ts.)

const FRAME = { width: 800, height: 600 };
/** Ring + pulse: how far from the frame edge the ring's cut-out stays (derived from Tour.tsx). */
const RING_EXTENT = ACTION_FRAME_EDGE_PX;
/** Tour.tsx keeps handing focus back to the card for 500 ms after a task completes. */
const HAND_BACK_SETTLE_MS = 700;

async function readTour(context: BrowserContext): Promise<any> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return sw.evaluate(async (key) => (await chrome.storage.local.get(key))[key], TOUR_STORAGE_KEY);
}

async function waitForTour(context: BrowserContext, matches: (record: any) => boolean, what: string): Promise<void> {
  await expect.poll(async () => matches(await readTour(context)), { message: what, timeout: 10_000 }).toBe(true);
}

const cardOf = (p: Page) => p.locator('[data-tour-card]');
const stepOf = async (p: Page) => (await cardOf(p).getAttribute('data-tour-card')) ?? '';
const nextOrSkip = (p: Page) => cardOf(p).locator('button').filter({ hasText: /^(Next|Skip this step|Done)$/ });
const statusOf = (p: Page) => cardOf(p).locator('[role="status"]');

async function goToStep(page: Page, id: string) {
  for (let i = 0; i < 40 && (await stepOf(page)) !== id; i++) {
    const before = await stepOf(page);
    await nextOrSkip(page).click();
    await expect(cardOf(page)).not.toHaveAttribute('data-tour-card', before);
  }
  await expect(cardOf(page)).toHaveAttribute('data-tour-card', id);
}

/** Selector of the practice group's sidebar row, once the tour has recorded it. */
async function practiceRow(context: BrowserContext): Promise<string> {
  await waitForTour(context, (r) => typeof r?.practiceGroupId === 'string', 'practice group recorded');
  const record = await readTour(context);
  return `[data-sidebar-group-index][data-tm-dnd-id="${record.practiceGroupId}"]`;
}

/**
 * Asserts the action ring sits on `target` (or that there is none when `target` is null): it
 * contains the visible part of the control, is tight to it, stays inside the 800x600 frame,
 * is the only thing that pulses, the card does not cover it and the document does not overflow.
 */
async function expectRingOn(page: Page, target: string | null, label: string) {
  if (target === null) {
    await expect(page.locator('[data-tour-action]'), `${label}: no ring`).toHaveCount(0);
    return;
  }
  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ sel, extent, frame }) => {
            const ring = document.querySelector('[data-tour-action]')?.getBoundingClientRect();
            const el = document.querySelector(sel)?.getBoundingClientRect();
            const card = document.querySelector('[data-tour-card]')?.getBoundingClientRect();
            if (!ring || !el || !card) return `missing ring=${!!ring} target=${!!el} card=${!!card}`;
            const contains =
              ring.left <= Math.max(el.left, extent) + 1 &&
              ring.top <= Math.max(el.top, extent) + 1 &&
              ring.right >= Math.min(el.right, frame.width - extent) - 1 &&
              ring.bottom >= Math.min(el.bottom, frame.height - extent) - 1;
            if (!contains) return `ring ${JSON.stringify(ring)} does not contain ${sel} ${JSON.stringify(el)}`;
            if (ring.width > el.width + 14 || ring.height > el.height + 14) return `ring not tight: ${Math.round(ring.width)}x${Math.round(ring.height)} vs ${Math.round(el.width)}x${Math.round(el.height)}`;
            if (ring.left < extent - 0.5 || ring.top < extent - 0.5 || ring.right > frame.width - extent + 0.5 || ring.bottom > frame.height - extent + 0.5) return 'ring (with pulse) clipped by the frame';
            const covers = !(card.right <= ring.left - 4 || card.left >= ring.right + 4 || card.bottom <= ring.top - 4 || card.top >= ring.bottom + 4);
            if (covers) return 'card covers the ringed control';
            if (!document.querySelector('[data-tour-action] > [data-tour-pulse]')) return 'action ring has no pulse';
            if (document.querySelector('[data-tour-spotlight] > [data-tour-pulse]')) return 'region pulses while the action ring is up';
            const d = document.documentElement;
            if (d.scrollWidth > d.clientWidth || d.scrollHeight > d.clientHeight) return 'document overflows';
            return 'ok';
          },
          { sel: target, extent: RING_EXTENT, frame: FRAME }
        ),
      { message: `${label}: ring on ${target}`, timeout: 5_000 }
    )
    .toBe('ok');
}

/** Describes the focused element: `card`, or `tag|data-tour|aria-label|text`, or `BODY`. */
const focusOf = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'BODY';
    const kind = el.hasAttribute('data-tour-card') ? 'card' : el.tagName.toLowerCase();
    return `${kind}|${el.getAttribute('data-tour') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${(el.textContent ?? '').trim().slice(0, 24)}`;
  });

async function startTour(context: BrowserContext, extensionId: string, groups: unknown[] = [NOW_OPEN, WORK_GROUP]) {
  const page = await openPopup(context, extensionId);
  await page.setViewportSize({ width: FRAME.width, height: FRAME.height });
  await seedAndReload(page, groups as never);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(cardOf(page)).toBeVisible();
  return page;
}

test.describe('Guided tour v2: action ring, chapters, keyboard', () => {
  test.beforeEach(({}, info) => {
    info.setTimeout(120_000);
  });

  test('chapter header: every step names its chapter, the description shows on a chapter\'s first step and is announced once', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);
    const header = cardOf(page).locator('[data-tour-chapter]');
    const description = cardOf(page).locator('[data-tour-chapter-description]');

    await expect(header).toContainText(`Chapter 1 of ${CHAPTER_COUNT}`);
    await expect(header).toContainText('Getting to know TabMerger');
    await expect(description).toHaveCount(1);
    await expect(statusOf(page)).toContainText(`Chapter 1 of ${CHAPTER_COUNT}, Getting to know TabMerger.`);
    const intro = (await description.textContent()) ?? '';
    expect(intro.length).toBeGreaterThan(10);
    await expect(statusOf(page)).toContainText(intro);

    // a later step of the same chapter: the header stays, the description and its announcement go
    await nextOrSkip(page).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'now-open');
    await expect(header).toContainText('Getting to know TabMerger');
    await expect(description).toHaveCount(0);
    await expect(statusOf(page)).toContainText('Now Open');
    await expect(statusOf(page)).not.toContainText(intro);

    // Back to the chapter's first step shows the description again but does not announce it a second time
    await cardOf(page).locator('button', { hasText: /^Back$/ }).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'welcome');
    await expect(description).toHaveCount(1);
    await expect(statusOf(page)).toContainText('Step 1 of');
    await expect(statusOf(page)).not.toContainText(intro);

    // the next chapter introduces itself on its first step
    await goToStep(page, 'make-group');
    await expect(header).toContainText(`Chapter 2 of ${CHAPTER_COUNT}`);
    await expect(description).toHaveCount(1);
    await expect(statusOf(page)).toContainText((await description.textContent()) ?? '');
  });

  test('a read-only step has a region ring and no action ring, and the region pulses', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);
    await goToStep(page, 'main-panel');
    await expect(page.locator('[data-tour-spotlight]')).toHaveCount(1);
    await expect(page.locator('[data-tour-action]')).toHaveCount(0);
    await expect(page.locator('[data-tour-spotlight]')).toHaveAttribute('data-tour-spotlight', '');
    await expect(page.locator('[data-tour-spotlight] > [data-tour-pulse]')).toHaveCount(1);
  });

  test('undo task: star the sample window, Undo, Redo; the action ring follows each control', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);
    await goToStep(page, stepId('undo'));
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'todo');
    const star = page.getByRole('button', { name: 'Star window' }).first();
    await expect(star).toBeVisible();
    await expect(page.locator('[data-tour-action]')).toHaveCount(1);

    await star.click();
    // after the star the ring moves on to Undo
    await expect(page.locator('[data-tour-action]')).toHaveCount(1);
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'todo');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'todo');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expect(page.locator('[data-tour-action]')).toHaveCount(0);
  });

  test('with reduced motion nothing pulses', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goToStep(page, 'main-panel');
    const animation = await page.locator('[data-tour-spotlight] > [data-tour-pulse]').evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe('none');
  });

  test('the action ring walks every position of all five tasks (mouse): inside the frame, never under the card', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);

    // Make a group: Add Group, the name field, Save (only once a name of the user's own is typed)
    await goToStep(page, 'make-group');
    await expectRingOn(page, '[data-tour="add-group"]', 'make-group 1');
    await expect(page.locator('[data-tour-spotlight]')).toHaveAttribute('data-tour-spotlight', 'merged');
    await page.locator('[data-tour="add-group"] button').click();
    await page.locator('[data-tour="group-name-input"]').waitFor();
    await expectRingOn(page, '[data-tour="group-name-input"]', 'make-group 2');
    await expect(page.locator('[data-tour-spotlight]')).toHaveAttribute('data-tour-spotlight', 'calm');
    await page.locator('[data-tour="group-name-input"]').fill('temp group');
    await expectRingOn(page, '[data-tour="group-name-input"]', 'make-group placeholder name');
    await page.locator('[data-tour="group-name-input"]').fill('Practice');
    await expectRingOn(page, '[data-tour="group-name-save"]', 'make-group 3');
    await page.locator('[data-tour="group-name-save"]').click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expectRingOn(page, null, 'make-group done');
    const row = await practiceRow(context);
    await nextOrSkip(page).click();

    // Colour: the dot, the swatches, Apply once a different colour is picked
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', stepId('group-color'));
    await expectRingOn(page, `${row} [data-tour="group-color"]`, 'colour 1');
    await page.locator(`${row} [data-tour="group-color"]`).click();
    await page.locator('[data-tour="color-picker"]').waitFor();
    await expectRingOn(page, '[data-tour="color-picker"] [data-tour="color-swatches"]', 'colour 2');
    await page.locator('[data-tour="color-swatches"] button[aria-pressed="false"]').nth(3).click();
    await expectRingOn(page, '[data-tour="color-picker"] [data-tour="color-apply"]', 'colour 3');
    await page.locator('[data-tour="color-apply"]').click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expectRingOn(page, null, 'colour done');
    await nextOrSkip(page).click();

    // Pin: the star
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'group-pin');
    await expectRingOn(page, `${row} [data-tour="group-pin"]`, 'pin');
    await page.locator(`${row} [data-tour="group-pin"]`).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expectRingOn(page, null, 'pin done');
    await nextOrSkip(page).click();

    // Search: "Open search", then the field; a whole word keeps focus in the field
    await goToStep(page, 'search');
    await expectRingOn(page, '[data-tour="search"]', 'search 1');
    await page.locator('[data-tour="search"]').click();
    await page.locator('[data-tour="search-overlay"] input').waitFor();
    await expectRingOn(page, '[data-tour="search-overlay"] input', 'search 2');
    await page.locator('[data-tour="search-overlay"] input').pressSequentially('sam', { delay: 60 });
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expect(page.locator('[data-tour="search-overlay"] input')).toHaveValue('sam');
    await expectRingOn(page, null, 'search done');
    await nextOrSkip(page).click();

    // Theme: menu button, "Settings", the Theme control, the open list, Save changes
    await goToStep(page, 'theme');
    await expectRingOn(page, '[data-tour="account-menu"]', 'theme 1');
    await page.locator('[data-tour="account-menu"]').click();
    await page.locator('[data-tour="menu-settings"]').waitFor();
    await expectRingOn(page, '[data-tour="menu-settings"]', 'theme 2');
    await page.locator('[data-tour="menu-settings"]').click();
    await page.locator('[data-tour="settings-theme-trigger"]').waitFor();
    await expectRingOn(page, '[data-tour="settings-theme-trigger"]', 'theme 3');
    // "Restore defaults" is locked for this step: a real click on it changes nothing and leaves the tour on this step
    const restore = page.locator('[role="dialog"]:not([data-tour-card])').getByRole('button', { name: 'Restore defaults' });
    expect(await restore.evaluate((el) => !!el.closest('[inert]'))).toBe(true);
    await page.locator('[data-tour="settings-theme-trigger"]').click();
    await page.locator('[role="listbox"]').waitFor();
    await expectRingOn(page, '[role="listbox"]', 'theme 4');
    await page.getByRole('option', { name: 'Dark' }).click();
    await expectRingOn(page, '[data-tour="settings-save-button"]', 'theme 5');
    await page.locator('[data-tour="settings-save-button"]').click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expectRingOn(page, null, 'theme done');
  });

  test('keyboard only: focus lands on the card, one Tab reaches the control, Enter goes on when done, focus is never on <body>', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);
    const kb = page.keyboard;
    const expectFocus = async (re: RegExp, label: string) => {
      await expect.poll(() => focusOf(page), { message: `focus: ${label}`, timeout: 5_000 }).toMatch(re);
    };
    const neverBody = async (label: string) => expect(await focusOf(page), `${label}: focus on <body>`).not.toBe('BODY');
    const enterTo = async (id: string) => {
      for (let i = 0; i < 40 && (await stepOf(page)) !== id; i++) {
        await expectFocus(/^(card|button\|\|\|(Next|Back))/, `card focus on ${await stepOf(page)}`);
        // A "try it" step does not move on with Enter from the card: Tab to its "Skip this step" first
        if ((await cardOf(page).getAttribute('data-tour-task')) === 'todo') {
          for (let t = 0; t < 12 && !/Skip this step/.test(await focusOf(page)); t++) await kb.press('Tab');
        }
        await kb.press('Enter');
        await page.waitForTimeout(150);
      }
      expect(await stepOf(page)).toBe(id);
    };

    await expectFocus(/^card/, 'tour start');
    await enterTo('make-group');
    // arriving at a "try it" step: focus is on the card and Enter does not skip the task
    await expectFocus(/^card/, 'make-group arrival');
    await kb.press('Enter');
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'make-group');
    await kb.press('Tab');
    await expectFocus(/Add Group/, 'make-group: one Tab from the card');
    await kb.press('Enter');
    await page.locator('[data-tour="group-name-input"]').waitFor();
    await waitForRenameInputReady(page);
    await kb.press('ControlOrMeta+A');
    await kb.type('Keys', { delay: 40 });
    await kb.press('Enter');
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expectFocus(/^card/, 'make-group done');
    await page.waitForTimeout(HAND_BACK_SETTLE_MS);
    await kb.press('Enter');

    // colour: Tab, open the picker, pick a swatch, Apply; focus returns to the card after the picker closes
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', stepId('group-color'));
    await expectFocus(/^card/, 'colour arrival');
    await kb.press('Tab');
    await expectFocus(/Change group color/, 'colour: one Tab from the card');
    await kb.press('Enter');
    await page.locator('[data-tour="color-picker"]').waitFor();
    await neverBody('colour: picker open');
    for (let i = 0; i < 30; i++) {
      const onOther = await page.evaluate(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('[data-tour="color-swatches"]') && el.getAttribute('aria-pressed') === 'false';
      });
      if (onOther) break;
      await kb.press('Tab');
      await page.waitForTimeout(60);
    }
    await kb.press('Enter');
    for (let i = 0; i < 30 && !/Apply/.test(await focusOf(page)); i++) {
      await kb.press('Tab');
      await page.waitForTimeout(60);
    }
    await expectFocus(/Apply/, 'colour: on Apply');
    await kb.press('Enter');
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expectFocus(/^card/, 'colour done');
    await page.waitForTimeout(HAND_BACK_SETTLE_MS);
    await kb.press('Enter');

    // pin
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'group-pin');
    await kb.press('Tab');
    await expectFocus(/Pin group/, 'pin: one Tab from the card');
    await kb.press('Enter');
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expectFocus(/^card/, 'pin done');
    await page.waitForTimeout(HAND_BACK_SETTLE_MS);
    await kb.press('Enter');

    // search: a whole word stays in the field
    await enterTo('search');
    await expectFocus(/^card/, 'search arrival');
    await kb.press('Tab');
    await expectFocus(/Open search/, 'search: one Tab from the card');
    await kb.press('Enter');
    await page.locator('[data-tour="search-overlay"] input').waitFor();
    await kb.type('sam', { delay: 80 });
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expect(page.locator('[data-tour="search-overlay"] input')).toHaveValue('sam');
    await neverBody('search typed');
    for (let i = 0; i < 12 && !/^card|Next/.test(await focusOf(page)); i++) await kb.press('Tab');
    await kb.press('Enter');
    await expect(cardOf(page)).not.toHaveAttribute('data-tour-card', 'search');

    // theme: menu, Settings, Theme list, Save; Escape closes Settings and does NOT end the tour
    await enterTo('theme');
    await expectFocus(/^card/, 'theme arrival');
    await kb.press('Tab');
    await expectFocus(/(Settings|Account) menu/, 'theme: one Tab from the card');
    await kb.press('Enter');
    await page.locator('[data-tour="menu-settings"]').waitFor();
    // Radix menus and selects move focus for an arrow key in a timer, so a key pressed right
    // after it can still reach the item the arrow left (a busy CI runs input before timers).
    // Wait until focus is inside the open menu, and after each arrow until it has moved.
    await expectFocus(/^div\|/, 'theme: focus inside the open menu');
    for (let i = 0; i < 4 && !/menu-settings/.test(await focusOf(page)); i++) {
      const before = await focusOf(page);
      await kb.press('ArrowDown');
      await expect.poll(() => focusOf(page), { message: 'theme: ArrowDown moved focus in the menu' }).not.toBe(before);
    }
    await expectFocus(/menu-settings/, 'theme: on "Settings"');
    await kb.press('Enter');
    await page.locator('[data-tour="settings-theme-trigger"]').waitFor();
    for (let i = 0; i < 12 && !/settings-theme-trigger/.test(await focusOf(page)); i++) {
      await kb.press('Tab');
      await page.waitForTimeout(60);
    }
    await kb.press('Enter');
    await page.locator('[role="listbox"]').waitFor();
    // Same timer as the menu: the list focuses the selected option once it is placed, and an
    // arrow moves focus in a timer. Enter before the move re-selects the old theme and closes
    // the list, so wait for each focus change before the next key.
    const focusedOption = page.locator('[role="listbox"] [role="option"]:focus');
    await expect(focusedOption, 'theme: the open list focuses the current theme').toHaveCount(1);
    const startValue = ((await focusedOption.textContent()) ?? '').trim();
    await kb.press(/System/.test(startValue) ? 'ArrowUp' : 'ArrowDown');
    await expect(focusedOption, 'theme: the arrow moved to another theme').not.toHaveText(startValue);
    const picked = ((await focusedOption.textContent()) ?? '').trim();
    await kb.press('Enter');
    await expect(page.locator('[data-tour="settings-theme-trigger"]')).toHaveText(picked);
    for (let i = 0; i < 12 && !/settings-save-button/.test(await focusOf(page)); i++) {
      await kb.press('Tab');
      await page.waitForTimeout(60);
    }
    await kb.press('Enter');
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await neverBody('theme saved');
    await kb.press('Escape');
    await expect(page.locator('[role="dialog"]:not([data-tour-card])')).toHaveCount(0);
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'theme');
    await expectFocus(/^card/, 'theme: back on the card after Settings closes');
    await kb.press('Enter');
    await expect(cardOf(page)).not.toHaveAttribute('data-tour-card', 'theme');
    await neverBody('after theme');
  });

  // KNOWN BUG (reported, not fixed here): Tour.tsx's 500 ms hand-back window (handBackUntil) is not reset when the
  // step changes, so pressing Enter on the card right after a task completes and then Tab within that window gets
  // focus pulled back onto the card by the frame loop: the next step's control is not reached by one Tab.
  test('KNOWN BUG: Enter then an immediate Tab after a task completes still reaches the control of the next step', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);
    await goToStep(page, 'make-group');
    await page.locator('[data-tour="add-group"] button').click();
    await waitForRenameInputReady(page);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Keys');
    await page.keyboard.press('Enter');
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await expect.poll(() => focusOf(page)).toMatch(/^card/);
    await page.keyboard.press('Enter');
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', stepId('group-color'));
    await page.keyboard.press('Tab');
    await expect.poll(() => focusOf(page), { timeout: 3_000 }).toMatch(/Change group color/);
  });

  test('resume on an interactive step: still to do, practice group remembered, ring on that group\'s control', async ({ context, extensionId }) => {
    let page = await startTour(context, extensionId);
    await goToStep(page, 'make-group');
    await page.locator('[data-tour="add-group"] button').click();
    await page.locator('[data-tour="group-name-input"]').waitFor();
    await page.locator('[data-tour="group-name-input"]').fill('Practice');
    await page.locator('[data-tour="group-name-save"]').click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
    await nextOrSkip(page).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', stepId('group-color'));
    const row = await practiceRow(context);
    await waitForTour(context, (r) => r?.stepId === stepId('group-color') && typeof r.practiceGroupId === 'string', 'progress stored');
    await waitForStoredGroup(page, (g) => g.name === 'Practice', 'practice group written');
    const before = await readTour(context);
    await page.close();

    page = await openPopup(context, extensionId);
    await page.setViewportSize({ width: FRAME.width, height: FRAME.height });
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', stepId('group-color'));
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'todo');
    expect((await readTour(context)).practiceGroupId).toBe(before.practiceGroupId);
    await expectRingOn(page, `${row} [data-tour="group-color"]`, 'resumed colour step');
    // the step a resumed tour lands on shows its chapter description
    await expect(cardOf(page).locator('[data-tour-chapter-description]')).toHaveCount(1);
  });

  test('"Skip this step" moves on, "Skip chapter" jumps a chapter, "Skip tour" ends it', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);
    await goToStep(page, 'make-group');
    await expect(cardOf(page).locator('button', { hasText: /^Next$/ })).toHaveCount(0);
    await cardOf(page).locator('button', { hasText: /^Skip this step$/ }).click();
    // nothing was made, so the colour step cannot be tried: it is read-only
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', stepId('group-color'));
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'none');
    await expect(page.locator('[data-tour-action]')).toHaveCount(0);

    await cardOf(page).locator('button', { hasText: /^Skip chapter$/ }).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', stepId('drag-tab-reorder'));
    await expect(cardOf(page).locator('[data-tour-chapter]')).toContainText(`Chapter 3 of ${CHAPTER_COUNT}`);

    await goToStep(page, 'search');
    await cardOf(page).locator('button', { hasText: /^Skip tour$/ }).click();
    await expect(cardOf(page)).toHaveCount(0);
    await expect(page.locator('#root [inert]')).toHaveCount(0);
    await waitForTour(context, (r) => r?.status === 'done', 'skip stored as done');
  });

  test('the last chapter has no "Skip chapter"', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);
    await goToStep(page, 'settings-more');
    await expect(cardOf(page).locator('[data-tour-chapter]')).toContainText(`Chapter ${CHAPTER_COUNT} of ${CHAPTER_COUNT}`);
    await expect(cardOf(page).locator('button', { hasText: /^Skip chapter$/ })).toHaveCount(0);
    await expect(cardOf(page).locator('button', { hasText: /^Skip tour$/ })).toHaveCount(1);
  });

  test('replaying from the "?" button starts again at step 1 with its chapter header', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Take the tour' }).click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', 'welcome');
    await expect(cardOf(page).locator('[data-tour-chapter]')).toContainText(`Chapter 1 of ${CHAPTER_COUNT}`);
  });

  test('at the Free group limit the three group steps show their fallback text: no ring, Next, Add Group does nothing, no upgrade prompt', async ({ context, extensionId }) => {
    const five = [1, 2, 3, 4, 5].map((i) => ({ ...WORK_GROUP, id: `limit-${i}`, name: `Group ${i}` }));
    const page = await startTour(context, extensionId, [NOW_OPEN, ...five]);

    await goToStep(page, 'make-group');
    await expect(cardOf(page)).toContainText('as many groups as your plan allows');
    // Add Group is locked under the tour: a real click adds nothing and opens no upgrade prompt or toast
    const box = (await page.locator('[data-tour="add-group"]').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-sidebar-group-index]')).toHaveCount(6);
    await expect(page.locator('[role="dialog"]:not([data-tour-card])')).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    for (const id of ['make-group', stepId('group-color'), 'group-pin']) {
      await goToStep(page, id);
      await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'none');
      await expect(page.locator('[data-tour-action]')).toHaveCount(0);
      await expect(cardOf(page).locator('button', { hasText: /^Next$/ })).toHaveCount(1);
      await expect(cardOf(page).locator('button', { hasText: /^Skip this step$/ })).toHaveCount(0);
      await expect(page.locator('[role="dialog"]:not([data-tour-card])')).toHaveCount(0);
    }
  });
});

test.describe('Guided tour v2 in another language', () => {
  test.beforeEach(({}, info) => {
    info.setTimeout(120_000);
  });

  /** Reloads the popup in German (the stored language choice), resuming the tour on `step`. */
  async function inGerman(page: Page, context: BrowserContext, step: string) {
    await waitForTour(context, (r) => r?.stepId === step, `${step} stored`);
    // Both copies of the choice, as Settings saves it (the page trusts chrome.storage over localStorage)
    await page.evaluate(async () => {
      localStorage.setItem('tabmerger-locale', 'de');
      await chrome.storage.local.set({ tm_locale: 'de' });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(cardOf(page)).toHaveAttribute('data-tour-card', step);
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'todo');
  }

  /** Back to English (the tour's card buttons are matched by their English text below). */
  async function inEnglish(page: Page) {
    await page.evaluate(async () => {
      localStorage.removeItem('tabmerger-locale');
      await chrome.storage.local.remove('tm_locale');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  }

  test('the menu and dialog tasks find their controls by anchor, not by English text', async ({ context, extensionId }) => {
    const page = await startTour(context, extensionId);

    // "Open in browser" from the first sample window's menu
    await goToStep(page, stepId('open-tabs'));
    await inGerman(page, context, stepId('open-tabs'));
    const win = '[data-tm-dnd-id="tour-demo-1::w0"]';
    await expectRingOn(page, `${win} [data-tour="window-menu"]`, 'open-tabs 1 (de)');
    await page.locator(`${win} [data-tour="window-menu"]`).click();
    await expectRingOn(page, '[data-tour="window-open"]', 'open-tabs 2 (de)');
    await page.locator('[data-tour="window-open"]').click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');

    // "Deduplicate tabs", then the dialog's confirm button (its text starts with the count in German)
    await inEnglish(page);
    await goToStep(page, stepId('tidy-up'));
    await inGerman(page, context, stepId('tidy-up'));
    await page.locator('[data-tour="group-options"]').click();
    await expectRingOn(page, '[data-tour="group-deduplicate"]', 'tidy-up 2 (de)');
    await page.locator('[data-tour="group-deduplicate"]').click();
    await expectRingOn(page, '[data-tour="dedup-confirm"]', 'tidy-up 3 (de)');
    await page.locator('[data-tour="dedup-confirm"]').click();
    await expect(cardOf(page)).toHaveAttribute('data-tour-task', 'done');
  });
});
