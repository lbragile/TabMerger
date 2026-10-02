# Multi-ID / multi-transport extension messaging (lib/extensionId.ts, lib/extensionMessaging.ts)

- `EXTENSION_IDS` gates the dev/unpacked ID on `NODE_ENV !== 'production'`, not `=== 'development'`.
  Vitest sets `NODE_ENV=test` by default (not `development`), so gating strictly on `'development'`
  silently empties the ID list under test and every `sendToExtension` call falls through every
  attempt (1500ms each) plus the postMessage fallback before resolving null — tests then time out
  at ~5s per case with no assertion failure explaining why. `!== 'production'` keeps dev/test
  behavior matching pre-refactor behavior (dev ID always available unless a real prod ID is set)
  while still excluding it from an actual production deploy.

- `cachedResponderId` and (later) `postMessageDetected` are **module-scope** singletons, not
  per-test state. Any test that lets a probe succeed (even indirectly, e.g. through
  `useExtensionInstalled`'s mount effect) pollutes every later test in the same file unless you
  call `_resetExtensionIdCache()` in `afterEach`/`beforeEach`. A previously-cached ID that no
  longer matches the current test's mock produces silent 1.5-5s timeouts, not a clear assertion
  error — this is the same failure signature as the NODE_ENV bug above, so when a
  extensionMessaging-dependent test times out with no useful diff, suspect stale module state
  before suspecting the implementation.

- The real extension's `SYNC_AUTH` handler (`background.ts` `onMessageExternal`) never calls
  `sendResponse` — it's fire-and-forget (`void supabase.auth.setSession(...); return;` with no
  `sendResponse` call). That means a legitimate successful send resolves with `response ===
  undefined`. Don't conflate "callback returned `undefined`" with "no callback / lastError set" —
  wrap attempts in an `{ ok: true, response: T | undefined } | { ok: false }` shape instead of
  using `response == null` as the failure signal, or SYNC_AUTH will always look like it failed.

- Firefox can't do `chrome.runtime.sendMessage(extensionId, …)` from a regular web page (no
  externally_connectable equivalent there), so its extension build relays through a content
  script via `window.postMessage`. The security-critical parts of that transport: validate
  `event.source === window` (not just origin) so an iframe or popup can't spoof a reply, always
  pass `window.location.origin` as `targetOrigin` (never `'*'`), and correlate replies by a
  per-call `requestId` rather than trusting message order — the extension's one-time `READY`
  broadcast (fired on content-script load, no `requestId`) and per-request replies share the same
  `message` event stream and need separate handling in one listener.

- A single module-scope `window.addEventListener('message', …)` registered at import time (not
  inside a React effect) is what makes the Firefox `READY` announcement reliable regardless of
  mount order — if the listener only existed inside `useExtensionInstalled`'s effect, a content
  script that finishes loading before the hook mounts would have its one-time `READY` message
  missed forever. Expose a small `onExtensionReady(callback)` subscribe API that replays
  immediately if already-detected, so late-mounting consumers still see it.
