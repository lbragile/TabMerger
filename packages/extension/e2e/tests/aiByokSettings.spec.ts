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

/** A signed-in Pro AI own-key account, with the key check answered as a pass. Returns the verify call count. */
async function signInAsProAiByok(page: Page): Promise<{ verifyCalls: () => number }> {
  await signInAsPro(page);
  // Registered after signInAsPro's stubs, so it wins for this table
  await page.route('**/rest/v1/subscriptions*', (route) =>
    route.fulfill({
      json: [{ tier: 'pro_ai', status: 'active', cancel_at_period_end: false, current_period_end: null, stripe_price_id: null, ai_mode: 'byok' }]
    })
  );
  let calls = 0;
  await page.route('**/api/ai/byok/verify*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls += 1;
    return route.fulfill({ headers: CORS, json: { ok: true, provider: 'google' } });
  });
  return { verifyCalls: () => calls };
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
    await providers.getByRole('radio', { name: 'Google' }).check();
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
    await providers.getByRole('radio', { name: 'OpenAI' }).check();
    await expect(page.getByTestId('ai-byok-switch-note')).toHaveText('Your saved Google key stays in use until you save a key from OpenAI.');
    await expect(keyInput).toHaveAttribute('placeholder', 'sk-proj-…');
    await expect(models.getByTestId('ai-model-gpt-6-astra')).toBeVisible();
    await page.getByTestId('ai-byok-cancel').click();
    await expect(providers.getByRole('radio', { name: 'Google' })).toBeChecked();
    await expect(providers.getByRole('radio', { name: 'Google' })).toBeFocused();
    await expect(page.getByTestId('ai-byok-key-masked')).toHaveText('AIza…zzzz');

    // A pick without a key survives closing and reopening Settings
    await providers.getByRole('radio', { name: 'Anthropic' }).check();
    await expect(page.getByTestId('ai-byok-switch-note')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(providers).toHaveCount(0);
    expect(await openAiSettings(page)).toBe(true);
    await expect(providers.getByRole('radio', { name: 'Anthropic' })).toBeChecked();
    await expect(page.getByTestId('ai-byok-switch-note')).toHaveText('Your saved Google key stays in use until you save a key from Anthropic.');
  });
});
