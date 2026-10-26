import { describe, it, expect } from 'vitest';
import { getPricingTier } from '../constants';

const ORGANIZE_LINE = 'AI workspace cleanup: merge, rename, archive & reorder groups';
const DESCRIBE_LINE = "AI group descriptions in the group's note";

/**
 * What Pro AI sells, in both options (TabMerger handles setup, or the user's own key). The web
 * pricing cards and the extension's upgrade prompt render these lists, so a missing feature or a
 * provider-specific claim here shows up on every page that lists the plan.
 */
describe('Pro AI feature lists', () => {
  const proAi = getPricingTier('pro_ai');
  const lists = { managed: proAi.features, byok: proAi.byok!.features };

  it.each(Object.entries(lists))('%s: lists all six AI features in order, Describe group after naming', (_option, features) => {
    const aiLines = [
      'AI auto-grouping of tabs',
      'AI group name suggestions',
      DESCRIBE_LINE,
      'Smart session suggestions',
      ORGANIZE_LINE,
      'Tab preview with AI summary',
    ];
    // The six AI lines follow "Everything in Pro" in this order; the rest (credits or own key,
    // model choice) come after them.
    expect(features.slice(1, 1 + aiLines.length)).toEqual(aiLines);
    expect(features.indexOf(DESCRIBE_LINE)).toBe(features.indexOf('AI group name suggestions') + 1);
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
