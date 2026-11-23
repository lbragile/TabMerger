// @vitest-environment node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// wxt.config.ts reads .env files through Vite's loadEnv, which can't resolve from this package
// (see manifestLocales.test.ts); the commands don't depend on env values.
vi.mock("vite", () => ({ loadEnv: () => ({ VITE_WEB_APP_URL: "https://example.com" }) }));
import { BROWSER_RESERVED_SHORTCUTS, COMMAND_SHORTCUTS, suggestedKeyFor } from "../../../../scripts/commandShortcuts";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

/**
 * The keys a manifest `suggested_key` may use (Chrome's and Firefox's commands docs): one of
 * Ctrl/Alt/Command/MacCtrl, optionally Shift, then a letter, digit, Comma or Period. Ctrl+Alt is
 * left out: it is AltGr on many keyboards, and Chrome rejects it.
 */
const VALID_KEY = /^(Ctrl|Alt|Command|MacCtrl)(\+Shift)?\+([A-Z0-9]|Comma|Period)$/;

const entries = Object.entries(COMMAND_SHORTCUTS) as [keyof typeof COMMAND_SHORTCUTS, { default: string; mac: string }][];

describe("command shortcut defaults", () => {
    it("gives each of the four save commands a default and a Mac key", () => {
        expect(entries.map(([name]) => name).sort()).toEqual(["save-current-tab", "save-other-tabs", "save-tabs-left", "save-tabs-right"]);
        for (const [, keys] of entries) {
            expect(keys.default).toMatch(VALID_KEY);
            expect(keys.mac).toMatch(VALID_KEY);
        }
    });

    it("uses Alt+Shift off the Mac and Control+Shift on it, so a Mac never gets Option keys", () => {
        for (const [, keys] of entries) {
            expect(keys.default.startsWith("Alt+Shift+")).toBe(true);
            expect(keys.mac.startsWith("MacCtrl+Shift+")).toBe(true);
        }
    });

    it("never gives two commands the same key", () => {
        expect(new Set(entries.map(([, k]) => k.default)).size).toBe(entries.length);
        expect(new Set(entries.map(([, k]) => k.mac)).size).toBe(entries.length);
    });

    it.each(["chrome", "edge", "firefox"] as const)("collides with none of %s's own shortcuts", (browser) => {
        for (const [name, keys] of entries) {
            expect(BROWSER_RESERVED_SHORTCUTS.windowsLinux[browser], `${name} ${keys.default}`).not.toContain(keys.default);
            expect(BROWSER_RESERVED_SHORTCUTS.mac[browser], `${name} ${keys.mac}`).not.toContain(keys.mac);
        }
    });

    it("keeps away from the keys Edge 158 left Not set (Ctrl+Shift+K, U, P)", () => {
        const defaults = entries.map(([, k]) => k.default);
        for (const old of ["Ctrl+Shift+K", "Ctrl+Shift+U", "Ctrl+Shift+P"]) {
            expect(defaults).not.toContain(old);
            expect(BROWSER_RESERVED_SHORTCUTS.windowsLinux.edge).toContain(old);
        }
    });

    it("suggestedKeyFor returns just the manifest's default and mac keys", () => {
        expect(suggestedKeyFor("save-tabs-left")).toEqual({ default: "Alt+Shift+Comma", mac: "MacCtrl+Shift+Comma" });
    });
});

describe("wxt.config.ts commands", () => {
    type Manifest = { commands: Record<string, { suggested_key?: { default: string; mac: string } }> };
    type ManifestFn = (env: { mode: string; browser: string; manifestVersion: number; command: string }) => Manifest;
    let manifestFor: (browser: string) => Manifest;
    const nodeEnv = process.env.NODE_ENV;

    beforeAll(async () => {
        // A computed path keeps wxt.config.ts (and its unlinked `vite` import) out of tsc's program.
        const wxtConfigPath = path.join(extensionRoot, "wxt.config.ts");
        const config = ((await import(/* @vite-ignore */ wxtConfigPath)) as { default: { manifest: ManifestFn } }).default;
        process.env.NODE_ENV = nodeEnv;
        manifestFor = (browser) => config.manifest({ mode: "production", browser, manifestVersion: 3, command: "build" });
    }, 30_000);

    afterAll(() => {
        process.env.NODE_ENV = nodeEnv;
    });

    it.each(["chrome", "edge", "firefox"])("%s: the save commands use the defaults; the popup command has none", (browser) => {
        const { commands } = manifestFor(browser);
        for (const [name, keys] of entries) expect(commands[name].suggested_key).toEqual({ default: keys.default, mac: keys.mac });
        // the browser auto-assigns at most four defaults per extension: the popup's stays unset
        expect(commands._execute_action.suggested_key).toBeUndefined();
    });
});
