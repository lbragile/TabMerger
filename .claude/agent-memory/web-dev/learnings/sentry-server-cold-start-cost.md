---
name: sentry-server-cold-start-cost
description: Where @sentry/nextjs 10.x server CPU goes on a cold start (module load, not init), why `next start` overstates it, the lazy onRequestError pattern, and real 10.x integration names
metadata:
  type: reference
---

Measured on Linux Docker (node 24, Next 16.4 Turbopack, @sentry/nextjs 10.78, tracing off), 2026-11.

- **Module load dominates, init doesn't.** `require('@sentry/nextjs')` alone costs ~430 ms CPU
  (@sentry/core ~120, node-core +115, @sentry/node with its bundled OTel instrumentations +180).
  `Sentry.init` is ~25-30 ms whatever the options. So `registerEsmLoaderHooks: false`,
  `skipOpenTelemetrySetup: true`, pruned integrations and `httpIntegration({ spans: false })`
  together saved only ~70 ms per cold start in a full server. A lazy-loaded SDK (below) saved
  ~260 of the ~300 ms in standalone mode.
- **Without `tracesSampleRate`** @sentry/node already skips every performance auto-instrumentation
  (`getAutoPerformanceIntegrations` only when `hasSpansEnabled`). But the instrumentation
  packages are still *required* at module load, and you pay for that require.
- **`next start` loads `next.config.ts` at runtime.** `import { withSentryConfig } from
  '@sentry/nextjs/config'` then pulls the whole @sentry/node + OTel graph into the server process
  at boot, even if the app never imports Sentry. That doubles Sentry's apparent cost:
  ~650 ms under `next start`, ~300 ms (boot+first request) under `output: 'standalone'` +
  `node server.js` (config inlined, closer to Vercel). Measure standalone. Bind it to
  `HOSTNAME=0.0.0.0`: with 127.0.0.1, this app's proxy answered every page with a 307 to itself.
- **Implemented as `lib/sentryServer.ts`:** `getServerSentry()` (memoised promise; null without a
  DSN, off the Node runtime or in an e2e run) and `instrumentation.ts` with an empty `register()`
  and `onRequestError` → `captureRequestError` (which itself `waitUntil`-flushes). Every server
  caller (`lib/planChangeAlarm.ts`) goes through it. Use `.then(init).catch(reset)`, not
  `.then(init, onRejected)`: a throwing `init` inside the fulfil handler would otherwise leave a
  rejected promise cached forever. Tests prove "not loaded" with a counter in the
  `vi.mock('@sentry/nextjs')` factory plus `vi.resetModules()` per test.
- **Lazy server SDK works.** `instrumentation.ts` keeps no static Sentry import. `register()` is
  empty, and `onRequestError` does `await import('@sentry/nextjs')`, then a one-time `init` (memoised
  promise), then `captureRequestError`. Thrown route errors still arrive with the `nextjs` context
  (router_kind) and `beforeSend` runs. Lib callers go through the same loader. Trade-off: errors
  outside a request (uncaught exceptions at boot) aren't reported until something has loaded the SDK.
- **`skipOpenTelemetrySetup: true` still keeps `captureRequestError`'s scope context.** The router
  context arrived in the test, but per-request isolation of breadcrumbs is no longer guaranteed
  (no OTel context manager).
- **The real 10.x default integration names** (for `integrations: (d) => d.filter(...)`):
  InboundFilters, FunctionToString, LinkedErrors, RequestData, NodeSystemError, ConversationId,
  Console, OnUncaughtException, OnUnhandledRejection, ContextLines, LocalVariablesAsync, Context,
  ChildProcess, ProcessSession, Modules, NodeFetch, Http. Not "SystemError"/"LocalVariables"/"NodeContext".
- **Harness tips.** Read `/proc/<pid>/stat` fields 14-17 (strip up to `) ` first). Wait about 2 s
  after "Ready", because Next keeps loading route modules after printing Ready (~1.3 s of boot CPU
  against ~250 ms wall time to Ready). Run with `--network none` and a mock DSN on 127.0.0.1.
  Every page in this app is dynamic (ƒ), so every page view is a function invocation.
