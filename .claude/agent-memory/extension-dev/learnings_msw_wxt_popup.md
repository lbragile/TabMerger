---
name: msw-wxt-popup
description: How MSW browser mocking was wired into the WXT popup entrypoint for dev-only AI API interception
metadata:
  type: project
---

Set up MSW (`msw/browser`, `setupWorker`) to intercept `${VITE_WEB_APP_URL}/api/ai/*` in dev only, at `packages/extension/src/mocks/{handlers,browser}.ts`, started from `popup/main.tsx` behind `import.meta.env.DEV` (Vite/WXT statically replaces and dead-code-eliminates this in prod builds — safe to gate at the entrypoint, no need for a separate WXT config flag).

Key mechanics:
- The popup is a real DOM/browser page even under MV3 (unlike the background SW), so MSW's standard `setupWorker` (service-worker based) approach works unmodified — no special extension handling needed.
- Worker script must be generated into the WXT public dir (`src/public/`) via `npx msw init src/public --save` (not just `pnpm add msw`) — this copies `mockServiceWorker.js` and records `msw.workerDirectory` in package.json. Running `worker.start()` without this file present fails silently/errors at runtime.
- `pnpm add -D msw` triggers `[ERR_PNPM_IGNORED_BUILDS]` (msw has a postinstall script) — this blocks even unrelated `pnpm install`/test runs repo-wide until resolved. Set `msw: false` under `allowBuilds` in root `pnpm-workspace.yaml` (the postinstall just re-runs `mockServiceWorker init`, which was already done manually, so blocking the build script is safe).
- `worker.start({ onUnhandledRequest: 'bypass' })` — use 'bypass' not the default 'warn', since IndexedDB/chrome.* calls aren't network requests but other real fetches (fonts, etc.) in dev shouldn't be treated as errors.
- Fixture shapes must match each `/api/ai/*` route's actual `NextResponse.json(...)` shape exactly (checked `packages/web/app/api/ai/*/route.ts`); `organize` is the odd one out — it starts a durable workflow and returns `{ runId, token }`, not the AI result directly (result comes via a separate NDJSON GET stream), so its mock only needs to fake the start response, not the whole workflow.

**Follow-up bug (2026-08-05): `setupWorker` never actually intercepted in the real popup.** A real Anthropic call (400, low credit) hit the live web app dev server even with the mock wired in. Root cause: MSW's `setupWorker()` needs to register a page-scoped service worker (`mockServiceWorker.js`) via `navigator.serviceWorker.register(...)`, and that registration doesn't reliably succeed inside a `chrome-extension://` popup page — MV3 extension pages have their own SW constraints that don't play well with a second, unrelated SW registering itself. It failed silently in practice (compounded by a separate try/catch someone added around `worker.start()` for an unrelated blank-popup bug, which swallowed the failure down to a `console.error`). **Fix: dropped `msw` entirely** and replaced it with a ~20-line hand-rolled `window.fetch` monkeypatch (`src/mocks/devFetchMock.ts`) that matches on `new URL(url).pathname` against a plain fixture map (`src/mocks/handlers.ts`, no longer `msw/http` handlers) and returns a `Response` directly — no service worker, no registration, no CSP surface at all. Lesson: **for WXT popup dev-mocking, skip MSW's browser SW mode and patch fetch directly** — it's simpler, has one fewer moving part, and side-steps the whole extension-page SW question rather than debugging it.
