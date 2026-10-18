import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '@tabmerger/shared';

/**
 * The language chosen in Settings → General → Language: a shipped locale, or `auto` to follow the
 * browser's UI language. Per device and never synced (it is not part of AppSettings).
 *
 * It is stored twice, because its two readers cannot share one store:
 * - `localStorage` ({@link LOCALE_PREFERENCE_LOCAL_STORAGE_KEY}): read synchronously when an
 *   extension page starts, so i18next initializes in the chosen language and nothing is drawn in
 *   the browser's language first (IndexedDB and `chrome.storage` are async).
 * - `chrome.storage.local` ({@link LOCALE_PREFERENCE_STORAGE_KEY}): the background service worker
 *   has no `localStorage`; it reads this at start and follows `storage.onChanged`, so the
 *   right-click menu and notifications switch too.
 *
 * Both values are untrusted input (anything with access to the extension's storage could write
 * them): every read goes through {@link normalizeLocalePreference}, which falls back to `auto`.
 */

export const LOCALE_PREFERENCE_AUTO = 'auto';

export type LocalePreference = SupportedLocale | typeof LOCALE_PREFERENCE_AUTO;

/** Key in the extension origin's `localStorage` (shared by the popup and every extension page). */
export const LOCALE_PREFERENCE_LOCAL_STORAGE_KEY = 'tabmerger-locale';

/** Key in `chrome.storage.local`, for the background worker. */
export const LOCALE_PREFERENCE_STORAGE_KEY = 'tm_locale';

/** A stored value narrowed to a preference: a shipped locale, else `auto`. */
export function normalizeLocalePreference(value: unknown): LocalePreference {
  return isSupportedLocale(value) ? value : LOCALE_PREFERENCE_AUTO;
}

/**
 * The language tag to resolve for a preference: the chosen locale, or the browser's UI language
 * for `auto` (resolved to a shipped catalog by `resolveLocale`).
 */
export function preferredLanguageTag(preference: LocalePreference, browserLanguage: string | undefined): string | undefined {
  return preference === LOCALE_PREFERENCE_AUTO ? browserLanguage : preference;
}

/** The preference from `localStorage`, synchronously; `auto` where there is none (the background worker, tests). */
export function readLocalePreferenceSync(): LocalePreference {
  try {
    return normalizeLocalePreference(globalThis.localStorage?.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY));
  } catch {
    // storage blocked or unavailable
    return LOCALE_PREFERENCE_AUTO;
  }
}

/** The preference from `chrome.storage.local`; `auto` when unset, invalid or unreadable. */
export async function readLocalePreference(): Promise<LocalePreference> {
  try {
    const stored = await globalThis.chrome?.storage?.local?.get(LOCALE_PREFERENCE_STORAGE_KEY);
    return normalizeLocalePreference(stored?.[LOCALE_PREFERENCE_STORAGE_KEY]);
  } catch {
    return LOCALE_PREFERENCE_AUTO;
  }
}

/** Mirrors a preference into `localStorage` (`auto` removes the key). */
function writeLocalePreferenceSync(preference: LocalePreference): void {
  try {
    if (preference === LOCALE_PREFERENCE_AUTO) globalThis.localStorage?.removeItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY);
    else globalThis.localStorage?.setItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY, preference);
  } catch {
    // storage blocked: the next page start falls back to the browser's language
  }
}

/** Stores a preference in both places (`auto` removes it). */
export async function saveLocalePreference(value: LocalePreference): Promise<void> {
  const preference = normalizeLocalePreference(value);
  writeLocalePreferenceSync(preference);
  const local = globalThis.chrome?.storage?.local;
  if (!local) return;
  if (preference === LOCALE_PREFERENCE_AUTO) await local.remove(LOCALE_PREFERENCE_STORAGE_KEY);
  else await local.set({ [LOCALE_PREFERENCE_STORAGE_KEY]: preference });
}

/**
 * Brings `localStorage` in line with `chrome.storage.local` (the copy the background follows) and
 * returns the stored preference when the page started with a different one, else null. Covers a
 * page whose `localStorage` was cleared while the extension's storage was not.
 */
export async function reconcileLocalePreference(): Promise<LocalePreference | null> {
  if (!globalThis.chrome?.storage?.local) return null;
  const stored = await readLocalePreference();
  if (stored === readLocalePreferenceSync()) return null;
  writeLocalePreferenceSync(stored);
  return stored;
}

/**
 * Calls `onChange` with the new preference whenever it is saved (from any extension page).
 * Returns the unsubscribe function. For the background worker, which has no `localStorage`.
 */
export function onLocalePreferenceChanged(onChange: (preference: LocalePreference) => void): () => void {
  const events = globalThis.chrome?.storage?.onChanged;
  if (!events) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(LOCALE_PREFERENCE_STORAGE_KEY in changes)) return;
    onChange(normalizeLocalePreference(changes[LOCALE_PREFERENCE_STORAGE_KEY].newValue));
  };
  events.addListener(listener);
  return () => events.removeListener(listener);
}

/**
 * What a language picker offers, in order: the browser's language first, then every shipped one.
 * A function, not a constant: this module is reached from the i18n setup that every test file
 * loads, and a module-scope read of `@tabmerger/shared` breaks tests that mock that package.
 */
export function localePreferenceChoices(): readonly LocalePreference[] {
  return [LOCALE_PREFERENCE_AUTO, ...SUPPORTED_LOCALES];
}

/** A choice as a picker shows it: `autoLabel` (translated) for `auto`, else the language's own name. */
export function localePreferenceLabel(preference: LocalePreference, autoLabel: string): string {
  return preference === LOCALE_PREFERENCE_AUTO ? autoLabel : LOCALE_NATIVE_NAMES[preference];
}
