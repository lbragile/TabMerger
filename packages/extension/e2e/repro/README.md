# DnD repro runners

Ad-hoc scripts for reproducing / eyeballing **"drag never starts in the real MV3
toolbar action popup"** (fixed in `src/lib/dndPointerSensor.ts` via a
`setPointerCapture` sensor).

> Looking for the **manual click-around seed tool** (`pnpm seed:dev` — launches
> headed Chrome with realistic seeded groups and leaves it open)? See
> [`README.seed.md`](./README.seed.md).

They replace the old loose `_repro*.mjs` files at the package root — now TypeScript,
run through Playwright's own runner (no extra deps), sharing one harness.

## ⚠️ These cannot prove the fix

Playwright / CDP synthesise a clean, un-coalesced pointer stream that never
reproduced the bug. A green run here means "the pipeline works with synthetic
events", not "the real popup drags". The authoritative check is a **human drag in
the real toolbar popup** with `localStorage.tm_dnd_debug = '1'` — see
`src/lib/dndDebug.ts`.

## Prereqs

Build the extension first (dev build preferred — it mounts against `.env.local`):

```bash
pnpm --filter @tabmerger/extension exec wxt build --mode development
```

## Run

```bash
pnpm --filter @tabmerger/extension repro:dnd          # both runners
pnpm --filter @tabmerger/extension repro:dnd:popup    # single instrumented tab reorder
pnpm --filter @tabmerger/extension repro:dnd:matrix   # all 6 drag kinds, before/after IDB dump
```

## Knobs (env vars, see `settings.ts`)

| var | default | meaning |
|---|---|---|
| `REPRO_HEADED` | `0` | `1` = visible Chromium (default is `--headless=new`, still loads MV3) |
| `REPRO_DEBUG` | `1` | seed `localStorage.tm_dnd_debug` so `[tm-dnd]` stages log |
| `REPRO_KEEP_OPEN` | `0` | ms to leave the browser open after the run |
| `REPRO_CDP_PORT` | `9333` | remote debugging port the harness reconnects through |
| `REPRO_NUDGE` / `REPRO_STEPS` / `REPRO_SETTLE` | `8` / `22` / `450` | drag tuning |

```bash
REPRO_HEADED=1 REPRO_KEEP_OPEN=10000 pnpm --filter @tabmerger/extension repro:dnd:popup
```

## Files

- `settings.ts` — every tunable + the seed scenarios (composed from `../seed.ts`)
- `harness.ts` — launch context, seed IDB, open + attach to the real popup, drag/read helpers
- `popupInstrumented.repro.ts` — one tab reorder, prints the `[tm-dnd]` stage sequence
- `dndMatrix.repro.ts` — all six DnD kinds with a before/after IndexedDB dump
- `writeWindow.repro.ts` — not DnD: times a user action from the click to its IndexedDB commit (lock wait, read, write), lists who takes the groups lock at popup start, and checks whether the write survives leaving the page N ms after the click. Uses the shared fixture, so `TM_E2E_EXT_DIR` / `TM_E2E_CPU_THROTTLE` apply: `TM_E2E_EXT_DIR=.output/chrome-mv3 npx playwright test --config repro/playwright.repro.config.ts writeWindow`
- `playwright.repro.config.ts` — standalone config (`pnpm test:e2e` never picks these up); artifacts land in `e2e/test-results/repro/` (gitignored)
