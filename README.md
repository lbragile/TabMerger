# TabMerger

[![CI](https://img.shields.io/github/actions/workflow/status/lbragile/TabMerger/ci.yml?branch=agentic-revamp&label=CI&style=flat-square&logo=github)](https://github.com/lbragile/TabMerger/actions)
[![License](https://img.shields.io/github/license/lbragile/tabmerger?label=License&style=flat-square&logo=github)](https://github.com/lbragile/TabMerger/blob/agentic-revamp/LICENSE.md)

A cross-browser tab manager for Chrome, Firefox, and Edge. Save, organize, and restore your tab
sessions, with optional cloud sync (end-to-end encrypted) and AI-powered grouping (coming soon).

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
test commands.

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

## Pricing tiers

| Tier | Price | Features |
|---|---|---|
| Free | $0 | 5 groups · 50 tabs · local storage |
| Pro | $3.99/mo | Unlimited groups + tabs · end-to-end encrypted cloud sync · sessions |
| Pro AI | $7.99/mo | Pro + AI grouping · smart naming · tab previews — **coming soon**, not yet purchasable |

## Releases and branches

`agentic-revamp` is the default branch; every push runs the full CI gate suite but does not
cut a release. Releases (via `semantic-release`) are currently cut only from the `beta`
branch, publishing prerelease builds to a private Chrome Web Store beta listing. See
[`docs/PUBLISHING.md`](docs/PUBLISHING.md) and [`docs/RELEASE_SANITY_CHECK.md`](docs/RELEASE_SANITY_CHECK.md).

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
