/**
 * Resolves the Node/Vite `NODE_ENV` that a `wxt build`/`wxt zip`/`wxt` (dev
 * server) invocation should run under, independent of WXT's own `mode`.
 *
 * Why this exists (wxt@0.20.27, verified by reading its bundled source):
 *   - `dist/core/wxt.mjs` does `process.env.NODE_ENV ??= inlineConfig.mode ??
 *     (command === "serve" ? "development" : "production")` *before*
 *     `wxt.config.ts` is loaded. For any mode other than "development" or
 *     "production" (e.g. "beta", "demo"), NODE_ENV ends up as that literal
 *     mode string.
 *   - Vite's own `resolveConfig` (dist/node/chunks/dep-*.js) computes
 *     `isProduction = process.env.NODE_ENV === "production"` and derives
 *     `import.meta.env.DEV`/`PROD` AND esbuild's `jsxDev` flag straight from
 *     that boolean — NOT from Vite's `mode` config field. So `mode: "beta"`
 *     with `NODE_ENV: "beta"` silently resolves `isProduction: false`,
 *     shipping React's development bundle (jsxDEV calls, verbose warnings)
 *     into every non-"production"-mode build, including Chrome Web Store
 *     beta submissions built via `wxt zip -b chrome --mode beta`.
 *
 * `import.meta.env.MODE` is a *different* field (`resolved.env.MODE = mode`,
 * wired from WXT's `wxtConfig.mode`) and must keep reflecting "beta"/"demo" —
 * that's what the manifest name, `externally_connectable`, the zip artifact
 * name, and `.env.<mode>` loading all key off. This helper only touches
 * NODE_ENV/isProduction, never WXT's `mode`.
 */

/** wxt's own fallback map (`dist/core/resolve-config.mjs`'s `COMMAND_MODES`) for when no `--mode`/`-m` flag is given. */
const COMMAND_MODE_FALLBACK = {
  serve: 'development',
  build: 'production',
} as const;

/**
 * Maps a resolved WXT mode to the NODE_ENV value that should back it.
 * Every mode except "development" must produce a production build — mode
 * strings like "beta" or "demo" are not valid NODE_ENV values as far as Vite
 * or React are concerned, so anything that isn't "development" collapses to
 * "production" here.
 */
export function resolveNodeEnv(mode: string): 'development' | 'production' {
  return mode === 'development' ? 'development' : 'production';
}

/** Extracts the `--mode`/`-m` CLI flag value, mirroring wxt's own `-m, --mode <mode>` CLI option (both forms are accepted by wxt's CLI, e.g. `package.json`'s `build:extension:demo` uses `-m demo`). */
export function getCliModeFlag(argv: readonly string[]): string | undefined {
  for (const flag of ['--mode', '-m']) {
    const index = argv.indexOf(flag);
    if (index !== -1 && argv[index + 1]) return argv[index + 1];
  }
  return undefined;
}

/**
 * True for the wxt dev server invocation (`wxt` / `wxt <root>`, no
 * "build"/"zip" subcommand) — mirrors wxt's own command resolution, where
 * anything other than the `build`/`zip` subcommands is the `serve` command.
 */
export function isServeCommand(argv: readonly string[]): boolean {
  return !argv.includes('build') && !argv.includes('zip');
}

/**
 * Replicates wxt's `inlineConfig.mode ?? COMMAND_MODES[command]` fallback
 * (`dist/core/resolve-config.mjs`) purely from `process.argv`, so it can run
 * at the very top of `wxt.config.ts` — before wxt's own config resolution
 * (and therefore before anything reads `process.env.NODE_ENV` for real).
 */
export function resolveWxtModeFromArgv(argv: readonly string[]): string {
  return (
    getCliModeFlag(argv) ??
    (isServeCommand(argv) ? COMMAND_MODE_FALLBACK.serve : COMMAND_MODE_FALLBACK.build)
  );
}
