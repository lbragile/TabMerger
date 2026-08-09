import { defineConfig } from "wxt";
import { loadEnv } from "vite";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import tailwindcss from "@tailwindcss/vite";

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
            ...(process.env.ANALYZE ? [visualizer({ open: true, filename: "bundle-stats.html" })] : []),
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
        return {
        name: "TabMerger",
        description:
            "Stop drowning in tabs. Save, group, and restore every window — with AI that organises the chaos for you.",
        incognito: "spanning",
        permissions: ["tabs", "tabGroups", "storage", "contextMenus", "alarms", "notifications", "identity"],
        host_permissions: ["<all_urls>"],
        icons: {
            16: '/icon/16.png',
            32: '/icon/32.png',
            48: '/icon/48.png',
            96: '/icon/96.png',
            128: '/icon/128.png',
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
            "_execute_action": {
                description: "Activate the extension",
            },
            "save-current-tab": {
                suggested_key: { default: "Ctrl+Shift+S", mac: "Command+Shift+S" },
                description: "Save the current tab to TabMerger",
            },
            "save-tabs-left": {
                suggested_key: { default: "Ctrl+Shift+K", mac: "Command+Shift+K" },
                description: "Save tabs to the left of TabMerger",
            },
            "save-tabs-right": {
                suggested_key: { default: "Ctrl+Shift+U", mac: "Command+Shift+U" },
                description: "Save tabs to the right to TabMerger",
            },
            "save-other-tabs": {
                suggested_key: { default: "Ctrl+Shift+P", mac: "Command+Shift+P" },
                description: "Save all other tabs to TabMerger",
            },
        },
        web_accessible_resources: [
            { resources: ["images/*"], matches: ["<all_urls>"] },
        ],
        // Lets the web app probe install status on demand via chrome.runtime.sendMessage
        // (no page-load race, unlike the content-script postMessage broadcast below).
        // CHROME_EXTENSION_ID is the published Chrome Web Store ID (unset until first
        // publish — see docs/PUBLISHING.md); the dev ID is fixed for this repo's unpacked
        // build path. ponytail: filter(Boolean) so an unset published ID doesn't ship as "".
        externally_connectable: {
            matches: env.VITE_WEB_APP_URL ? [`${env.VITE_WEB_APP_URL}/*`] : [],
            ids: [env.CHROME_EXTENSION_ID, "ogadhgghhdbaohdcajfakeogcamicdkm"].filter(
                (id): id is string => Boolean(id)
            ),
        },
        browser_specific_settings: {
            gecko: {
                id: "tabmerger@lbragile.com",
                strict_min_version: "109.0",
            },
        },
        version: "2.9.0",
        };
    },
    dev: {
        server: { port: 3001 },
    },
    webExt: {
        chromiumArgs: ["--user-data-dir=.wxt/chrome-data", "--no-first-run"],
        startUrls: ["about:blank"],
    },
});
