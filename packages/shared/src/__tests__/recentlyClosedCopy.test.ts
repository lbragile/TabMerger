import { describe, it, expect } from 'vitest';
import { AUTO_SAVE_COPY, RECENTLY_CLOSED_COPY, RECENTLY_CLOSED_LIMITS, getPricingTier } from '../constants';

/**
 * The "Recently closed tabs" plan lines: built from the limits the extension enforces, placed after
 * each plan's auto-save line (past the first three, which the extension upgrade prompt shows), and
 * left to "Everything in Pro" on Pro AI.
 */
describe('recently closed pricing copy', () => {
  it('reads the Free and Pro limits from RECENTLY_CLOSED_LIMITS', () => {
    expect(RECENTLY_CLOSED_LIMITS).toEqual({ free: { recentDays: 2, entries: 1000 }, pro: { days: 30, entries: 1000 } });
    // Free's entry count is only a storage cap, never lower than Pro's
    expect(RECENTLY_CLOSED_LIMITS.free.entries).toBe(RECENTLY_CLOSED_LIMITS.pro.entries);
    expect(RECENTLY_CLOSED_COPY.pricingFeatureFree).toBe('Recently closed tabs: your last 2 days');
    expect(RECENTLY_CLOSED_COPY.pricingFeaturePro).toBe('Recently closed tabs: your last 30 days');
    // the entry caps are storage limits only: never in the copy
    expect(`${RECENTLY_CLOSED_COPY.pricingFeatureFree} ${RECENTLY_CLOSED_COPY.pricingFeaturePro}`).not.toMatch(/1,000|1000/);
  });

  it('Free lists it right after auto-save, outside the first three lines', () => {
    const free = getPricingTier('free').features;
    expect(free.indexOf(RECENTLY_CLOSED_COPY.pricingFeatureFree)).toBe(free.indexOf(AUTO_SAVE_COPY.pricingFeatureFree) + 1);
    expect(free.indexOf(RECENTLY_CLOSED_COPY.pricingFeatureFree)).toBeGreaterThanOrEqual(3);
    expect(free).not.toContain(RECENTLY_CLOSED_COPY.pricingFeaturePro);
  });

  it('Pro lists it right after auto-save, outside the first three lines', () => {
    const pro = getPricingTier('pro').features;
    expect(pro.indexOf(RECENTLY_CLOSED_COPY.pricingFeaturePro)).toBe(pro.indexOf(AUTO_SAVE_COPY.pricingFeaturePro) + 1);
    expect(pro.indexOf(RECENTLY_CLOSED_COPY.pricingFeaturePro)).toBeGreaterThanOrEqual(3);
    expect(pro).not.toContain(RECENTLY_CLOSED_COPY.pricingFeatureFree);
    expect(pro.at(-1)).toBe('Priority support');
  });

  it('Pro AI (both options) inherits it through "Everything in Pro"', () => {
    const proAi = getPricingTier('pro_ai');
    for (const features of [proAi.features, proAi.byok!.features]) {
      expect(features[0]).toBe('Everything in Pro');
      expect(features.some((f) => /recently closed/i.test(f))).toBe(false);
    }
  });
});
