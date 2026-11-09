/**
 * Turns the extension's `manifest` i18next namespace (`src/locales/<lng>/manifest.json`) into the
 * browser's own `_locales/<code>/messages.json` files, so the Chrome Web Store, AMO and Edge Add-ons
 * list every language the extension ships instead of English only.
 *
 * The browser stores read only `_locales` plus `default_locale` in the manifest; the react-i18next
 * catalogs the popup uses are invisible to them. `wxt.config.ts` calls `localeFilesFor()` from its
 * `build:publicAssets` hook (runs for `wxt build`, `wxt zip` and the `wxt` dev server's first
 * build), and points the manifest's `description` and command descriptions at the messages with
 * `manifestMessage()`. The generated folders exist only in the build output, never in the source
 * tree.
 *
 * Chrome's format: `{ "<key>": { "message": "..." } }`, one folder per locale, folder names with an
 * underscore instead of a hyphen (`pt-BR` -> `pt_BR`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import enManifest from "../src/locales/en/manifest.json";

/** The manifest's `default_locale`: the language a browser falls back to for a missing message. */
export const DEFAULT_MANIFEST_LOCALE = "en";

/** Chrome's longest accepted manifest `description` (the store rejects the upload above it). */
export const MAX_DESCRIPTION_LENGTH = 132;

/**
 * Every locale code Chrome accepts as a `_locales` folder name
 * (developer.chrome.com/docs/extensions/reference/api/i18n#locales). A folder Chrome doesn't know
 * is ignored by the store, so the converter refuses any code not on this list.
 */
export const CHROME_LOCALE_CODES = [
    "ar", "am", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "en_AU", "en_GB", "en_US", "es",
    "es_419", "et", "fa", "fi", "fil", "fr", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "kn",
    "ko", "lt", "lv", "ml", "mr", "ms", "nl", "no", "pl", "pt_BR", "pt_PT", "ro", "ru", "sk", "sl",
    "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "vi", "zh_CN", "zh_TW",
] as const;

/** A key of the `manifest` namespace (typed from the English file, so a typo fails `tsc`). */
export type ManifestMessageKey = keyof typeof enManifest;

/** Chrome's `messages.json` shape. */
export type ChromeMessages = Record<string, { message: string }>;

/** A file for WXT's `build:publicAssets` hook (its `GeneratedPublicFile`). */
export interface GeneratedLocaleFile {
    relativeDest: string;
    contents: string;
}

/** `manifestMessage("extDescription")` -> `"__MSG_extDescription__"`, resolved by the browser. */
export function manifestMessage(key: ManifestMessageKey): string {
    return `__MSG_${key}__`;
}

/** The message keys a manifest object references through `__MSG_<key>__`, deduplicated. */
export function referencedMessageKeys(manifest: unknown): string[] {
    const keys = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+?)__/g)].map((m) => m[1]);
    return [...new Set(keys)];
}

/**
 * The `_locales` folder name for a BCP 47 tag: `pt-BR` -> `pt_BR`, `de` -> `de`. Throws for a code
 * Chrome doesn't support, which fails the build instead of shipping a folder the store ignores.
 */
export function toChromeLocaleCode(locale: string): string {
    const code = locale.replace(/-/g, "_");
    if (!(CHROME_LOCALE_CODES as readonly string[]).includes(code)) {
        throw new Error(`manifestLocales: "${locale}" is not a Chrome _locales code (${code}).`);
    }
    return code;
}

/**
 * One locale's `manifest` catalog as Chrome's `messages.json` object. Throws on anything the
 * browser can't use: a nested or non-string value, an empty message, an i18next `{{placeholder}}`
 * (manifest messages take no arguments), or an `extDescription` over 132 characters. A literal `$`
 * is written as `$$`, since Chrome reads `$name$` as a placeholder.
 */
export function toChromeMessages(locale: string, catalog: Readonly<Record<string, unknown>>): ChromeMessages {
    const out: ChromeMessages = {};
    for (const [key, value] of Object.entries(catalog)) {
        if (!/^[A-Za-z0-9_@]+$/.test(key)) throw new Error(`manifestLocales: ${locale}.${key} is not a valid message name.`);
        if (typeof value !== "string") throw new Error(`manifestLocales: ${locale}.${key} must be a string.`);
        if (value.trim() === "") throw new Error(`manifestLocales: ${locale}.${key} is empty.`);
        if (/\{\{.*?\}\}/.test(value)) throw new Error(`manifestLocales: ${locale}.${key} has a {{placeholder}}; manifest messages take none.`);
        if (key === "extDescription" && value.length > MAX_DESCRIPTION_LENGTH) {
            throw new Error(`manifestLocales: ${locale}.extDescription is ${value.length} characters (max ${MAX_DESCRIPTION_LENGTH}).`);
        }
        out[key] = { message: value.replace(/\$/g, "$$$$") };
    }
    return out;
}

/** Every locale's `_locales/<code>/messages.json` file, in the order given. */
export function localeFilesFor(catalogs: Readonly<Record<string, Readonly<Record<string, unknown>>>>): GeneratedLocaleFile[] {
    if (!catalogs[DEFAULT_MANIFEST_LOCALE]) {
        throw new Error(`manifestLocales: no "${DEFAULT_MANIFEST_LOCALE}" catalog, the manifest's default_locale.`);
    }
    return Object.entries(catalogs).map(([locale, catalog]) => ({
        relativeDest: `_locales/${toChromeLocaleCode(locale)}/messages.json`,
        contents: `${JSON.stringify(toChromeMessages(locale, catalog), null, 2)}\n`,
    }));
}

/** Reads `<localesDir>/<lng>/manifest.json` for each locale (a missing file throws, failing the build). */
export function readManifestCatalogs(localesDir: string, locales: readonly string[]): Record<string, Record<string, unknown>> {
    return Object.fromEntries(
        locales.map((locale) => [locale, JSON.parse(readFileSync(path.join(localesDir, locale, "manifest.json"), "utf8")) as Record<string, unknown>]),
    );
}
