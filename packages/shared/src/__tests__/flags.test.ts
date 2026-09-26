import { describe, it, expect } from 'vitest';
import { isAiEnabled } from '../utils/flags';

describe('isAiEnabled', () => {
  it('returns true only for the exact string "true"', () => {
    expect(isAiEnabled('true')).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isAiEnabled(undefined)).toBe(false);
  });

  it('returns false for "false"', () => {
    expect(isAiEnabled('false')).toBe(false);
  });

  it('returns false for "TRUE" (case-sensitive)', () => {
    expect(isAiEnabled('TRUE')).toBe(false);
  });

  it('returns false for "1"', () => {
    expect(isAiEnabled('1')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isAiEnabled('')).toBe(false);
  });

  it('returns false for "true " with trailing whitespace', () => {
    expect(isAiEnabled('true ')).toBe(false);
  });

  it('returns false for " true" with leading whitespace', () => {
    expect(isAiEnabled(' true')).toBe(false);
  });
});
