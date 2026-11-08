import { describe, it, expect } from 'vitest';
import {
  AUTO_SAVE_ALARM_NAME,
  AUTO_SAVE_COPY,
  AUTO_SAVE_DUE_TOLERANCE_MS,
  AUTO_SAVE_FREE_KEEP_COUNT,
  AUTO_SAVE_INTERVAL_OPTIONS,
  AUTO_SAVE_MESSAGE,
  AUTO_SAVE_THRESHOLD_OPTIONS,
  DEFAULT_AUTO_SAVE_INTERVAL_MINUTES,
  DEFAULT_AUTO_SAVE_TAB_THRESHOLD,
  defaultAutoSaveEnabled,
  isAutoSaveDue,
  isAutoSaveInterval,
  isAutoSaveThreshold,
} from '../constants/autoSave';
import { AUTO_BACKUP_COPY, AUTO_BACKUP_ALARM_NAME, AUTO_BACKUP_MESSAGE } from '../constants/autoBackup';
import { FREE_TIER_LIMITS, getPricingTier } from '../constants';

const NOW = Date.UTC(2030, 0, 1);

describe('auto-save constants', () => {
  it('options include the defaults and an "off" value', () => {
    expect(AUTO_SAVE_INTERVAL_OPTIONS).toEqual([0, 15, 30, 60, 120, 240, 1440]);
    expect(AUTO_SAVE_THRESHOLD_OPTIONS).toEqual([0, 20, 30, 50, 75, 100]);
    expect(isAutoSaveInterval(DEFAULT_AUTO_SAVE_INTERVAL_MINUTES)).toBe(true);
    expect(isAutoSaveThreshold(DEFAULT_AUTO_SAVE_TAB_THRESHOLD)).toBe(true);
    for (const bad of [7, '60', null, undefined, NaN]) {
      expect(isAutoSaveInterval(bad)).toBe(false);
      expect(isAutoSaveThreshold(bad)).toBe(false);
    }
  });

  it('on by default for paid plans only', () => {
    expect(defaultAutoSaveEnabled(true)).toBe(true);
    expect(defaultAutoSaveEnabled(false)).toBe(false);
  });

  it('alarm and messages never collide with automatic backups or reminders', () => {
    expect(AUTO_SAVE_ALARM_NAME).not.toBe(AUTO_BACKUP_ALARM_NAME);
    expect(AUTO_SAVE_ALARM_NAME.startsWith('reminder-')).toBe(false);
    const ours = Object.values(AUTO_SAVE_MESSAGE);
    expect(new Set(ours).size).toBe(ours.length);
    for (const m of Object.values(AUTO_BACKUP_MESSAGE)) expect(ours).not.toContain(m);
  });

  it('isAutoSaveDue: never run, interval passed with tolerance, clock moved back, off', () => {
    expect(isAutoSaveDue(undefined, 60, NOW)).toBe(true);
    expect(isAutoSaveDue(0, 60, NOW)).toBe(true);
    expect(isAutoSaveDue(NOW - 30 * 60_000, 60, NOW)).toBe(false);
    expect(isAutoSaveDue(NOW - 60 * 60_000 + AUTO_SAVE_DUE_TOLERANCE_MS, 60, NOW)).toBe(true);
    expect(isAutoSaveDue(NOW + 1, 60, NOW)).toBe(true);
    expect(isAutoSaveDue(undefined, 0, NOW)).toBe(false);
  });
});

describe('pricing lines', () => {
  it('Free lists the rolling cap right after the sessions line', () => {
    const free = getPricingTier('free').features;
    expect(AUTO_SAVE_COPY.pricingFeatureFree).toBe(`Auto-save open tabs (newest ${AUTO_SAVE_FREE_KEEP_COUNT} kept)`);
    expect(free.indexOf(AUTO_SAVE_COPY.pricingFeatureFree)).toBe(free.indexOf(`Save up to ${FREE_TIER_LIMITS.sessions} sessions in this browser`) + 1);
    expect(free.indexOf(AUTO_SAVE_COPY.pricingFeatureFree)).toBe(4);
  });

  it('Pro lists "all kept" right after automatic backups; Pro AI lists are unchanged', () => {
    const pro = getPricingTier('pro').features;
    expect(AUTO_SAVE_COPY.pricingFeaturePro).toBe('Auto-save open tabs, all kept');
    expect(pro.indexOf(AUTO_SAVE_COPY.pricingFeaturePro)).toBe(pro.indexOf(AUTO_BACKUP_COPY.pricingFeature) + 1);
    expect(pro.indexOf(AUTO_SAVE_COPY.pricingFeaturePro)).toBe(5);
    const proAi = getPricingTier('pro_ai');
    expect(proAi.features).not.toContain(AUTO_SAVE_COPY.pricingFeaturePro);
    expect(proAi.byok?.features).not.toContain(AUTO_SAVE_COPY.pricingFeaturePro);
  });
});
