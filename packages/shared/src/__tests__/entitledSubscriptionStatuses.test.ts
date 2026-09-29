import { describe, it, expect } from 'vitest';
import { ENTITLED_SUBSCRIPTION_STATUSES, isEntitledSubscriptionStatus } from '../constants/index';

describe('ENTITLED_SUBSCRIPTION_STATUSES', () => {
  it('is exactly active, trialing, past_due', () => {
    expect(ENTITLED_SUBSCRIPTION_STATUSES).toEqual(['active', 'trialing', 'past_due']);
  });
});

describe('isEntitledSubscriptionStatus', () => {
  it.each(['active', 'trialing', 'past_due'])('returns true for %s', (status) => {
    expect(isEntitledSubscriptionStatus(status)).toBe(true);
  });

  it.each(['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'])(
    'returns false for %s',
    (status) => {
      expect(isEntitledSubscriptionStatus(status)).toBe(false);
    }
  );

  it('returns false for null', () => {
    expect(isEntitledSubscriptionStatus(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isEntitledSubscriptionStatus(undefined)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isEntitledSubscriptionStatus('')).toBe(false);
  });
});
