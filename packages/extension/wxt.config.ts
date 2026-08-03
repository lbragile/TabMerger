import { defineConfig } from "wxt";
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
    manifest: {
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
        web_accessible_resources: [
            { resources: ["images/*"], matches: ["<all_urls>"] },
        ],
        browser_specific_settings: {
            gecko: {
                id: "tabmerger@lbragile.com",
                strict_min_version: "109.0",
            },
        },
        version: "2.9.0",
    },
    dev: {
        server: { port: 3001 },
    },
    webExt: {
        chromiumArgs: ["--user-data-dir=.wxt/chrome-data", "--no-first-run"],
        startUrls: ["about:blank"],
    },
});
