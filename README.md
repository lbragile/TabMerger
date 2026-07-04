# TabMerger

[![Build](https://img.shields.io/github/actions/workflow/status/lbragile/TabMerger/ci.yml?label=CI&style=flat-square&logo=github)](https://github.com/lbragile/TabMerger/actions)
[![License](https://img.shields.io/github/license/lbragile/tabmerger?label=License&style=flat-square&logo=github)](https://github.com/lbragile/TabMerger/blob/master/LICENSE.md)

A cross-browser tab manager for Chrome, Firefox, and Edge. Save, organize, and restore your tab sessions — with optional AI-powered grouping and cloud sync.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+ (`npm i -g pnpm`)

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
Then load `packages/extension/.output/chrome-mv3/` as an unpacked extension in `chrome://extensions`.

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
pnpm build:extension   # Chrome MV3 + Firefox + Edge zips in packages/extension/.output/
pnpm build:web         # Next.js production build in packages/web/.next/
```

---

## Project structure

```
TabMerger/
  packages/
    extension/   # WXT browser extension (React 18, Tailwind, shadcn/ui, Zustand, TanStack Query)
    web/         # Next.js 15 marketing site + dashboard (Supabase, Stripe, Claude AI)
    shared/      # Shared TypeScript types and constants
  supabase/      # Database migrations and RLS policies
  docs/          # Architecture, feature roadmap, and integration guides
  scripts/       # Dev tooling (secret scanning, setup helpers)
  .github/       # CI/CD workflows (test, publish, deploy)
  .claude/       # AI agent definitions for development
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a full breakdown.

---

## Pricing tiers

| Tier | Price | Features |
|---|---|---|
| Free | $0 | 5 groups · 50 tabs · local storage |
| Pro | $3.99/mo | Unlimited groups + tabs · cloud sync · sessions |
| Pro AI | $7.99/mo | Pro + AI grouping · smart naming · tab previews |

---

## Contributing

See the [`docs/`](docs/) directory for architecture decisions, roadmap, and integration guides.

Before committing, the pre-commit hook scans for secrets and API keys. Run it manually:

```bash
bash scripts/scan-secrets.sh
```

---

## License

Copyright (c) 2020-2026 Lior Bragilevsky. All rights reserved. See [LICENSE.md](LICENSE.md).
