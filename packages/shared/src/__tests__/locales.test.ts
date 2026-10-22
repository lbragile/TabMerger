import { describe, expect, it } from 'vitest';
import { LOCALE_NATIVE_NAMES, RTL_LOCALES, SUPPORTED_LOCALES, isRtlLocale, isSupportedLocale } from '../constants/locales';

describe('LOCALE_NATIVE_NAMES', () => {
  it('names exactly the shipped locales, each in its own language', () => {
    expect(Object.keys(LOCALE_NATIVE_NAMES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(LOCALE_NATIVE_NAMES.de).toBe('Deutsch');
    expect(LOCALE_NATIVE_NAMES['zh-CN']).toBe('简体中文');
    for (const name of Object.values(LOCALE_NATIVE_NAMES)) expect(name.trim()).not.toBe('');
  });

  it('isSupportedLocale accepts only shipped tags', () => {
    expect(isSupportedLocale('pt-BR')).toBe(true);
    expect(isSupportedLocale('pt-PT')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});

describe('RTL_LOCALES / isRtlLocale', () => {
  it('lists Arabic, Hebrew and Persian, all of them shipped', () => {
    expect(RTL_LOCALES).toEqual(['ar', 'he', 'fa']);
    for (const locale of RTL_LOCALES) expect(isSupportedLocale(locale)).toBe(true);
  });

  it('is true for RTL tags and their regional variants only', () => {
    expect(isRtlLocale('he')).toBe(true);
    expect(isRtlLocale('ar-EG')).toBe(true);
    expect(isRtlLocale('FA-IR')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
    expect(isRtlLocale('zh-CN')).toBe(false);
    expect(isRtlLocale('')).toBe(false);
  });
});
