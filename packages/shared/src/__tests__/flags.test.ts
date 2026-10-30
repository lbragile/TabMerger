import { describe, it, expect } from 'vitest';
import { aiAvailability, isAiByokEnabled, isAiEnabled } from '../utils/flags';

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

describe('isAiByokEnabled', () => {
  it('is on only for the exact string "true"', () => {
    expect(isAiByokEnabled('true')).toBe(true);
    expect(isAiByokEnabled('TRUE')).toBe(false);
    expect(isAiByokEnabled('1')).toBe(false);
    expect(isAiByokEnabled(undefined)).toBe(false);
  });
});

describe('aiAvailability', () => {
  it('keeps both options off by default', () => {
    expect(aiAvailability(undefined, undefined)).toEqual({ managed: false, byok: false, any: false });
  });

  it('can launch the own-key option alone', () => {
    expect(aiAvailability(undefined, 'true')).toEqual({ managed: false, byok: true, any: true });
  });

  it('turns on the own-key option with managed AI', () => {
    expect(aiAvailability('true', undefined)).toEqual({ managed: true, byok: true, any: true });
  });
});
