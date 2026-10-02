---
name: wxt-node-env-mode-gotcha
description: wxt@0.20.27 sets process.env.NODE_ENV to the literal --mode string, so any non-development/non-production mode (beta, demo) silently ships React's dev bundle unless overridden
metadata:
  type: project
---

wxt@0.20.27's `dist/core/wxt.mjs` runs `process.env.NODE_ENV ??= inlineConfig.mode ?? (command === "serve" ? "development" : "production")` *before* `wxt.config.ts` is loaded. For any `--mode`/`-m` value that isn't literally "development" or "production" (e.g. "beta", "demo"), `NODE_ENV` ends up as that mode string verbatim.

Vite 6's `resolveConfig` (bundled, `dist/node/chunks/dep-*.js`, ~line 49070) computes `isProduction = process.env.NODE_ENV === "production"` and derives `import.meta.env.DEV`/`PROD` **and** esbuild's `jsxDev` flag from that boolean — not from Vite's `mode` field. So `mode: "beta"` + `NODE_ENV: "beta"` resolves `isProduction: false`, and React ships its development bundle (`jsxDEV` calls, dev warnings) into every non-"production"-mode build. This is how `wxt zip -b chrome --mode beta` (a real Chrome Web Store beta submission) was shipping dev React and exposing the DEV-gated Settings "Dev" tab to beta testers.

Separately, WXT's own `getLibModeConfig` (background/content iife entrypoints, `dist/core/builders/vite/index.mjs`) sets an explicit `define: {"process.env.NODE_ENV": JSON.stringify(wxtConfig.mode)}`, and the merge order is `vite.mergeConfig(baseConfig, entryConfig)` — entryConfig (WXT's) wins over anything a project's own `vite: () => ({...})` config sets. So overriding `define` in the user vite config does NOT fix background/content scripts; you have to reassert it in the `vite:build:extendConfig` hook, which WXT calls *after* that merge, for every entrypoint group (multi-page popup included, though popup has no competing define — the popup's dev-React bug alone is fixed by the raw `process.env.NODE_ENV` reassignment).

**Fix pattern** (see `packages/extension/wxt.config.ts` + `scripts/buildEnv.ts`):
1. At the top of `wxt.config.ts`, before `defineConfig(...)`, parse `process.argv` for `--mode`/`-m` (mirroring wxt's own `-m, --mode <mode>` CLI option and its `build`→"production"/`serve`→"development" fallback) and force-assign `process.env.NODE_ENV = mode === "development" ? "development" : "production"`. This must be a real assignment (not `??=`) since wxt's own `??=` already ran and set it to the raw mode string by the time this file's top-level code executes.
2. Add a `hooks: { "vite:build:extendConfig": (entrypoints, viteConfig) => { viteConfig.define ??= {}; viteConfig.define["process.env.NODE_ENV"] = JSON.stringify(sameResolvedValue) } }` to close the background/content lib-mode landmine too.
3. This does **not** touch WXT's own `mode` — `import.meta.env.MODE` (and everything keyed off `wxtConfig.mode`: manifest name, `externally_connectable`, `.env.<mode>` loading, zip artifact naming) is untouched and must stay "beta"/"demo".

**Verification approach**: build and grep the output for `jsxDEV` (dev React) vs plain `jsx(`/`jsxs(` (prod React) in the popup's JS chunk — `grep -ro "jsxDEV" .output/<target>/chunks/*.js | wc -l`. Don't try to verify the background/content `define` fix by grepping the built JS for `"production"`/`"beta"` literals — esbuild constant-folds `"x" !== "production"` comparisons at minify time regardless of which string wins, so the literal vanishes into `!0`/`!1` either way; the merge-order/hook-timing argument from reading WXT's source is the real proof there, not a grep.

**CLI flag gotcha**: this project's own `package.json` uses both forms — `zip:beta` uses `--mode beta` (long form) but `build:extension:demo` uses `-m demo` (short form). Any argv-parsing helper for this must handle both, or short-flag builds silently fall through to the wrong default.
