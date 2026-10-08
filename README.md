# TabMerger

[![CI](https://img.shields.io/github/actions/workflow/status/lbragile/TabMerger/ci.yml?branch=main&label=CI&style=flat-square&logo=github)](https://github.com/lbragile/TabMerger/actions)

|  | <img src="docs/assets/browsers/chrome.svg" width="28" height="28" alt="Chrome Web Store" title="Chrome Web Store"><br><sub>Chrome</sub> | <img src="docs/assets/browsers/firefox.svg" width="28" height="28" alt="Firefox Add-ons" title="Firefox Add-ons"><br><sub>Firefox</sub> | <img src="docs/assets/browsers/edge.svg" width="28" height="28" alt="Microsoft Edge Add-ons" title="Microsoft Edge Add-ons"><br><sub>Edge</sub> |
| :-- | :-: | :-: | :-: |
| **Stable** | [![Stable version on the Chrome Web Store](https://img.shields.io/chrome-web-store/v/inmiajapbpafmhjleiebcamfhkfnlgoc?label=&style=flat-square&color=2ea44f)](https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc) | [![Stable version on Firefox Add-ons](https://img.shields.io/amo/v/tabmerger?label=&style=flat-square&color=2ea44f)](https://addons.mozilla.org/firefox/addon/tabmerger/) | [![Stable version on Microsoft Edge Add-ons](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Feogjdfjemlgmbblgkjlcgdehbeoodbfn&query=%24.version&prefix=v&label=&style=flat-square&color=2ea44f)](https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn) |
| **Beta** | [![Beta version on the Chrome Web Store](https://img.shields.io/github/v/release/lbragile/TabMerger?include_prereleases&filter=*-beta.*&sort=semver&label=&style=flat-square&color=orange)](https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd) | [![Beta version for Firefox](https://img.shields.io/github/v/release/lbragile/TabMerger?include_prereleases&filter=*-beta.*&sort=semver&label=&style=flat-square&color=orange)](https://tabmerger-preview.vercel.app/beta#firefox) | [![Beta version for Edge (the Chrome Web Store beta)](https://img.shields.io/github/v/release/lbragile/TabMerger?include_prereleases&filter=*-beta.*&sort=semver&label=&style=flat-square&color=orange)](https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd) |

Each badge links to its listing. The stable badges show the version that is live on that store
right now; a newer release can still be in the store's review and appears once the store
publishes it. The beta badges show the latest beta release on GitHub, which the Chrome Web
Store may still be reviewing. The beta is invite-only: its Chrome listing opens only for
members of the tester group, Edge installs that same Chrome beta, and the Firefox beta is
installed from the beta guide.

A cross-browser tab manager for Chrome, Firefox, and Edge. Save, organize, and restore your tab
sessions, with optional cloud sync (end-to-end encrypted) and AI-powered grouping (coming soon).

**Install:** [Chrome Web Store](https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc)
(Edge, Brave, Vivaldi and Arc install it from there too).

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 (CI and store builds run on Node 24 — see `.github/workflows/`)
- [pnpm](https://pnpm.io/) (`npm i -g pnpm`) — see `packageManager` in `package.json` for the exact pinned version

### Install

```bash
git clone https://github.com/lbragile/TabMerger.git
cd TabMerger
pnpm install
```

Copy environment files and fill in your keys:

```bash
cp .env.example .env.local
cp packages/extension/.env.example packages/extension/.env.local
cp packages/web/.env.example packages/web/.env.local
```

### Run

**Browser extension (Chrome, with HMR):**
```bash
pnpm dev:extension
```
Then load `packages/extension/.output/chrome-mv3-dev/` as an unpacked extension in `chrome://extensions`.

**Firefox:**
```bash
pnpm dev:extension:firefox
```

**Web app (Next.js):**
```bash
pnpm dev:web
```
Opens at `http://localhost:3000`.

**Both at once:**
```bash
pnpm dev
```

### Build for production

```bash
pnpm build:extension   # Chrome MV3 build in packages/extension/.output/
pnpm build:web         # Next.js production build in packages/web/.next/
pnpm zip                # Chrome/Firefox/Edge store zips in packages/extension/.output/
```

### Quality checks

```bash
pnpm lint         # ESLint across extension + web
pnpm type-check   # TypeScript check across all packages
pnpm test         # Vitest unit tests (extension, web, shared)
pnpm test:e2e     # Playwright E2E (web app)
pnpm test:visual  # Playwright visual regression (extension + web)
pnpm scan-secrets # Check staged files for API keys / PII
```

See `CLAUDE.md` for the full command reference, including extension-specific integration/E2E
test commands. CI runs the extension's visual regression as an informational (non-blocking) check
against Linux baselines; see `docs/VISUAL_REGRESSION.md` for how to regenerate them.

---

## Project structure

```
TabMerger/
  packages/
    extension/   # WXT browser extension (React 18, Tailwind, shadcn/ui, Zustand, TanStack Query)
    web/         # Next.js 15 marketing site + dashboard (Supabase, Stripe, Claude AI)
    shared/      # Shared TypeScript types and constants
    demo/        # Remotion + Playwright walkthrough-video pipeline (dev tooling, not shipped)
  supabase/      # Database migrations and RLS policies
  docs/          # Architecture, feature roadmap, and integration guides
  scripts/       # Dev tooling (secret scanning, setup helpers)
  .github/       # CI/CD workflows (ci.yml, publish.yml, deploy-web.yml)
  .claude/       # AI agent definitions for development
```

See [`docs/`](docs/) for architecture, the release process, and other design notes.

---

## Releases and branches

`main` is the default branch; every push runs the full CI gate suite. Releases are cut by
`semantic-release`: stable versions from `main` (to the public store listings, after a
maintainer approval) and prereleases from the `beta` branch (to a private Chrome Web Store
beta listing). See
[`docs/PUBLISHING.md`](docs/PUBLISHING.md) and [`docs/RELEASE_SANITY_CHECK.md`](docs/RELEASE_SANITY_CHECK.md).

---

## Accessibility

See [`ACCESSIBILITY.md`](ACCESSIBILITY.md) for what we aim for, the known limitations, and how to
report an accessibility barrier.

---

## Contributing

See [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) for the contribution workflow and
commit message conventions, and [`docs/`](docs/) for architecture decisions, roadmap, and
integration guides.

Before committing, the pre-commit hook scans for secrets and API keys. Run it manually:

```bash
pnpm scan-secrets
```

---

## License

Copyright (c) 2020-2026 Lior Bragilevsky. All rights reserved. You may read and review this code,
and contributions are welcome (see [CONTRIBUTING](.github/CONTRIBUTING.md)); copying, reusing, or
redistributing it requires written permission. See [LICENSE.md](LICENSE.md) (PolyForm Strict
1.0.0 plus the terms above it). Using the TabMerger extension itself is covered by the
[Terms of Service](https://tabmerger.vercel.app/terms).
