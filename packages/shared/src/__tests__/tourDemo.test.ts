import { describe, it, expect } from 'vitest';
import { SEARCH_COPY } from '../constants/search';
import { TOUR_DEMO_GROUP_IDS, isReservedTourDemoId, isTourDemoGroup, withoutTourDemoGroups } from '../utils/tourDemo';

describe('isReservedTourDemoId', () => {
  it('is true for exactly the two practice ids', () => {
    expect(TOUR_DEMO_GROUP_IDS).toEqual(['tour-demo-1', 'tour-demo-2']);
    expect(isReservedTourDemoId('tour-demo-1')).toBe(true);
    expect(isReservedTourDemoId('tour-demo-2')).toBe(true);
  });

  it('is false for any other id and for non-strings', () => {
    for (const v of ['tour-demo-3', 'Tour-Demo-1', ' tour-demo-1', '', 'abc', 1, null, undefined, {}]) {
      expect(isReservedTourDemoId(v)).toBe(false);
    }
  });
});

describe('isTourDemoGroup / withoutTourDemoGroups', () => {
  it('only the literal true counts', () => {
    expect(isTourDemoGroup({ tourDemo: true })).toBe(true);
    expect(isTourDemoGroup({ tourDemo: 'true' })).toBe(false);
    expect(isTourDemoGroup({ tourDemo: 1 })).toBe(false);
    expect(isTourDemoGroup(null)).toBe(false);
  });

  it('filters practice groups and returns the same array when there are none', () => {
    const real: { id: string; tourDemo?: boolean }[] = [{ id: 'a' }, { id: 'b' }];
    expect(withoutTourDemoGroups(real)).toBe(real);
    expect(withoutTourDemoGroups([{ id: 'a' }, { id: 'd', tourDemo: true }])).toEqual([{ id: 'a' }]);
  });
});

describe('SEARCH_COPY', () => {
  it('resultCount words zero, one and many', () => {
    expect(SEARCH_COPY.resultCount(0)).toBe('No results');
    expect(SEARCH_COPY.resultCount(1)).toBe('1 result');
    expect(SEARCH_COPY.resultCount(7)).toBe('7 results');
  });

  it('focusMoved names the row focus went to', () => {
    expect(SEARCH_COPY.focusMoved('My tab')).toBe('Focus moved to My tab');
  });

  it('exposes the fixed phrases used in accessible names', () => {
    expect(SEARCH_COPY.noMatchSuffix).toBe(', no match');
    expect(SEARCH_COPY.openSearch).toBe('Open search');
    expect(SEARCH_COPY.currentSearch).toBe('current search');
  });
});
