/**
 * Thin wrapper over `playwright.seed.config.ts` that forces wipe mode by setting
 * `SEED_WIPE=1` before the test workers spawn (they inherit `process.env`).
 * Exists so `pnpm seed:dev:wipe` works cross-platform without a `cross-env` dep —
 * you can't reliably prefix `SEED_WIPE=1` on PowerShell.
 */
process.env.SEED_WIPE = '1';

export { default } from './playwright.seed.config';
