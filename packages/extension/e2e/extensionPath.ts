import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Which built extension every e2e file loads. ONE resolver, so the whole suite (the shared
 * fixture and the specs that launch their own browser for the real toolbar popup) always runs
 * against the same build.
 *
 * Default: prefer a dev-mode build (`wxt build -m development`, `.output/chrome-mv3-dev`) when
 * present, because it is bundled against `.env.local` (a valid local Supabase URL). Otherwise
 * the production build `.output/chrome-mv3`, which is the only one CI has.
 *
 * `TM_E2E_EXT_DIR` overrides the choice, so a local run can exercise the same PRODUCTION-mode
 * build CI does (timing-dependent failures only show up there):
 *   TM_E2E_EXT_DIR=.output/chrome-mv3 pnpm --filter @tabmerger/extension test:e2e
 * Relative paths resolve against the extension package root. A folder with no built extension
 * fails loudly instead of silently falling back to another build.
 */
function resolveExtensionPath(): string {
  const override = process.env.TM_E2E_EXT_DIR?.trim();
  if (override) {
    const dir = path.resolve(here, '..', override);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      throw new Error(`TM_E2E_EXT_DIR: no built extension (manifest.json) in ${dir}`);
    }
    return dir;
  }
  const devBuild = path.resolve(here, '../.output/chrome-mv3-dev');
  return fs.existsSync(devBuild) ? devBuild : path.resolve(here, '../.output/chrome-mv3');
}

export const EXTENSION_PATH = resolveExtensionPath();

/**
 * CPU slowdown factor for popup pages (CDP `Emulation.setCPUThrottlingRate`), from
 * `TM_E2E_CPU_THROTTLE`. Unset or below 2 = no throttling. Makes a slow CI runner's timing
 * visible locally, e.g. `TM_E2E_CPU_THROTTLE=4`.
 */
export const CPU_THROTTLE_RATE = Number(process.env.TM_E2E_CPU_THROTTLE ?? 0);

/**
 * Extra Chromium flags from the environment. `TM_E2E_OFFLINE=1`: nothing but loopback resolves,
 * so a build with real endpoints baked in (an old store build loaded for a comparison) cannot
 * reach them.
 */
export const EXTRA_CHROMIUM_ARGS: string[] =
  process.env.TM_E2E_OFFLINE === '1' ? ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] : [];
