# `seed:dev` — manual DnD click-around tool

One command that launches **real Chrome, headed**, with the built dev extension
loaded, seeds the extension's IndexedDB with realistic groups / windows / tabs,
opens the popup, and then leaves the browser open until you close it (or
`Ctrl+C`). Built for exercising drag-and-drop by hand.

> **Headed on purpose.** The repo's standing preference is headless for all
> automation. This tool is the deliberate exception — it exists to be clicked
> around in. `HEADLESS=1` is honoured for parity but defeats the point.

## Commands

```bash
pnpm --filter @tabmerger/extension seed:dev          # build dev ext, append realistic saved groups, open popup, stay open
pnpm --filter @tabmerger/extension seed:dev:wipe     # same, but REPLACE existing saved groups first
pnpm --filter @tabmerger/extension seed:dev:reset    # delete the persistent profile (full clear)
pnpm --filter @tabmerger/extension build:dev         # just rebuild .output/chrome-mv3-dev (self-contained)
```

**One command is all you need** — `seed:dev` runs `wxt build --mode development`
itself before launching.

### Which build it uses (and why the popup was blank)

The tool loads **only** `.output/chrome-mv3-dev` produced by
`wxt build --mode development` (the `build:dev` script). It hard-refuses anything
else, with the exact fix printed:

| Build | Why it's rejected |
|---|---|
| `.output/chrome-mv3` (production, `pnpm build`) | popup renders **blank** — `.env.production` ships placeholder `VITE_SUPABASE_URL`, which throws in `@supabase/supabase-js` at import time |
| dev-**server** build (`pnpm dev:extension` / `wxt`) | its `popup.html` loads scripts from `http://localhost:3001`, so it's **blank** unless that HMR server is running |
| a **stale** dev build | older than the newest file in `src/` — you'd be testing old code |

`build:dev` writes a **self-contained** dev build (real keys from `.env.local`,
name "TabMerger DEV") that works with no server running.

## What gets seeded (defaults)

- The permanent **"Now Open"** group (index 0) is **preserved / never duplicated**.
  On first run it's synthesised if missing; once the popup mounts it syncs to your
  real browser tabs as usual.
- **4 saved groups** after it — `Work`, `Reading List`, `Research`, `Side Project`
  (names + preset rgba colours cycle from a pool of 12 / 10).
- **1–3 windows per group**, **3–8 tabs per window** (varied deterministically).
- ~23 tabs total, each with a real-looking title / URL / per-domain favicon /
  preview image — GitHub, MDN, Stack Overflow, Hacker News, YouTube, TypeScript /
  Tailwind / Vite / Postgres / Rust docs, Reddit, Notion, Linear, Figma, Gmail,
  AWS, Stripe, …
- Saved tabs use the `id: 0` sentinel + a `savedAt` timestamp, matching the real
  save path.

Enough spread to exercise every DnD case: reorder tab within a window, tab across
windows, window reorder, window → another group, tab → another group, group
reorder, and multi-select.

## The popup

The tool opens the **real toolbar action popup** via `chrome.action.openPopup()`.
If that doesn't surface a page (some headless / OS combos) or it comes up empty,
it **falls back to opening `chrome-extension://<id>/popup.html` in a normal tab**
so you always get a visible, usable popup — the console line tells you which you
got (`popup: action-popup — rendered ✓` vs `popup: tab — rendered ✓`).

If the popup renders blank even as a tab, the run prints the page's console /
`pageerror` output and the `build:dev` fix — that means a broken bundle, not a
problem with this tool.

## Knobs (env vars)

| var | default | meaning |
|---|---|---|
| `SEED_GROUPS` | `4` | number of saved groups to build (clamped 1–12) |
| `SEED_WINDOWS` | `2` | windows per group — upper bound when `SEED_VARY=1` (clamped 1–5) |
| `SEED_TABS` | `5` | tabs per window — upper bound when `SEED_VARY=1` (clamped 1–12) |
| `SEED_VARY` | `1` | `1` = vary per-group/window counts for realism; `0` = exact uniform counts |
| `SEED_WIPE` | `0` | `1` = replace existing saved groups instead of appending (or use `seed:dev:wipe`) |
| `HEADLESS` | `0` | `1` = run windowless (`--headless=new`); still loads MV3 |
| `SEED_OPEN_MS` | `0` | auto-close after N ms instead of waiting for you to close Chrome |
| `SEED_CDP_PORT` | `9444` | remote-debugging port used to attach to the popup target |

Env-var syntax is shell-specific: `SEED_GROUPS=6 pnpm …` (bash) /
`$env:SEED_GROUPS=6; pnpm …` (PowerShell). `seed:dev:wipe` exists so wipe mode
needs no env prefix.

```bash
SEED_GROUPS=6 SEED_WINDOWS=3 SEED_TABS=8 pnpm --filter @tabmerger/extension seed:dev
SEED_VARY=0 SEED_GROUPS=3 pnpm --filter @tabmerger/extension seed:dev   # exactly 3×2×5
```

## Persistence & clearing seeded data

The browser runs against a **persistent user-data-dir** at
`e2e/test-results/seed-profile/` (gitignored). Seeded data + the unpacked
extension ID survive close / reopen, so `seed:dev:wipe` and `--append` are
meaningful across runs.

To clear:

- `pnpm --filter @tabmerger/extension seed:dev:reset` — deletes the profile dir
  (nukes seeded groups, settings, auth, everything), **or**
- `pnpm --filter @tabmerger/extension seed:dev:wipe` — keeps the profile but
  replaces the saved groups with a fresh seed, **or**
- delete `packages/extension/e2e/test-results/seed-profile/` by hand.

## Not part of the test run

`seedDev.ts` has its own `playwright.seed.config.ts` whose `testMatch` only picks
up that one file. `pnpm test`, `pnpm test:e2e`, and `pnpm repro:dnd`
(`*.repro.ts`) never run it. Artifacts land under the already-gitignored
`e2e/test-results/`.

## Files

- `seedData.ts` — pure, deterministic seed-data builder (`buildSeedGroups`,
  `resolveSeedConfig`). Unit-tested at `src/__tests__/unit/repro/seedData.test.ts`.
- `seedDev.ts` — the Playwright runner: validate the dev build (reject
  prod / dev-server / stale), launch headed persistent Chrome, write IDB, open the
  popup (action-popup, else tab fallback), verify it rendered, wait for close.
- `playwright.seed.config.ts` / `playwright.seed.wipe.config.ts` — standalone
  configs (the `.wipe` one just sets `SEED_WIPE=1` before workers spawn).
