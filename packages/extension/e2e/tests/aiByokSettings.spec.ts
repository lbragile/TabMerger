import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, signInAsPro } from '../helpers';
import { NOW_OPEN } from '../seed';

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
