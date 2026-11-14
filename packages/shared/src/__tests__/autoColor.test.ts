import { describe, expect, it } from 'vitest';
import { AUTO_ITEM_COLORS, PRESET_COLORS } from '../constants/index';
import { colorForDay, pickAutoColor } from '../utils/autoColor';

describe('AUTO_ITEM_COLORS', () => {
  it('is the presets without gray and slate dark', () => {
    expect(AUTO_ITEM_COLORS).toHaveLength(10);
    expect(AUTO_ITEM_COLORS).not.toContain('rgba(107, 114, 128, 1)');
    expect(AUTO_ITEM_COLORS).not.toContain('rgba(15, 23, 42, 1)');
    expect(AUTO_ITEM_COLORS.every((c) => (PRESET_COLORS as readonly string[]).includes(c))).toBe(true);
  });
});

describe('pickAutoColor', () => {
  it('never repeats the previous colour, whatever the random draw', () => {
    for (const previous of AUTO_ITEM_COLORS) {
      for (const r of [0, 0.05, 0.5, 0.95, 0.999999]) {
        const c = pickAutoColor(previous, () => r);
        expect(c).not.toBe(previous);
        expect(AUTO_ITEM_COLORS).toContain(c);
      }
    }
  });

  it('picks from every colour without a previous one, and survives a bad random', () => {
    expect(pickAutoColor(undefined, () => 0)).toBe(AUTO_ITEM_COLORS[0]);
    expect(pickAutoColor(undefined, () => 0.999)).toBe(AUTO_ITEM_COLORS[9]);
    expect(AUTO_ITEM_COLORS).toContain(pickAutoColor(undefined, () => Number.NaN));
    expect(AUTO_ITEM_COLORS).toContain(pickAutoColor(undefined, () => 1));
  });
});

describe('colorForDay', () => {
  it('is stable for a day and always differs for consecutive days', () => {
    expect(colorForDay('2026-11-13')).toBe(colorForDay('2026-11-13'));
    const keys = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];
    for (let i = 1; i < keys.length; i++) expect(colorForDay(keys[i])).not.toBe(colorForDay(keys[i - 1]));
  });

  it('is unaffected by a DST change day (counted on the calendar date)', () => {
    // EU spring forward 2026-03-29, US fall back 2026-11-01
    for (const [a, b, c] of [['2026-03-28', '2026-03-29', '2026-03-30'], ['2026-10-31', '2026-11-01', '2026-11-02']]) {
      expect(colorForDay(a)).not.toBe(colorForDay(b));
      expect(colorForDay(b)).not.toBe(colorForDay(c));
    }
    // 1970-01-01 is day 0
    expect(colorForDay('1970-01-01')).toBe(AUTO_ITEM_COLORS[0]);
    expect(colorForDay('1970-01-11')).toBe(AUTO_ITEM_COLORS[0]);
  });

  it('gives an unreadable key the first colour', () => {
    expect(colorForDay('not a day')).toBe(AUTO_ITEM_COLORS[0]);
  });
});
