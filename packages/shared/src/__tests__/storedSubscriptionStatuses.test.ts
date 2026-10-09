import { describe, it, expect } from 'vitest';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  STORED_SUBSCRIPTION_STATUSES,
  isEntitledSubscriptionStatus,
} from '../constants/index';
import type { SubscriptionStatus } from '../types/index';

describe('STORED_SUBSCRIPTION_STATUSES', () => {
  it('is exactly the statuses a subscription row can hold', () => {
    expect([...STORED_SUBSCRIPTION_STATUSES].sort()).toEqual(
      ['active', 'canceled', 'incomplete', 'past_due', 'trialing']
    );
  });

  it('has no duplicates', () => {
    expect(new Set(STORED_SUBSCRIPTION_STATUSES).size).toBe(STORED_SUBSCRIPTION_STATUSES.length);
  });

  // An entitled status that could not be stored could never reach a row, so nobody would hold it.
  it.each([...ENTITLED_SUBSCRIPTION_STATUSES])('includes the entitled status %s', (status) => {
    expect(STORED_SUBSCRIPTION_STATUSES).toContain(status);
  });

  // `canceled` is what a status outside the list is written as: it has to be storable and it must
  // not grant a paid plan.
  it('includes canceled, which is not an entitled status', () => {
    expect(STORED_SUBSCRIPTION_STATUSES).toContain('canceled');
    expect(isEntitledSubscriptionStatus('canceled')).toBe(false);
  });

  it('lists every member of the SubscriptionStatus type', () => {
    // A Record over the union fails to compile if the type gains or loses a member.
    const everyMember: Record<SubscriptionStatus, true> = {
      active: true,
      canceled: true,
      past_due: true,
      trialing: true,
      incomplete: true,
    };
    expect(Object.keys(everyMember).sort()).toEqual([...STORED_SUBSCRIPTION_STATUSES].sort());
  });
});
