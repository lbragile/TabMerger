import { describe, it, expect } from 'vitest';
import { getPricingTier } from '../constants';

const ORGANIZE_LINE = 'AI workspace cleanup: merge, rename, archive & reorder groups';

/**
 * What Pro AI sells, in both options (TabMerger handles setup, or the user's own key). The web
 * pricing cards and the extension's upgrade prompt render these lists, so a missing feature or a
 * provider-specific claim here shows up on every page that lists the plan.
 */
describe('Pro AI feature lists', () => {
  const proAi = getPricingTier('pro_ai');
  const lists = { managed: proAi.features, byok: proAi.byok!.features };

  it.each(Object.entries(lists))('%s: lists all five AI features, Organize after session suggestions', (_option, features) => {
    for (const line of [
      'AI auto-grouping of tabs',
      'AI group name suggestions',
      'Smart session suggestions',
      ORGANIZE_LINE,
      'Tab preview with AI summary',
    ]) {
      expect(features).toContain(line);
    }
    expect(features.indexOf(ORGANIZE_LINE)).toBe(features.indexOf('Smart session suggestions') + 1);
  });

  it('keeps the first three lines (the extension upgrade prompt shows only those) unchanged', () => {
    for (const features of Object.values(lists)) {
      expect(features.slice(0, 3)).toEqual(['Everything in Pro', 'AI auto-grouping of tabs', 'AI group name suggestions']);
    }
  });

  // An own key can be OpenAI, Anthropic or Google, so no line may name one AI provider or model.
  it.each(Object.entries(lists))('%s: names no AI provider or model', (_option, features) => {
    for (const line of features) {
      expect(line).not.toMatch(/claude|anthropic|openai|gpt|gemini|google/i);
    }
  });
});
