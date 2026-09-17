/**
 * Repro settings — one place to tune every knob the MV3-action-popup DnD repro
 * scripts share. Imported by `harness.ts` and the `*.repro.ts` runners.
 *
 * These scripts reproduce (or fail to reproduce) "drag never starts in the real
 * toolbar action popup". See `src/lib/dndPointerSensor.ts` for the root cause and
 * `tests/popup-dnd.spec.ts` for the automated (but non-proving) regression test.
 *
 * Override any value from the shell without editing this file, e.g.
 *   REPRO_HEADED=1 REPRO_DEBUG=1 REPRO_KEEP_OPEN=8000 pnpm repro:dnd
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NOW_OPEN, WORK_GROUP, ANOTHER_GROUP } from '../seed';
import type { seedIdb } from '../helpers';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The seed-group shape `helpers.seedIdb` accepts (kept local to avoid touching seed.ts). */
export type SeedGroup = Parameters<typeof seedIdb>[1][number];

const bool = (v: string | undefined, dflt: boolean) =>
  v == null ? dflt : v === '1' || v.toLowerCase() === 'true';
const num = (v: string | undefined, dflt: number) => (v == null ? dflt : Number(v));

/** Prefer the dev build (bundled against `.env.local`, so the popup actually mounts). */
export const EXTENSION_PATH = fs.existsSync(path.resolve(here, '../../.output/chrome-mv3-dev'))
  ? path.resolve(here, '../../.output/chrome-mv3-dev')
  : path.resolve(here, '../../.output/chrome-mv3');

export const settings = {
  /** Per-page CDP endpoint the harness reconnects through to reach the popup target. */
  cdpPort: num(process.env.REPRO_CDP_PORT, 9333),
  /** `false` keeps Chromium windowless via `--headless=new` (still loads MV3). */
  headed: bool(process.env.REPRO_HEADED, false),
  /** Set `localStorage.tm_dnd_debug` before driving, so `[tm-dnd]` stages log. */
  dndDebug: bool(process.env.REPRO_DEBUG, true),
  /** ms to leave the browser open after the run (headed inspection). 0 = close now. */
  keepOpenMs: num(process.env.REPRO_KEEP_OPEN, 0),
  /** Drag tuning — the popup's PointerSensor needs >5px before it activates. */
  drag: {
    activationNudgePx: num(process.env.REPRO_NUDGE, 8),
    travelSteps: num(process.env.REPRO_STEPS, 22),
    settleMs: num(process.env.REPRO_SETTLE, 450)
  }
};

/**
 * Seed scenarios. `matrix` has two windows in "Work" + a second saved group so
 * every DnD kind (tab reorder, cross-window, window reorder, window→group,
 * tab→group, group reorder) has a target.
 */
export const scenarios = {
  matrix: [NOW_OPEN, WORK_GROUP, ANOTHER_GROUP] as SeedGroup[],
  minimal: [NOW_OPEN, WORK_GROUP] as SeedGroup[]
};

/** The group whose tabs the single-scenario runner reorders. */
export const PRIMARY_GROUP_ID = WORK_GROUP.id;
export const PRIMARY_GROUP_NAME = WORK_GROUP.name;
export const SECONDARY_GROUP_NAME = ANOTHER_GROUP.name;
