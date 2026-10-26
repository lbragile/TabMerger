import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { E2E_USER_ID, openPopup, seedAndReload, signInAsPro, waitForStoredGroup } from '../helpers';
import { ANOTHER_GROUP, NOW_OPEN, SAVED_GROUP } from '../seed';

/**
 * Settings → AI for a Pro AI subscriber on their own key (`ai_mode: 'byok'`): provider first, then
 * that provider's key field, setup links and models; a key of another provider is refused before
 * any request; switching provider keeps the saved key until Cancel or a new save.
 *
 * Needs a build with own-key AI on (`VITE_AI_BYOK_ENABLED=true`, as in a local `.env.local`
 * dev build); a build without it has no AI tab, and the test skips.
 */

/** Key-shaped values built at run time, so no key-shaped literal is in the source. */
const GOOGLE_KEY = 'AIza' + 'z'.repeat(35);
const OPENAI_KEY = 'sk-proj-' + 'y'.repeat(24);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

/** The provider a key's prefix names, as the server's verify answers it. */
function providerOf(key: string): string {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  return key.startsWith('AIza') ? 'google' : 'openai';
}

/** A signed-in Pro AI own-key account, with the key check answered as a pass. Returns the verify calls' keys. */
async function signInAsProAiByok(page: Page): Promise<{ verifyCalls: () => number; verifiedKeys: string[] }> {
  await signInAsPro(page);
  // Registered after signInAsPro's stubs, so it wins for this table
  await page.route('**/rest/v1/subscriptions*', (route) =>
    route.fulfill({
      json: [{ tier: 'pro_ai', status: 'active', cancel_at_period_end: false, current_period_end: null, stripe_price_id: null, ai_mode: 'byok' }]
    })
  );
  const verifiedKeys: string[] = [];
  await page.route('**/api/ai/byok/verify*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const key = route.request().headers()['x-ai-key'] ?? '';
    verifiedKeys.push(key);
    return route.fulfill({ headers: CORS, json: { ok: true, provider: providerOf(key) } });
  });
  return { verifyCalls: () => verifiedKeys.length, verifiedKeys };
}

/**
 * Picks a provider. Not `check()`: the radio is controlled by a query whose update reaches React a
 * tick after the click, so `check()` can read the old state and fail; wait for the new one instead.
 */
async function pickProvider(page: Page, name: string): Promise<void> {
  const radio = page.getByRole('group', { name: 'AI provider' }).getByRole('radio', { name });
  await radio.click();
  await expect(radio).toBeChecked();
}

async function openAiSettings(page: Page): Promise<boolean> {
  await page.locator('header').getByRole('button').last().click();
  await page.waitForTimeout(200);
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const aiTab = page.getByRole('tab', { name: /^ai$/i });
  if ((await aiTab.count()) === 0) return false;
  await aiTab.click();
  return true;
}

test.describe('Settings → AI, own key', () => {
  test('provider first, mismatch refused, save, switch and cancel, pick remembered', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);
    const { verifyCalls } = await signInAsProAiByok(page);
    await page.reload({ waitUntil: 'networkidle' });

    test.skip(!(await openAiSettings(page)), 'this build has own-key AI off (VITE_AI_BYOK_ENABLED), so there is no AI tab');

    const providers = page.getByRole('group', { name: 'AI provider' });
    const models = page.getByRole('group', { name: 'AI model' });
    const keyInput = page.getByTestId('ai-byok-key-input');

    // Nothing provider-specific before a pick
    await expect(providers).toBeVisible();
    await expect(keyInput).toHaveCount(0);
    await expect(page.getByTestId('ai-provider-links')).toHaveCount(0);
    await expect(models).toHaveCount(0);

    // Pick Google: its key field, links and models only
    await pickProvider(page, 'Google');
    await expect(keyInput).toHaveAttribute('placeholder', 'AIza…');
    await expect(page.getByTestId('ai-provider-guide-link')).toHaveAttribute('href', 'https://ai.google.dev/gemini-api/docs/api-key');
    await expect(page.getByTestId('ai-provider-keys-link')).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
    await expect(page.getByTestId('ai-provider-keys-link')).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(models.getByTestId('ai-model-gemini-4-argon')).toBeVisible();
    await expect(models.getByTestId('ai-model-gpt-6-astra')).toHaveCount(0);
    await expect(models.getByTestId('ai-model-claude-opus-5-5')).toHaveCount(0);

    // An OpenAI key under Google: inline error tied to the field, nothing sent
    await keyInput.fill(OPENAI_KEY);
    await page.getByRole('button', { name: 'Save key' }).click();
    const error = page.getByTestId('ai-byok-key-error');
    await expect(error).toHaveText("This key looks like it's from OpenAI. Pick OpenAI above, or paste a key from Google.");
    const errorId = await error.getAttribute('id');
    expect((await keyInput.getAttribute('aria-describedby'))?.split(' ')).toContain(errorId);
    expect(verifyCalls()).toBe(0);

    // A Google key saves after the check and shows masked
    await keyInput.fill(GOOGLE_KEY);
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.getByTestId('ai-byok-key-masked')).toHaveText('AIza…zzzz');
    expect(verifyCalls()).toBe(1);

    // Switch to OpenAI: the saved key stays in use until a new one is saved; Cancel goes back
    await pickProvider(page, 'OpenAI');
    await expect(page.getByTestId('ai-byok-switch-note')).toHaveText('Your saved Google key stays in use until you save a key from OpenAI.');
    await expect(keyInput).toHaveAttribute('placeholder', 'sk-proj-…');
    await expect(models.getByTestId('ai-model-gpt-6-astra')).toBeVisible();
    await page.getByTestId('ai-byok-cancel').click();
    await expect(providers.getByRole('radio', { name: 'Google' })).toBeChecked();
    await expect(providers.getByRole('radio', { name: 'Google' })).toBeFocused();
    await expect(page.getByTestId('ai-byok-key-masked')).toHaveText('AIza…zzzz');

    // A pick without a key survives closing and reopening Settings
    await pickProvider(page, 'Anthropic');
    await expect(page.getByTestId('ai-byok-switch-note')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(providers).toHaveCount(0);
    expect(await openAiSettings(page)).toBe(true);
    await expect(providers.getByRole('radio', { name: 'Anthropic' })).toBeChecked();
    await expect(page.getByTestId('ai-byok-switch-note')).toHaveText('Your saved Google key stays in use until you save a key from Anthropic.');
  });

  test('an AI error fixed in Settings opens Settings on the AI tab', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);
    await signInAsProAiByok(page);
    await page.reload({ waitUntil: 'networkidle' });

    const aiActions = page.getByRole('button', { name: 'AI actions' });
    test.skip((await aiActions.count()) === 0, 'this build has own-key AI off (VITE_AI_BYOK_ENABLED)');

    // No key saved on this device: Auto-group fails before any request, with "Open Settings"
    await aiActions.click();
    await page.getByRole('menuitem', { name: /Auto-group/ }).click();
    await page.getByRole('button', { name: 'Open Settings' }).click();
    // The AI tab appears once the account has loaded; it must still be the one shown, and focused
    const aiTab = page.getByRole('tab', { name: /^ai$/i });
    await expect(aiTab).toHaveAttribute('aria-selected', 'true');
    await expect(aiTab).toBeFocused();
    await expect(page.getByRole('group', { name: 'AI provider' })).toBeVisible();
  });

  test('header AI menu: "Name group" offers suggestions to pick from for the active saved group, and is disabled on Now Open', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);
    await signInAsProAiByok(page);
    // An own key saved on this device, so the request is sent (the key is built at run time)
    await page.evaluate(
      ([userId, key]) => chrome.storage.local.set({ aiByokKey: { userId, key, provider: 'anthropic' } }),
      [E2E_USER_ID, 'sk-ant-' + 'e'.repeat(24)]
    );
    const nameRequests: { tabs: { url: string }[] }[] = [];
    await page.route('**/api/ai/name-group*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      nameRequests.push(route.request().postDataJSON() as { tabs: { url: string }[] });
      return route.fulfill({ headers: CORS, json: { names: ['Team tools', 'Work dashboards', 'Project hub'], name: 'Team tools' } });
    });
    await page.reload({ waitUntil: 'networkidle' });

    const aiActions = page.getByRole('button', { name: 'AI actions' });
    test.skip((await aiActions.count()) === 0, 'this build has own-key AI off (VITE_AI_BYOK_ENABLED)');
    const nameItem = page.getByRole('menuitem', { name: /Name group/ });

    // Now Open is shown first: the item is there but disabled, and says why
    await aiActions.click();
    await expect(nameItem).toHaveAttribute('aria-disabled', 'true');
    await expect(nameItem).toContainText('Select a saved group first');
    await page.keyboard.press('Escape');

    // The saved group: its section label names it, and picking the item renames that group
    await page.locator('[data-sidebar-group-index="1"]').click();
    await aiActions.click();
    await expect(nameItem).not.toHaveAttribute('aria-disabled', 'true');
    await expect(nameItem).toContainText('Suggest a name');
    // (Chrome's accessible name pads the inline-block <bdi> name with spaces)
    await expect(page.getByRole('group', { name: new RegExp(`^Selected group · \\s*${SAVED_GROUP.name}\\s*$`) })).toBeVisible();
    await nameItem.click();

    // The picker: the current name, the suggestions as radios (the first picked and focused), "your own"
    const picker = page.getByRole('dialog', { name: 'Name this group' });
    await expect(picker).toBeVisible();
    await expect(picker).toContainText(`Currently: ${SAVED_GROUP.name}`);
    const choices = picker.getByRole('radiogroup', { name: 'Suggested names' });
    await expect(choices.getByRole('radio')).toHaveCount(4);
    const first = choices.getByRole('radio', { name: 'Team tools' });
    await expect(first).toBeChecked();
    // Nothing is renamed until a pick
    await expect(page.locator('[data-sidebar-group-index="1"]')).toContainText(SAVED_GROUP.name);
    expect(nameRequests).toHaveLength(1);
    expect(nameRequests[0].tabs.map((t) => t.url)).toEqual(SAVED_GROUP.windows[0].tabs.map((t) => t.url));

    // Keyboard: wait for the dialog's focus to land before the keys (focus moves on a timer)
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const second = choices.getByRole('radio', { name: 'Work dashboards' });
    await expect(second).toBeChecked();
    await expect(second).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();

    await expect(page.locator('[data-sidebar-group-index="1"]')).toContainText('Work dashboards');
    await waitForStoredGroup(page, (g) => g.id === SAVED_GROUP.id && g.name === 'Work dashboards', 'the picked AI name stored on the saved group');

    // A name of your own: typing selects "your own", Rename applies it
    await aiActions.click();
    await nameItem.click();
    await expect(picker).toBeVisible();
    await expect(picker).toContainText('Currently: Work dashboards');
    // The current name is not offered again
    await expect(choices.getByRole('radio', { name: 'Work dashboards' })).toHaveCount(0);
    await picker.getByRole('textbox', { name: 'Your own name' }).fill('  My team  ');
    await expect(choices.getByRole('radio', { name: 'Or type your own:' })).toBeChecked();
    await picker.getByRole('button', { name: 'Rename' }).click();
    await expect(picker).toBeHidden();
    await waitForStoredGroup(page, (g) => g.id === SAVED_GROUP.id && g.name === 'My team', 'the typed name stored, trimmed');
  });

  test('header AI menu: sections by scope; "Describe group" writes the note (Undo in the toast), and reviews an existing note', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP, { ...ANOTHER_GROUP, note: 'My reading notes' }]);
    await signInAsProAiByok(page);
    await page.evaluate(
      ([userId, key]) => chrome.storage.local.set({ aiByokKey: { userId, key, provider: 'anthropic' } }),
      [E2E_USER_ID, 'sk-ant-' + 'e'.repeat(24)]
    );
    const describeRequests: { groupName: string; tabs: Record<string, unknown>[] }[] = [];
    await page.route('**/api/ai/describe-group*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      describeRequests.push(route.request().postDataJSON() as { groupName: string; tabs: Record<string, unknown>[] });
      // Untrusted output: a newline and a bidi override the popup must clean up
      return route.fulfill({ headers: CORS, json: { description: 'Team tracker\nand docs.‮' } });
    });
    await page.reload({ waitUntil: 'networkidle' });

    const aiActions = page.getByRole('button', { name: 'AI actions' });
    test.skip((await aiActions.count()) === 0, 'this build has own-key AI off (VITE_AI_BYOK_ENABLED)');
    const describeItem = page.getByRole('menuitem', { name: /Describe group/ });

    // Now Open: the sections are there, the selected-group items disabled with the reason
    await aiActions.click();
    await expect(page.getByRole('group', { name: 'Open tabs' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Selected group' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'All groups' })).toBeVisible();
    await expect(describeItem).toHaveAttribute('aria-disabled', 'true');
    await expect(describeItem).toContainText('Select a saved group first');
    await expect(page.getByTestId('header-ai-plan')).toHaveText('Your own key');
    await page.keyboard.press('Escape');

    // A saved group with no note: the description becomes its note, one Undo away
    await page.locator('[data-sidebar-group-index="1"]').click();
    await aiActions.click();
    await describeItem.click();
    await waitForStoredGroup(page, (g) => g.id === SAVED_GROUP.id && g.note === 'Team tracker and docs.', 'the cleaned description stored as the note');
    expect(describeRequests).toHaveLength(1);
    expect(describeRequests[0].groupName).toBe(SAVED_GROUP.name);
    // Only each tab's title and URL are sent
    expect(describeRequests[0].tabs).toEqual(SAVED_GROUP.windows[0].tabs.map((t) => ({ title: t.title, url: t.url })));
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Note added' });
    await toast.getByRole('button', { name: 'Undo' }).click();
    await waitForStoredGroup(page, (g) => g.id === SAVED_GROUP.id && !g.note, 'the note taken back by the toast Undo');

    // A group that has a note: the review offers Replace / Add below / Cancel; Add below keeps it above
    await page.locator('[data-sidebar-group-index="2"]').click();
    await aiActions.click();
    await describeItem.click();
    const dialog = page.getByRole('dialog', { name: 'Use the AI description?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('describe-group-current-note')).toHaveText('My reading notes');
    await expect(dialog.getByTestId('describe-group-suggestion')).toHaveText('Team tracker and docs.');
    await dialog.getByRole('button', { name: 'Add below' }).click();
    await expect(dialog).toHaveCount(0);
    await waitForStoredGroup(
      page,
      (g) => g.id === ANOTHER_GROUP.id && g.note === 'My reading notes\n\nTeam tracker and docs.',
      'the description added below the existing note'
    );
  });

  test('window ⋯ menu: "Describe with AI" writes the window note (Undo in the toast) and "AI rename" names the window from the picker', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);
    await signInAsProAiByok(page);
    await page.evaluate(
      ([userId, key]) => chrome.storage.local.set({ aiByokKey: { userId, key, provider: 'anthropic' } }),
      [E2E_USER_ID, 'sk-ant-' + 'e'.repeat(24)]
    );
    const describeRequests: { groupName: string; tabs: Record<string, unknown>[] }[] = [];
    await page.route('**/api/ai/describe-group*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      describeRequests.push(route.request().postDataJSON() as { groupName: string; tabs: Record<string, unknown>[] });
      return route.fulfill({ headers: CORS, json: { description: 'Team tracker and docs.' } });
    });
    const nameRequests: { tabs: { url: string }[] }[] = [];
    await page.route('**/api/ai/name-group*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      nameRequests.push(route.request().postDataJSON() as { tabs: { url: string }[] });
      return route.fulfill({ headers: CORS, json: { names: ['Team tools', 'Work dashboards'] } });
    });
    await page.reload({ waitUntil: 'networkidle' });
    test.skip((await page.getByRole('button', { name: 'AI actions' }).count()) === 0, 'this build has own-key AI off (VITE_AI_BYOK_ENABLED)');

    // Now Open's windows have no AI items (their names and notes are rebuilt from the browser)
    const moreOptions = page.getByRole('button', { name: 'More window options' }).first();
    await moreOptions.click();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Describe with AI' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'AI rename' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The saved group's (unnamed) window: the description becomes the WINDOW's note, one Undo away
    await page.locator('[data-sidebar-group-index="1"]').click();
    await moreOptions.click();
    await page.getByRole('menuitem', { name: 'Describe with AI' }).click();
    await waitForStoredGroup(
      page,
      (g) => g.id === SAVED_GROUP.id && g.windows[0].note === 'Team tracker and docs.' && !g.note,
      'the description stored as the window note (the group note untouched)'
    );
    expect(describeRequests).toHaveLength(1);
    // An unnamed window is sent with an empty name, plus only its tabs' titles and URLs
    expect(describeRequests[0].groupName).toBe('');
    expect(describeRequests[0].tabs).toEqual(SAVED_GROUP.windows[0].tabs.map((t) => ({ title: t.title, url: t.url })));
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Note added' });
    await toast.getByRole('button', { name: 'Undo' }).click();
    await waitForStoredGroup(page, (g) => g.id === SAVED_GROUP.id && !g.windows[0].note, 'the window note taken back by the toast Undo');

    // "AI rename": the "Name this window" picker; Rename names the window, not the group
    await moreOptions.click();
    await page.getByRole('menuitem', { name: 'AI rename' }).click();
    const picker = page.getByRole('dialog', { name: 'Name this window' });
    await expect(picker).toBeVisible();
    expect(nameRequests[0].tabs.map((t) => t.url)).toEqual(SAVED_GROUP.windows[0].tabs.map((t) => t.url));
    await picker.getByRole('radio', { name: 'Work dashboards' }).click();
    await picker.getByRole('button', { name: 'Rename' }).click();
    await expect(picker).toBeHidden();
    await waitForStoredGroup(
      page,
      (g) => g.id === SAVED_GROUP.id && g.windows[0].name === 'Work dashboards' && g.name === SAVED_GROUP.name,
      'the picked AI name stored on the window'
    );
  });

  test('header AI menu: "Organize" reviews the proposed changes in the popup and applies the checked ones', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP]);
    await signInAsProAiByok(page);
    await page.evaluate(
      ([userId, key]) => chrome.storage.local.set({ aiByokKey: { userId, key, provider: 'anthropic' } }),
      [E2E_USER_ID, 'sk-ant-' + 'e'.repeat(24)]
    );
    const organizeRequests: { groups?: { id: string; permanent: boolean }[] }[] = [];
    await page.route('**/api/ai/organize*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const body = route.request().postDataJSON() as { groups?: { id: string; permanent: boolean }[] };
      organizeRequests.push(body);
      // Now Open's id as the popup sent it (signing in re-creates Now Open under a new id)
      const nowOpenId = body.groups?.find((g) => g.permanent)?.id ?? NOW_OPEN.id;
      return route.fulfill({
        headers: CORS,
        json: {
          actions: [
            { type: 'merge', sourceGroupId: ANOTHER_GROUP.id, targetGroupId: SAVED_GROUP.id },
            { type: 'rename', groupId: SAVED_GROUP.id, newName: 'Team hub' },
            // Untrusted output the popup must drop: Now Open and an unknown group
            { type: 'delete', groupId: nowOpenId },
            { type: 'delete', groupId: 'not-a-group' }
          ]
        }
      });
    });
    await page.reload({ waitUntil: 'networkidle' });

    const aiActions = page.getByRole('button', { name: 'AI actions' });
    test.skip((await aiActions.count()) === 0, 'this build has own-key AI off (VITE_AI_BYOK_ENABLED)');
    const pagesBefore = context.pages().length;

    await aiActions.click();
    await page.getByRole('menuitem', { name: /Organize/ }).click();

    // The review lists the two valid changes in plain words, both checked; no web tab opened
    const dialog = page.getByRole('dialog', { name: 'Organize groups' });
    await expect(dialog).toBeVisible();
    // (Chrome's accessible name pads the inline-block <bdi> names with spaces inside the quotes)
    const merge = dialog.getByRole('checkbox', { name: new RegExp(`^Merge “\\s*${ANOTHER_GROUP.name}\\s*” into “\\s*${SAVED_GROUP.name}\\s*”$`) });
    const rename = dialog.getByRole('checkbox', { name: new RegExp(`^Rename “\\s*${SAVED_GROUP.name}\\s*” to “\\s*Team hub\\s*”$`) });
    await expect(merge).toBeChecked();
    await expect(rename).toBeChecked();
    await expect(dialog.getByRole('checkbox')).toHaveCount(2);
    expect(context.pages().length).toBe(pagesBefore);
    // The local, decrypted groups were sent (an encrypted account's rows are ciphertext to the server)
    expect(organizeRequests).toHaveLength(1);
    expect(organizeRequests[0].groups?.map((g) => g.permanent)).toEqual([true, false, false]);
    expect(organizeRequests[0].groups?.slice(1).map((g) => g.id)).toEqual([SAVED_GROUP.id, ANOTHER_GROUP.id]);

    await dialog.getByRole('button', { name: 'Apply selected' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Applied 2 changes')).toBeVisible();

    // The sidebar shows one merged, renamed group; the merged-away group is gone
    await expect(page.locator('[data-sidebar-group-index="1"]')).toContainText('Team hub');
    await expect(page.locator('[data-sidebar-group-index]')).toHaveCount(2);
    await expect(page.getByText(ANOTHER_GROUP.name)).toHaveCount(0);
    const mergedUrls = [...SAVED_GROUP.windows, ...ANOTHER_GROUP.windows].flatMap((w) => w.tabs.map((t) => t.url));
    await waitForStoredGroup(
      page,
      (g) => g.id === SAVED_GROUP.id && g.name === 'Team hub' && g.windows.flatMap((w) => w.tabs.map((t) => t.url)).join() === mergedUrls.join(),
      'the merged, renamed group stored'
    );

    // One undo step takes the whole Organize back
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-sidebar-group-index="2"]')).toContainText(ANOTHER_GROUP.name);
    await expect(page.locator('[data-sidebar-group-index="1"]')).toContainText(SAVED_GROUP.name);
  });

  test('dev builds: "Use test key" saves the dummy key of the picked provider', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);
    const { verifiedKeys } = await signInAsProAiByok(page);
    await page.reload({ waitUntil: 'networkidle' });

    test.skip(!(await openAiSettings(page)), 'this build has own-key AI off (VITE_AI_BYOK_ENABLED), so there is no AI tab');
    // Only development builds have the Dev tab and the test key
    test.skip((await page.getByRole('tab', { name: /^dev$/i }).count()) === 0, 'not a development build');

    const testKey = page.getByRole('button', { name: 'Use test key' });
    await expect(testKey).toHaveCount(0); // no provider picked yet
    await pickProvider(page, 'Anthropic');
    await testKey.click();
    await expect(page.getByTestId('ai-byok-key-masked')).toHaveText('sk-ant-…0000');
    expect(verifiedKeys).toEqual(['sk-ant-mock-' + '0'.repeat(24)]);
  });
});
