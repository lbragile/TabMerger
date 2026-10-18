import { describe, expect, it } from 'vitest';
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, isSupportedLocale } from '../constants/locales';

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
