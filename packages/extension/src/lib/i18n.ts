/**
 * UI copy and locale-aware formatting, on i18next. Every user-facing string comes from the
 * catalogs in src/locales/<lng>/ (English is the default and the source of the key types).
 *
 * The language is the one chosen in Settings → General → Language (`lib/localePreference.ts`), or
 * by default the browser's UI language (`chrome.i18n.getUILanguage()`), narrowed to a shipped
 * catalog (`SUPPORTED_LOCALES`), with English as the fallback for a language or key that has no
 * translation. A change applies through {@link applyLocalePreference} (components re-render
 * through `useTranslation`).
 *
 * - React components: `const { t } = useTranslation()` (react-i18next), and `<Trans>` for a
 *   sentence with markup inside. Never concatenate translated pieces.
 * - Everything else (toasts from hooks, the background script): `t` from this module.
 * - Values: `t('header.toast.freeGroupLimit', { max })` for "… up to {{max}} groups."
 * - Counts: `t('common.tabCount', { count })` picks `tabCount_one` / `tabCount_other` (and `_few`,
 *   `_many`, ... for languages that have them) with `Intl.PluralRules`.
 *
 * `initI18n` runs once, synchronously, before anything renders: popup and extension pages pass
 * every catalog (`@/locales`) and `initReactI18next`, the background script its slim catalog set
 * (`@/locales/worker`) and no module (no React there).
 */
import i18n, { type InitOptions, type Module, type ParseKeys, type Resource } from 'i18next';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '@tabmerger/shared';
// Type only: each bundle passes its own catalog set to initI18n (the popup every catalog, the
// background worker a slim set), so importing the catalogs here would put all of them in both
import type { CatalogSet } from '@/locales';
import type { Catalog } from '@/locales/en';
import { PSEUDO_LOCALE, pseudoLocalizeCatalog } from '@/lib/pseudoLocale';
import {
    onLocalePreferenceChanged,
    preferredLanguageTag,
    readLocalePreference,
    readLocalePreferenceSync,
    type LocalePreference,
} from '@/lib/localePreference';

export { i18n };

/** Any key in the English catalog (`'header.undo'`), for tables that map a code to its message. */
export type MessageKey = ParseKeys;

/** The browser's UI language, or undefined outside an extension context. */
function browserUiLanguage(): string | undefined {
    try {
        return globalThis.chrome?.i18n?.getUILanguage?.() ?? globalThis.navigator?.language;
    } catch {
        return undefined;
    }
}

/** The shipped catalog for a BCP 47 tag: the exact tag, else its language ("pt-BR" -> "pt"), else English. */
export function resolveLocale(tag: string | undefined): SupportedLocale {
    if (!tag) return DEFAULT_LOCALE;
    const normalized = tag.replace('_', '-').toLowerCase();
    const shipped = SUPPORTED_LOCALES as readonly string[];
    const exact = shipped.find((l) => l.toLowerCase() === normalized);
    if (exact && isSupportedLocale(exact)) return exact;
    const base = normalized.split('-')[0];
    const language = shipped.find((l) => l.toLowerCase() === base);
    if (isSupportedLocale(language)) return language;
    // A regional variant falls back to the shipped region of its language (pt-PT → pt-BR,
    // zh-SG → zh-CN), except Traditional Chinese: Simplified is no substitute for those readers.
    if (base === 'zh' && /-(hant|tw|hk|mo)\b/.test(normalized)) return DEFAULT_LOCALE;
    const sibling = shipped.find((l) => l.toLowerCase().split('-')[0] === base);
    return isSupportedLocale(sibling) ? sibling : DEFAULT_LOCALE;
}

/** Development builds started with VITE_PSEUDO_LOCALE=1 (`build:dev:pseudo`). Always false in a store build. */
function pseudoLocaleRequested(): boolean {
    return import.meta.env.DEV && import.meta.env.VITE_PSEUDO_LOCALE === '1';
}

/**
 * The i18next options for a browser UI language, over `catalogs`. `pseudo` (development builds
 * only, see {@link pseudoLocaleRequested}) adds that generated catalog and selects it. It is passed
 * in, not built here, so a store build (where only the plain call remains) contains no
 * pseudo-locale code.
 */
export function buildI18nOptions(
    catalogs: CatalogSet,
    uiLanguage: string | undefined,
    pseudo?: { lng: string; catalog: Catalog },
): InitOptions {
    const resources: Resource = Object.fromEntries(
        Object.entries(catalogs).map(([lng, catalog]) => [lng, { translation: catalog }]),
    );
    const supportedLngs: string[] = [...SUPPORTED_LOCALES];
    let lng: string = resolveLocale(uiLanguage);
    if (pseudo) {
        resources[pseudo.lng] = { translation: pseudo.catalog };
        supportedLngs.push(pseudo.lng);
        lng = pseudo.lng;
    }
    return {
        resources,
        lng,
        fallbackLng: DEFAULT_LOCALE,
        supportedLngs,
        defaultNS: 'translation',
        // Resources are bundled, so init finishes before this returns: nothing renders a raw key
        initAsync: false,
        // React escapes text; the background script only hands strings to browser APIs
        interpolation: { escapeValue: false },
        returnNull: false,
    };
}

/**
 * The language tag to start in: the Settings choice where one is stored (read synchronously from
 * `localStorage`, so the first render is already in it), else the browser's UI language. The
 * background worker has no `localStorage` and starts in the browser's language, then follows the
 * stored choice (`followLocalePreference` in the background script).
 */
export function initialUiLanguage(): string | undefined {
    return preferredLanguageTag(readLocalePreferenceSync(), browserUiLanguage());
}

/**
 * Initializes the shared i18next instance once with `catalogs` (`@/locales` on pages,
 * `@/locales/worker` in the background worker); later calls are no-ops.
 */
export function initI18n(catalogs: CatalogSet, ...modules: Module[]): typeof i18n {
    if (i18n.isInitialized) return i18n;
    for (const module of modules) i18n.use(module);
    // `pseudoLocaleRequested()` is a build-time constant, so a store build drops the pseudo branch
    // and, with it, every reference to lib/pseudoLocale.ts
    void i18n.init(
        pseudoLocaleRequested()
            ? buildI18nOptions(catalogs, initialUiLanguage(), {
                  lng: PSEUDO_LOCALE,
                  catalog: pseudoLocalizeCatalog(catalogs.en),
              })
            : buildI18nOptions(catalogs, initialUiLanguage()),
    );
    return i18n;
}

/**
 * Switches the UI to a language preference (`auto` = the browser's UI language) and, on a page,
 * updates `<html lang dir>` so dates and numbers follow. Resolves to true when the language
 * changed (the background script then rebuilds its menu).
 */
export async function applyLocalePreference(preference: LocalePreference): Promise<boolean> {
    const lng = resolveLocale(preferredLanguageTag(preference, browserUiLanguage()));
    if (lng === i18n.language) return false;
    await i18n.changeLanguage(lng);
    if (typeof document !== 'undefined') applyDocumentLocale();
    return true;
}

/**
 * For the background worker, which cannot read the Settings language choice synchronously: applies
 * the stored choice once read, then every later change, and calls `onLanguageChanged` each time
 * the language actually changes (to rebuild the right-click menu). `ready` settles once the stored
 * choice is applied: a handler that runs right as the worker wakes (an alarm's notification) awaits
 * it so its text is not in the browser's language. `stop` removes the listener.
 */
export function followLocalePreference(onLanguageChanged: () => void): { ready: Promise<void>; stop: () => void } {
    let changedMeanwhile = false;
    const apply = (preference: LocalePreference) =>
        applyLocalePreference(preference)
            .then((changed) => {
                if (changed) onLanguageChanged();
            })
            .catch(() => {});
    const stop = onLocalePreferenceChanged((preference) => {
        changedMeanwhile = true;
        void apply(preference);
    });
    // A change saved while the first read was in flight is newer than what that read returns
    const ready = readLocalePreference().then((preference) => (changedMeanwhile ? undefined : apply(preference)));
    return { ready, stop };
}

/** Looks up a catalog message outside React (toasts from hooks, the background script). */
export const t = i18n.t.bind(i18n) as typeof i18n.t;

/** The BCP 47 tag of the catalog in use, e.g. `en`, so dates and numbers match the copy's language. */
export function activeLocale(): string {
    return i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE;
}

/** `Date#toLocaleString` in the active locale (date and time unless `options` narrows it). */
export function formatDateTime(value: number | string | Date, options?: Intl.DateTimeFormatOptions): string {
    return new Date(value).toLocaleString(activeLocale(), options);
}

/** `Date#toLocaleDateString` in the active locale. */
export function formatDate(value: number | string | Date, options?: Intl.DateTimeFormatOptions): string {
    return new Date(value).toLocaleDateString(activeLocale(), options);
}

/** `Intl.NumberFormat` in the active locale. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(activeLocale(), options).format(value);
}

/**
 * A short relative time: "just now", "5m ago", "3h ago", "2d ago". Units are rounded down unless
 * `round` asks for the nearest whole unit.
 */
export function formatTimeAgo(ms: number, { now = Date.now(), round = false }: { now?: number; round?: boolean } = {}): string {
    const elapsed = now - ms;
    const unit = (size: number) => (round ? Math.round(elapsed / size) : Math.floor(elapsed / size));
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    if (elapsed < MIN) return t('common.time.justNow');
    if (elapsed < HOUR) return t('common.time.minutesAgo', { count: unit(MIN) });
    if (elapsed < DAY) return t('common.time.hoursAgo', { count: unit(HOUR) });
    return t('common.time.daysAgo', { count: unit(DAY) });
}

/** A list joined with "and" the way the active locale writes it: "a and b" in English. */
export function formatAndList(items: readonly string[]): string {
    return new Intl.ListFormat(activeLocale(), { type: 'conjunction', style: 'long' }).format(items);
}

/** A list joined the way the active locale writes one without "and": "a, b, c" in English. */
export function formatList(items: readonly string[]): string {
    return new Intl.ListFormat(activeLocale(), { type: 'unit', style: 'long' }).format(items);
}

/**
 * Builds an object whose properties are catalog messages read on access (`map[k]` is a string),
 * for message tables that callers index by a code. Reading lazily keeps the active language.
 */
export function lazyMessages<K extends string>(keys: Record<K, MessageKey>): Readonly<Record<K, string>> {
    const out = {} as Record<K, string>;
    for (const code of Object.keys(keys) as K[]) {
        Object.defineProperty(out, code, { enumerable: true, get: () => t(keys[code]) });
    }
    return out;
}

/** Sets `<html lang dir>` from the catalog in use (popup and extension pages). */
export function applyDocumentLocale(doc: Document = document): void {
    doc.documentElement.lang = activeLocale();
    doc.documentElement.dir = i18n.dir(activeLocale());
}
