import { describe, it, expect } from 'vitest';
import { formatUsd, formatListPrice, PRICES_IN_USD_NOTE } from '../constants/priceFormat';

describe('price formatting', () => {
  it('formatUsd marks the price as US dollars, always with cents', () => {
    // A bare "$" reads as local dollars in Canada and elsewhere.
    expect(formatUsd(3.5825)).toBe('US$3.58');
    expect(formatUsd(7)).toBe('US$7.00');
  });

  it('formatListPrice leaves the currency to the listing footnote', () => {
    expect(formatListPrice(3.5825)).toBe('$3.58');
    expect(formatListPrice(7)).toBe('$7.00');
    expect(PRICES_IN_USD_NOTE).toMatch(/US dollars \(USD\)/);
  });
});
