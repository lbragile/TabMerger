---
name: error-pages-next16
description: Next 16 error/404 boundaries in this app — retry vs reset props, where each boundary renders (layouts kept or lost), duplicate noindex meta on 404s, global-error theming, previewing 500s and running one Playwright spec on another port
metadata:
  type: reference
---

Shared UI lives in `components/errors/` (`ErrorPageShell`, `ErrorBoundaryView`, `ReferenceId`, `copy.ts`).

- **Props (Next 16.3):** boundaries receive `error`, `retry` (re-fetch + re-render, the documented default now) and `reset` (re-render only). Read the bundled docs at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`; `ErrorBoundaryView` takes both and prefers `retry`.
- **Where each boundary renders:** a segment's `error.tsx` sits *inside* that segment's layout, so `(marketing)/error.tsx` keeps Navbar/Footer and `(app)/error.tsx` keeps the dashboard header; both must not add another `<main>` (the layouts have one). Root `app/error.tsx` and `app/not-found.tsx` render under the root layout only, so they bring their own header (`not-found` renders the real async `Navbar`/`Footer`; the client `error.tsx` can't, so it uses `ErrorHeader`).
- **One not-found for all:** no segment has its own `not-found.tsx`, so every `notFound()` (beta page production gate, share page) and every unmatched URL lands on the root one with HTTP 404.
- **Duplicate robots meta:** Next adds its own `noindex` to 404 responses, and `metadata.robots` adds a second tag. Playwright `locator('meta[name="robots"]')` then fails strict mode; use `evaluateAll`.
- **global-error:** imports `globals.css` and the Geist fonts itself, and needs the theme script (`lib/themeScript.ts`, shared with the root layout) plus an effect (`applyStoredTheme`), because a `<script>` React inserts on a client render never executes.
- **Tailwind v4 `rotate-*`** sets the CSS `rotate` property, not `transform`, so it composes with a `transform` keyframe animation (`animate-tab-float`).
- **Previewing a 500 locally:** a temporary `export const dynamic = 'force-dynamic'` page that throws, one at the app root (root boundary) and one in `(marketing)` (marketing boundary); delete afterwards. A click-handler throw (like `/sentry-test`) never reaches a boundary.
- **Other ports:** 3000/3100 are often taken by other sessions (`next start -p 3100`). Run `next dev -p <port>` and a throwaway config next to the specs (`import base from '../playwright.config'`, override `use.baseURL`, `webServer: undefined`) to run one spec there.
