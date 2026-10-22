import { LOCALE_NATIVE_NAMES, type SupportedLocale } from './locales';

/**
 * Extra words a language is searched by, beyond its code and its names: legacy tags (`iw` for
 * Hebrew, `in` for Indonesian), common alternative names (Farsi), and the region or script a
 * regional entry stands for (Brazil, Simplified Chinese). Lower-case, without diacritics.
 */
const LOCALE_SEARCH_ALIASES: Readonly<Partial<Record<SupportedLocale, readonly string[]>>> = {
  he: ['iw', 'ivrit'],
  id: ['in', 'bahasa'],
  fa: ['farsi', 'persian'],
  'zh-CN': ['zh', 'zh-hans', 'chinese simplified', 'simplified chinese', 'mandarin', 'zhongwen'],
  'pt-BR': ['pt', 'brazil', 'brasil', 'brazilian'],
  ja: ['nihongo'],
  ko: ['hangul', 'hanguk'],
  hi: ['hindustani'],
};

/**
 * Folds text for matching: decomposed (NFD) with combining marks removed, so "portugues" finds
 * "Português" and "turkce" finds "Türkçe", then lower-cased (`toLocaleLowerCase` with no
 * locale: the runtime's default rules, the same on both sides of a comparison).
 */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** The words of a folded term: anything that isn't a letter or a digit separates words. */
function wordsOf(term: string): string[] {
  return foldForSearch(term)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** `Intl.DisplayNames` for languages in `uiLocale`, or null where the runtime can't make one. */
function languageNames(uiLocale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language', fallback: 'none' });
  } catch {
    return null;
  }
}

/** A tag's name from `names`, or undefined when there is none (or the lookup throws). */
function nameOf(names: Intl.DisplayNames | null, tag: string): string | undefined {
  if (!names) return undefined;
  try {
    return names.of(tag) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The tag a shipped locale is named by: `zh-CN` is Simplified Chinese (the script is what the
 * catalog is in), which `Intl.DisplayNames` calls "Chinese (China)" under the region tag.
 */
const DISPLAY_TAG: Readonly<Partial<Record<SupportedLocale, string>>> = { 'zh-CN': 'zh-Hans' };

/**
 * A shipped language's name in `uiLocale` ("German", "גרמנית", "Allemand"), for a picker's
 * secondary line beside the native name. Undefined when the runtime has no name for it, or when
 * it is the native name itself (the UI's own language), so a picker shows nothing twice.
 */
export function localeNameIn(locale: SupportedLocale, uiLocale: string): string | undefined {
  const name = nameOf(languageNames(uiLocale), DISPLAY_TAG[locale] ?? locale);
  if (!name || foldForSearch(name) === foldForSearch(LOCALE_NATIVE_NAMES[locale])) return undefined;
  return name;
}

/**
 * Narrows a language picker to the languages a search matches, in their original order.
 *
 * A language is searched by its native name ("עברית", "Deutsch"), its English name ("Hebrew",
 * "German", "Persian"), its name in the UI language `uiLocale` ("Hebräisch" in German), its code
 * and base code ("pt-BR", "pt") and the aliases above ("iw", "farsi", "brazil"). Case and
 * diacritics are ignored. Matching is by word prefix: every word of the query must be the start
 * of some word in those names, so "heb" and "port bra" match, "erman" does not. A query that is
 * empty or only spaces returns every locale.
 *
 * Pure. When `Intl.DisplayNames` is missing or rejects `uiLocale`, the native name, code and
 * aliases still match.
 */
export function filterLocales(
  query: string,
  locales: readonly SupportedLocale[],
  uiLocale: string
): SupportedLocale[] {
  const queryWords = wordsOf(query);
  if (queryWords.length === 0) return [...locales];

  const english = languageNames('en');
  const ui = uiLocale === 'en' ? english : languageNames(uiLocale);

  return locales.filter((locale) => {
    const base = locale.split('-')[0];
    const terms = [
      LOCALE_NATIVE_NAMES[locale],
      locale,
      base,
      nameOf(english, locale),
      nameOf(english, base),
      nameOf(ui, locale),
      nameOf(ui, base),
      ...(LOCALE_SEARCH_ALIASES[locale] ?? []),
    ].filter((term): term is string => typeof term === 'string' && term !== '');
    const words = terms.flatMap(wordsOf);
    return queryWords.every((q) => words.some((word) => word.startsWith(q)));
  });
}
