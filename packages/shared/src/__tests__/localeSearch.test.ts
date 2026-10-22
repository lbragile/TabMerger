import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '../constants/locales';
import { filterLocales, foldForSearch, localeNameIn } from '../constants/localeSearch';

describe('localeNameIn', () => {
  afterEach(() => vi.restoreAllMocks());

  it("names a language in the UI's language", () => {
    expect(localeNameIn('de', 'en')).toBe('German');
    expect(localeNameIn('de', 'fr')).toBe('allemand');
    expect(localeNameIn('he', 'de')).toBe('Hebräisch');
  });

  it('names zh-CN by its script, Simplified Chinese', () => {
    expect(localeNameIn('zh-CN', 'en')).toBe('Simplified Chinese');
  });

  it("is undefined for the UI's own language, which the native name already says", () => {
    expect(localeNameIn('en', 'en')).toBeUndefined();
    expect(localeNameIn('de', 'de')).toBeUndefined();
  });

  it('is undefined when Intl.DisplayNames fails', () => {
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => {
      throw new RangeError('unsupported');
    });
    expect(localeNameIn('de', 'en')).toBeUndefined();
  });
});

const search = (query: string, ui = 'en') => filterLocales(query, SUPPORTED_LOCALES, ui);

describe('foldForSearch', () => {
  it('drops diacritics and case', () => {
    expect(foldForSearch('Português')).toBe('portugues');
    expect(foldForSearch('Türkçe')).toBe('turkce');
    expect(foldForSearch('TIẾNG VIỆT')).toBe('tieng viet');
  });
});

describe('filterLocales', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns every locale, in order, for an empty or blank query', () => {
    expect(search('')).toEqual([...SUPPORTED_LOCALES]);
    expect(search('   ')).toEqual([...SUPPORTED_LOCALES]);
  });

  it('matches the native name, ignoring case and diacritics', () => {
    expect(search('עברית')).toEqual(['he']);
    expect(search('deutsch')).toEqual(['de']);
    expect(search('portugues')).toEqual(['pt-BR']);
    expect(search('turkce')).toEqual(['tr']);
    expect(search('日本')).toEqual(['ja']);
  });

  it('matches the English name', () => {
    expect(search('hebrew')).toEqual(['he']);
    expect(search('german')).toEqual(['de']);
    expect(search('persian')).toEqual(['fa']);
    expect(search('JAPANESE')).toEqual(['ja']);
  });

  it('matches the name in the UI language', () => {
    expect(search('hebräisch', 'de')).toEqual(['he']);
    expect(search('hebraisch', 'de')).toEqual(['he']);
    expect(search('allemand', 'fr')).toEqual(['de']);
  });

  it('matches codes and legacy or alternative names', () => {
    expect(search('he')).toContain('he');
    expect(search('iw')).toEqual(['he']);
    expect(search('in')).toContain('id');
    expect(search('farsi')).toEqual(['fa']);
    expect(search('zh')).toEqual(['zh-CN']);
    expect(search('chinese simplified')).toEqual(['zh-CN']);
    expect(search('pt')).toEqual(['pt-BR']);
    expect(search('brazil')).toEqual(['pt-BR']);
    expect(search('pt-br')).toEqual(['pt-BR']);
  });

  it('matches by word prefix: every query word starts some word of a name', () => {
    expect(search('heb')).toEqual(['he']);
    expect(search('port bra')).toEqual(['pt-BR']);
    expect(search('indonesia')).toEqual(['id']);
    expect(search('erman')).toEqual([]);
    expect(search('xyz')).toEqual([]);
  });

  it('keeps the original order when several match', () => {
    // Polish, Portuguese, Persian: in the list's order, whatever that is.
    expect(search('p')).toEqual(['pl', 'pt-BR', 'fa']);
    expect(filterLocales('p', ['fa', 'he', 'pt-BR', 'pl'], 'en')).toEqual(['fa', 'pt-BR', 'pl']);
  });

  it('still matches native names, codes and aliases when Intl.DisplayNames fails', () => {
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => {
      throw new RangeError('unsupported');
    });
    expect(search('hebrew')).toEqual([]);
    expect(search('עברית')).toEqual(['he']);
    expect(search('iw')).toEqual(['he']);
    expect(search('fa')).toEqual(['fa']);
  });

  it('survives a UI locale the runtime rejects', () => {
    expect(search('hebrew', 'not a locale!!')).toEqual(['he']);
  });
});
