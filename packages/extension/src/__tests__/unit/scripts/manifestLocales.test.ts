// @vitest-environment node
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@tabmerger/shared";

// wxt.config.ts reads .env files through Vite's loadEnv, and `vite` is not a direct dependency of
// this package (pnpm only links it for wxt), so the import can't resolve from here. The manifest
// fields under test don't depend on env values; the Firefox beta update_url needs a web app URL.
vi.mock("vite", () => ({ loadEnv: () => ({ VITE_WEB_APP_URL: "https://example.com" }) }));
import {
    CHROME_LOCALE_CODES,
    DEFAULT_MANIFEST_LOCALE,
    MAX_DESCRIPTION_LENGTH,
    localeFilesFor,
    manifestMessage,
    readManifestCatalogs,
    referencedMessageKeys,
    toChromeLocaleCode,
    toChromeMessages,
    type ChromeMessages,
} from "../../../../scripts/manifestLocales";

/**
 * The store-listing locales: src/locales/<lng>/manifest.json becomes _locales/<code>/messages.json
 * (scripts/manifestLocales.ts, run by wxt.config.ts's build:publicAssets hook), and the manifest's
 * description and command names point at those messages with __MSG_<key>__.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
// .../src/__tests__/unit/scripts -> .../packages/extension
const extensionRoot = path.resolve(testDir, "../../../../");
const localesDir = path.join(extensionRoot, "src", "locales");
const catalogs = readManifestCatalogs(localesDir, SUPPORTED_LOCALES);

describe("toChromeLocaleCode", () => {
    it("swaps the hyphen for an underscore", () => {
        expect(toChromeLocaleCode("pt-BR")).toBe("pt_BR");
        expect(toChromeLocaleCode("zh-CN")).toBe("zh_CN");
        expect(toChromeLocaleCode("de")).toBe("de");
    });

    it("maps every shipped locale onto a code Chrome supports", () => {
        for (const locale of SUPPORTED_LOCALES) {
            expect(CHROME_LOCALE_CODES).toContain(toChromeLocaleCode(locale));
        }
    });

    it("refuses a code Chrome does not list", () => {
        expect(() => toChromeLocaleCode("xx-YY")).toThrow(/not a Chrome _locales code/);
    });
});

describe("toChromeMessages", () => {
    it("wraps each value in Chrome's { message } shape", () => {
        expect(toChromeMessages("en", { extDescription: "Hello", commandActivate: "Go" })).toEqual({
            extDescription: { message: "Hello" },
            commandActivate: { message: "Go" },
        });
    });

    it("escapes a literal $ (Chrome reads $name$ as a placeholder)", () => {
        expect(toChromeMessages("en", { a: "Costs $5" }).a.message).toBe("Costs $$5");
    });

    it("rejects an empty, nested or non-string message", () => {
        expect(() => toChromeMessages("en", { a: "  " })).toThrow(/empty/);
        expect(() => toChromeMessages("en", { a: { b: "x" } })).toThrow(/must be a string/);
        expect(() => toChromeMessages("en", { a: 3 })).toThrow(/must be a string/);
    });

    it("rejects an i18next placeholder and an invalid message name", () => {
        expect(() => toChromeMessages("en", { a: "Hi {{name}}" })).toThrow(/placeholder/);
        expect(() => toChromeMessages("en", { "a.b": "x" })).toThrow(/not a valid message name/);
    });

    it("rejects a description over Chrome's 132-character limit", () => {
        expect(() => toChromeMessages("en", { extDescription: "x".repeat(133) })).toThrow(/133 characters/);
        expect(() => toChromeMessages("en", { extDescription: "x".repeat(132) })).not.toThrow();
    });
});

describe("localeFilesFor", () => {
    it("writes one _locales/<code>/messages.json per locale, as pretty JSON", () => {
        const files = localeFilesFor({ en: { a: "A" }, "pt-BR": { a: "Á" } });
        expect(files.map((f) => f.relativeDest)).toEqual(["_locales/en/messages.json", "_locales/pt_BR/messages.json"]);
        expect(JSON.parse(files[1].contents)).toEqual({ a: { message: "Á" } });
        expect(files[0].contents.endsWith("}\n")).toBe(true);
    });

    it("needs the default locale's catalog", () => {
        expect(() => localeFilesFor({ de: { a: "A" } })).toThrow(/default_locale/);
    });

    it("converts every shipped catalog", () => {
        const files = localeFilesFor(catalogs);
        expect(files).toHaveLength(SUPPORTED_LOCALES.length);
        expect(new Set(files.map((f) => f.relativeDest)).size).toBe(SUPPORTED_LOCALES.length);
    });
});

describe("readManifestCatalogs", () => {
    it("throws when a locale's manifest.json is missing", () => {
        expect(() => readManifestCatalogs(localesDir, ["en", "xx"])).toThrow(/ENOENT/);
    });

    it("returns one parsed catalog per requested locale, keyed by locale", () => {
        const result = readManifestCatalogs(localesDir, ["en", "pt-BR"]);
        expect(Object.keys(result)).toEqual(["en", "pt-BR"]);
        expect(typeof result["pt-BR"].extDescription).toBe("string");
    });
});

describe("toChromeMessages edge cases", () => {
    it("escapes every $ in a message and leaves other characters alone", () => {
        expect(toChromeMessages("en", { a: "$1 and $2" }).a.message).toBe("$$1 and $$2");
    });

    it("applies the 132 limit only to extDescription", () => {
        expect(() => toChromeMessages("en", { commandX: "x".repeat(200) })).not.toThrow();
    });

    it("returns an empty object for an empty catalog", () => {
        expect(toChromeMessages("en", {})).toEqual({});
    });
});

describe("manifest catalogs", () => {
    const enKeys = Object.keys(catalogs.en).sort();

    it("exists for every shipped locale, and only those", () => {
        const dirs = readdirSync(localesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
        expect(dirs.sort()).toEqual([...SUPPORTED_LOCALES].sort());
    });

    it.each(SUPPORTED_LOCALES)("%s has exactly English's keys, none empty", (locale) => {
        const catalog = catalogs[locale];
        expect(Object.keys(catalog).sort()).toEqual(enKeys);
        for (const value of Object.values(catalog)) {
            expect(typeof value).toBe("string");
            expect((value as string).trim()).not.toBe("");
        }
    });

    it.each(SUPPORTED_LOCALES)("%s extDescription fits Chrome's limit and keeps the brand names", (locale) => {
        const description = catalogs[locale].extDescription as string;
        expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
        expect(description).toContain("Pro");
    });

    it.each(SUPPORTED_LOCALES)("%s save-command names keep TabMerger untranslated", (locale) => {
        for (const [key, value] of Object.entries(catalogs[locale])) {
            if (key.startsWith("commandSave")) expect(value).toContain("TabMerger");
        }
    });
});

describe("manifestMessage / referencedMessageKeys", () => {
    it("builds and finds __MSG_ references", () => {
        expect(manifestMessage("extDescription")).toBe("__MSG_extDescription__");
        expect(referencedMessageKeys({ a: "__MSG_x__", b: [{ c: "__MSG_y__" }, "__MSG_x__"], d: "plain" })).toEqual(["x", "y"]);
    });
});

describe("wxt.config.ts manifest", () => {
    type Manifest = {
        name: string;
        default_locale?: string;
        description: string;
        commands: Record<string, { description: string }>;
    };
    type ManifestFn = (env: { mode: string; browser: string; manifestVersion: number; command: string }) => Manifest;
    let manifestFor: (mode: string, browser: string) => Manifest;
    const nodeEnv = process.env.NODE_ENV;

    beforeAll(async () => {
        // A computed path, so `tsc` (whose program is src/) doesn't pull wxt.config.ts and its
        // unlinked `vite` import into the type-check. wxt.config.ts sets NODE_ENV at load time (see
        // its resolveNodeEnv comment); keep vitest's.
        const wxtConfigPath = path.join(extensionRoot, "wxt.config.ts");
        const config = ((await import(/* @vite-ignore */ wxtConfigPath)) as { default: { manifest: ManifestFn } }).default;
        process.env.NODE_ENV = nodeEnv;
        manifestFor = (mode, browser) => config.manifest({ mode, browser, manifestVersion: 3, command: "build" });
    }, 30_000);

    afterAll(() => {
        process.env.NODE_ENV = nodeEnv;
    });

    const enMessages: ChromeMessages = toChromeMessages("en", catalogs.en);

    it.each([
        ["production", "chrome"],
        ["production", "firefox"],
        ["production", "edge"],
        ["beta", "chrome"],
        ["beta", "firefox"],
    ])("%s %s: default_locale is en and every __MSG_ reference has an English message", (mode, browser) => {
        const manifest = manifestFor(mode, browser);
        expect(manifest.default_locale).toBe(DEFAULT_MANIFEST_LOCALE);
        const keys = referencedMessageKeys(manifest);
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) expect(enMessages, key).toHaveProperty(key);
        for (const command of Object.values(manifest.commands)) expect(command.description).toMatch(/^__MSG_\w+__$/);
    });

    it("production uses the localized description; beta keeps its literal warning; the name stays literal", () => {
        const production = manifestFor("production", "chrome");
        expect(production.description).toBe("__MSG_extDescription__");
        expect(production.name).toBe("TabMerger");
        const beta = manifestFor("beta", "chrome");
        expect(beta.description).toBe("THIS EXTENSION IS FOR BETA TESTING");
        expect(beta.name).toBe("TabMerger BETA");
    });

    it("references every manifest-namespace key, so no translated message goes unused", () => {
        expect(referencedMessageKeys(manifestFor("production", "chrome")).sort()).toEqual(Object.keys(catalogs.en).sort());
    });
});
