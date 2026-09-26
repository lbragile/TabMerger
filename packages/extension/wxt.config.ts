import { defineConfig } from "wxt";
import { loadEnv } from "vite";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import tailwindcss from "@tailwindcss/vite";
import { resolveManifestVersion } from "./scripts/manifestVersion";
import { resolveNodeEnv, resolveWxtModeFromArgv } from "./scripts/buildEnv";
import pkg from "./package.json";

function getExtensionName(mode: string): string {
    if (mode === "beta") return "TabMerger BETA";
    if (mode === "development") return "TabMerger DEV";
    return "TabMerger";
}

// ponytail: wxt@0.20.27's dist/core/wxt.mjs does
// `process.env.NODE_ENV ??= inlineConfig.mode ?? (command === "serve" ? "development" : "production")`
// BEFORE this file is loaded — so for any non-"production" mode (beta, demo),
// NODE_ENV becomes that literal mode string. Vite's own resolveConfig computes
// `isProduction = process.env.NODE_ENV === "production"` and derives
// `import.meta.env.DEV`/`PROD` AND esbuild's `jsxDev` flag from THAT boolean,
// not from Vite's `mode` field — confirmed by reading vite@6's bundled
// dist/node/chunks/dep-*.js (`resolveConfig`, ~line 49070). Left alone, every
// non-production wxt mode ships React's development bundle (jsxDEV calls),
// which is how `wxt zip -b chrome --mode beta` (publish.yml's store beta job)
// was shipping a dev build of React to the Chrome Web Store beta channel.
// Fix: derive the mode the same way wxt's CLI does (from argv, since this
// file's top-level code runs before wxt's own config resolution touches
// process.env.NODE_ENV) and force NODE_ENV to a real "development"/"production"
// value ourselves, before any vite.build()/createServer() call can read it.
// This does NOT touch wxt's own `mode` (import.meta.env.MODE stays
// "beta"/"demo" — see the `manifest`/`zip` config below, both of which key off
// `mode`/argv directly and are unaffected).
const cliWxtMode = resolveWxtModeFromArgv(process.argv);
process.env.NODE_ENV = resolveNodeEnv(cliWxtMode);

export default defineConfig({
    srcDir: "src",
    publicDir: "src/public",
    modules: ["@wxt-dev/module-react"], // HMR enabled by default — popup React components hot-reload via Fast Refresh; background/content scripts auto-reload on save
    vite: () => ({
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "src"),
            },
        },
        // ponytail: only loaded when ANALYZE=true, zero cost in normal builds
        plugins: [
            tailwindcss(),
            ...(process.env.ANALYZE
                ? [visualizer({ open: true, filename: "bundle-stats.html" })]
                : []),
        ],
    }),
    manifestVersion: 3,
    // ponytail: manifest as a fn instead of an object so we can call Vite's own
    // loadEnv() here. WXT never copies .env*/.env.local values into process.env
    // for wxt.config.ts (confirmed by reading node_modules/wxt/dist/core/utils/env.mjs
    // — it parses the files but the result is discarded, never assigned to process.env)
    // — that's only done for import.meta.env inside app code via Vite's bundler. Reading
    // bare process.env.CHROME_EXTENSION_ID/VITE_WEB_APP_URL here silently no-ops unless
    // those are real shell-exported vars, which they never were in either local dev or CI
    // — this is why externally_connectable was empty in every build, not just prod.
    manifest: ({ mode }) => {
        const env = loadEnv(mode, process.cwd(), "");
        const isBeta = mode === "beta";
        // ponytail: manifest.version can't just be package.json's version — semantic-release
        // never bumps it (no @semantic-release/npm plugin; per release-and-beta-channel-spec.md
        // §8, git tags are the sole source of truth for the released version), and a beta
        // version string like "2.2.0-beta.3" isn't valid MV3 syntax at all (1-4 dot-separated
        // integers only). CI's publish.yml build job resolves the real version from the git tag
        // (`GITHUB_REF_NAME`) and must export it as TABMERGER_MANIFEST_VERSION before running
        // `wxt zip` for a store submission — see scripts/manifestVersion.ts for the mapping.
        // Falls back to package.json's version for local/dev builds and any CI step that never
        // zips for a store (nothing downstream reads manifest.version in that case).
        const { version, version_name } = resolveManifestVersion(
            process.env.TABMERGER_MANIFEST_VERSION ?? pkg.version,
        );
        return {
            name: getExtensionName(mode),
            description: isBeta
                ? "THIS EXTENSION IS FOR BETA TESTING"
                : "Stop drowning in tabs. Save, group, and restore every window in one place.",
            incognito: "spanning",
            permissions: [
                "tabs",
                "tabGroups",
                "storage",
                "contextMenus",
                "alarms",
                "notifications",
                "identity",
            ],
            // No host_permissions of any kind (required or optional) — Tab Preview's
            // OG-image read goes through the web app's server-side scraper
            // (packages/web/app/api/og-preview) instead of in-page script injection,
            // keeping the extension out of Chrome Web Store's elevated review tier
            // for "reads/changes all your data on every site you visit".
            icons: {
                16: "/icon/16.png",
                32: "/icon/32.png",
                48: "/icon/48.png",
                96: "/icon/96.png",
                128: "/icon/128.png",
            },
            action: { default_popup: "popup.html" },
            // commands don't need their own permission entry — the manifest key is enough.
            // _execute_action is reserved by Chrome to open the popup — no onCommand listener
            // needed for it, Chrome handles the popup toggle itself. Chrome caps auto-assigned
            // suggested_key bindings at 4 commands total across the whole extension (confirmed:
            // a 5th suggested_key throws "Too many shortcuts specified" at build/load) — the four
            // save-* commands get the defaults since they're the higher-value shortcuts, and
            // _execute_action is left without a suggested_key so it still appears in
            // chrome://extensions/shortcuts for the user to bind manually if they want one.
            // Ctrl+Shift+M and Ctrl+Shift+O are Chrome's own reserved shortcuts (profile switcher,
            // bookmark manager) — Chrome silently leaves those bindings blank instead of erroring,
            // so avoid any letter in Chrome's reserved list (B/D/G/I/J/M/N/O/Q/R/T/W/A). Ctrl+Shift+K
            // was confirmed working live; S/U/P below are unreserved by Chrome (a locally-installed
            // extension could still grab one — rebind manually at chrome://extensions/shortcuts if so).
            commands: {
                _execute_action: {
                    description: "Activate the extension",
                },
                "save-current-tab": {
                    suggested_key: {
                        default: "Ctrl+Shift+S",
                        mac: "Command+Shift+S",
                    },
                    description: "Save the current tab to TabMerger",
                },
                "save-tabs-left": {
                    suggested_key: {
                        default: "Ctrl+Shift+K",
                        mac: "Command+Shift+K",
                    },
                    description: "Save tabs to the left of TabMerger",
                },
                "save-tabs-right": {
                    suggested_key: {
                        default: "Ctrl+Shift+U",
                        mac: "Command+Shift+U",
                    },
                    description: "Save tabs to the right to TabMerger",
                },
                "save-other-tabs": {
                    suggested_key: {
                        default: "Ctrl+Shift+P",
                        mac: "Command+Shift+P",
                    },
                    description: "Save all other tabs to TabMerger",
                },
            },
            // Lets the web app probe install status on demand via chrome.runtime.sendMessage
            // (no page-load race, unlike the content-script postMessage broadcast below).
            // CHROME_EXTENSION_ID is the published Chrome Web Store ID (unset until first
            // publish — see docs/PUBLISHING.md); the dev ID is fixed for this repo's unpacked
            // build path. ponytail: filter(Boolean) so an unset published ID doesn't ship as "".
            externally_connectable: {
                matches: env.VITE_WEB_APP_URL
                    ? [`${env.VITE_WEB_APP_URL}/*`]
                    : [],
                ids: [
                    isBeta
                        ? env.CHROME_EXTENSION_ID_BETA
                        : env.CHROME_EXTENSION_ID,
                    "ogadhgghhdbaohdcajfakeogcamicdkm",
                ].filter((id): id is string => Boolean(id)),
            },
            browser_specific_settings: {
                gecko: {
                    id: "tabmerger@lbragile.com",
                    strict_min_version: "109.0",
                },
            },
            version,
            ...(version_name ? { version_name } : {}),
        };
    },
    dev: {
        server: { port: 3001 },
    },
    // ponytail: zip config is a static object (not a per-mode callback like
    // `manifest`), so mode is read straight off argv here at config-load time
    // — same process as the `wxt zip -b chrome --mode beta` CLI invocation.
    // Only override the filename for non-default modes so beta builds don't
    // overwrite prod zips in .output/; prod keeps WXT's default
    // '{{name}}-{{version}}-{{browser}}.zip' template — CI's publish.yml
    // references that exact path.
    zip: (() => {
        const modeFlagIndex = process.argv.indexOf("--mode");
        const mode = modeFlagIndex !== -1 ? process.argv[modeFlagIndex + 1] : "production";
        return mode === "production"
            ? {}
            : { artifactTemplate: "{{name}}-{{mode}}-{{version}}-{{browser}}.zip" };
    })(),
    webExt: {
        chromiumArgs: ["--user-data-dir=.wxt/chrome-data", "--no-first-run"],
        startUrls: ["about:blank"],
    },
    hooks: {
        // ponytail: background/content scripts build in Vite "lib mode"
        // (wxt's getLibModeConfig), which sets its own
        // `define: { "process.env.NODE_ENV": JSON.stringify(wxtConfig.mode) }`
        // — and since wxt merges as `mergeConfig(baseConfig, entryConfig)`
        // (entryConfig second/winning — confirmed by reading
        // dist/core/builders/vite/index.mjs's `build()` method), that
        // literal-mode-string define wins over whatever this file's `vite()`
        // config sets, REGARDLESS of the process.env.NODE_ENV fix above. Not
        // independently confirmable by grepping built output: esbuild
        // constant-folds `"<literal>" !== "production"` comparisons at
        // minify time either way, so the source string disappears into
        // `!0`/`!1` whether the define says "beta" or "production" — this is
        // a source-reading proof, not a build-grep one. `vite:build:extendConfig`
        // runs after that merge for every entrypoint group (popup's
        // multi-page config included, though it has no competing define), so
        // re-asserting it here last is what actually wins for every
        // entrypoint, not just the popup.
        "vite:build:extendConfig": (_entrypoints, viteConfig) => {
            viteConfig.define ??= {};
            viteConfig.define["process.env.NODE_ENV"] = JSON.stringify(resolveNodeEnv(cliWxtMode));
        },
    },
});
