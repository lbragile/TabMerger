# Web Dev Learnings

- **Mandatory E2E encryption made `groups.windows` ciphertext for every real user, and the web
  dashboard had no client-side decryption at all** — `GroupGrid.tsx` did `group.windows.flatMap(...)`
  directly on what is now an `{v:1,iv,ct}` blob for encrypted users, a crash on every real dashboard
  load. Fixed with a `packages/web/lib/encryption/context.tsx` `EncryptionKeyProvider` (React context,
  in-memory-only `CryptoKey`, mirrors the extension's `encryptionKey.ts` unlock flow: read
  `encryption_keys` row via the client Supabase client → `deriveWrappingKey` → `unwrapDataKey`) wrapping
  `app/(app)/layout.tsx`, plus a `useDecryptedGroups` hook inside `GroupGrid.tsx` that decrypts each
  row with `decryptBlob` and falls back to a `PassphrasePrompt` inline card when locked.
- **The extension encrypts `{name, windows, note, info}` as one blob, not just `windows`** — when a
  group is encrypted, the plaintext `groups.name` column is written as `''` server-side (see
  `syncEngine.ts`'s `pushGroup`). Any web code reading `group.name` for an encrypted row must decrypt
  first; there's no plaintext name to fall back to.
- **`createContext(null)` + throw-if-missing breaks existing tests that render a consumer component
  without its provider.** Changed `useEncryptionKey` to `createContext(defaultValue)` with a safe no-op
  default (`status: 'no-key'`, `unlock` resolves `false`) instead — pre-existing `GroupGrid.test.tsx`/
  `dashboard-edge-cases.test.tsx` render `<GroupGrid>` bare (no provider), and a hard-throw context is a
  breaking API change for every existing caller, not just new ones. Default-value contexts compose
  better when a feature is being retrofitted onto components with an established test suite.
- **AI organise (`OrganizeProposal.tsx`) genuinely cannot "just" support encrypted groups from web-dev
  alone.** The proposal is generated server-side (`/api/ai/organize` → `lib/workflows/tabOrganizer.ts`),
  which only ever sees ciphertext for encrypted rows — the data key never leaves the browser. Making
  this work requires the client to decrypt groups and send plaintext to a (new or changed) AI route,
  which is `ai-features` agent territory (route contract change), not a web-dev-only fix. Left
  `OrganizeProposal`'s explicit refusal in place rather than faking a "now it works" wrapper around it.

- **Radix `DropdownMenu` + inline-edit `Input` with `autoFocus` races in jsdom tests (and can in
  real browsers too).** When a `DropdownMenuItem` click sets state that mounts an `<Input autoFocus>`
  elsewhere in the tree, Radix's own focus-restore-to-trigger-on-close can steal focus back from that
  Input immediately after it mounts, firing a spurious `blur` that closes/saves the edit before the
  user can type. Symptom in RTL: `getByRole('textbox')` never finds the input, or an `onBlur` handler
  fires immediately after clicking the menu item (visible via `new Error().stack` logged in the
  handler — it comes from a real `dispatchDiscreteEvent`, not a query bug). Fix: don't use the DOM
  `autoFocus` attribute; instead focus the input yourself in a `useEffect` that fires
  `requestAnimationFrame(() => ref.current?.focus())` — this runs after Radix's own restore, so it
  wins the race deterministically. `DropdownMenuContent`'s `onCloseAutoFocus={(e) => e.preventDefault()}`
  looked like the "correct" Radix API for this but did not fix it in practice here — the rAF-deferred
  manual focus did. See `packages/web/components/account/DevicesSection.tsx`'s rename flow.
- Supabase mock chains in tests must match the exact call shape, including argument order — e.g.
  `.delete().in('id', ids).eq('user_id', userId)` means the mock's innermost function receives
  `('id', ids)` as two args, not `(ids)` as one. A mismatched `toHaveBeenCalledWith` assertion here
  doesn't fail fast — `waitFor` just retries for the full `asyncUtilTimeout` (5000ms in this repo's
  `vitest.setup.tsx`) and reports a generic timeout with no indication of which assertion is wrong.
  If a test times out inside a `waitFor` with no query-not-found error, suspect a mismatched mock-call
  assertion before suspecting a genuine hang.

- **Rule, not a case-by-case call**: when a client (browser extension, mobile app, or any code
  the user can unzip/decompile) needs to call a third-party API that requires a secret, always add
  a server-side proxy route rather than embedding the secret client-side. This applies even if the
  specific secret looks "low risk" (e.g. an analytics API secret) — the correct default for this
  project is proxy-always, not a risk-judgment call per instance. Example: `app/api/track/route.ts`
  proxies GA4 Measurement Protocol events for the extension so `GA_EXTENSION_MEASUREMENT_ID` /
  `GA_EXTENSION_API_SECRET` stay server-only instead of being embedded via `VITE_*` in the shipped
  extension bundle (anyone can unzip an installed extension and read its JS).
- GA4 Measurement Protocol `api_secret` is created per data stream/property in the GA4 dashboard —
  it cannot be shared across two different GA4 properties even if both belong to the same product.
  The web app's own GA4 property (`NEXT_PUBLIC_GA_MEASUREMENT_ID` / `GA_API_SECRET`, used by
  `app/layout.tsx`'s `<GoogleAnalytics>` and the Stripe webhook's `trackCheckoutCompleted`) is a
  separate stream from the extension's GA4 property — don't reuse one property's `api_secret` for
  another property's `measurement_id`, add a distinct pair (`GA_EXTENSION_MEASUREMENT_ID` /
  `GA_EXTENSION_API_SECRET`) instead, even though both live in the same `.env.example`.

- PostHog added alongside GA4 + Sentry Replay (`components/posthog-provider.tsx`, client component,
  mounted in `app/layout.tsx` after `ThemeProvider`): only `posthog-js` was installed, not
  `posthog-node` — this app has no server-side PostHog event tracking requirement yet, so the
  split client/server SDK setup PostHog's docs show for App Router (server component instrumentation
  via `posthog-node` in a `lib/posthog-server.ts`) wasn't needed. Init happens in a `useEffect` in a
  tiny client component rather than `instrumentation-client.ts`, to keep it fully separate from the
  Sentry instrumentation files another agent may be concurrently editing — no shared file, no merge
  conflict risk. `posthog.__loaded` guards against double-init in dev (React strict-mode double
  effect). `session_recording: { maskAllInputs: true }` is actually PostHog's *default* already —
  set it explicitly anyway so the "don't relax replay masking" intent survives a future edit, mirrors
  the `maskAllText`/`blockAllMedia` default-true pattern already noted above for Sentry Replay.

- Sentry Session Replay (`@sentry/nextjs` v10): enabled via `Sentry.replayIntegration()` added to
  the `integrations` array in `Sentry.init()` in `instrumentation-client.ts` (client-only, no
  server/edge config file needed for Replay). `replaysSessionSampleRate`/`replaysOnErrorSampleRate`
  are top-level `init()` options, not integration options. Default `maskAllText`/`blockAllMedia`
  are `true` on `replayIntegration()` — don't pass `{maskAllText: false}` etc unless explicitly
  asked, since that's the PII protection for an app with auth/billing forms. The existing
  `beforeSend: scrubEvent` (`lib/sentry-scrubber.ts`) only runs on error/transaction events, NOT
  replay recordings — Replay's own input masking is the only PII protection for the video/DOM
  capture, there's no separate `beforeSendReplay` hook needed here since the existing scrubber
  never touched replay data anyway (it was written before Replay existed).

- Supabase E2E auth fixture (`e2e/auth.setup.ts`): the web app uses `@supabase/ssr`'s
  `createBrowserClient`, which stores the session in a **cookie** named
  `sb-<project-ref>-auth-token` (value = `base64-` + base64(JSON.stringify(session))), NOT
  localStorage — that's the plain `@supabase/supabase-js` browser client's behavior, which this
  app doesn't use. A Playwright `storageState` for a signed-in session must therefore set
  `cookies`, not `origins[].localStorage`, or the middleware/server client will see no session.
  `project-ref` = the subdomain of `NEXT_PUBLIC_SUPABASE_URL`. Didn't implement cookie chunking
  (`.0`, `.1` suffixes `@supabase/ssr` uses for sessions >~3180 bytes) — fine for a fresh
  ephemeral test user with minimal metadata, would need it for a session with large user
  metadata/JWT claims.
- To mint a real session in E2E without an email round-trip: `admin.auth.admin.createUser()` +
  `admin.auth.admin.generateLink({type:'magiclink', email})` to get a `hashed_token`, then redeem
  it with a normal anon-key client's `auth.verifyOtp({type:'magiclink', token_hash})`. There is no
  "mint session directly" admin API in supabase-js v2.
- Found `.env.example` has stale `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
  naming drift — actual app code (`lib/supabase/client.ts`, `server.ts`) reads
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Not fixed (out of scope for the task at hand), but any
  new script reading env vars should grep actual usage in `lib/supabase/` rather than trusting
  `.env.example`.

- Extension-to-web-app signals arrive via `window.postMessage` from the content script (fired
  fire-and-forget on content script load, `document_idle`, targeted at `window.location.origin` —
  never `'*'`). Real race exists between page load and React mounting its listener, so any
  one-shot signal like this needs the listener to also persist a "seen" flag to localStorage once
  caught (`tm_extension_installed` in `lib/hooks/useExtensionInstalled.ts`), so a missed message on
  one visit doesn't regress an already-confirmed state. Always validate `e.origin ===
  window.location.origin` before trusting `e.data` from a `message` event listener.

- `next/dynamic(..., { ssr: false })` components (e.g. `DemoSectionLoader`) resolve slower than
  the default 1000ms `@testing-library` `asyncUtilTimeout` on a cold module cache in Vitest —
  bumped it globally to 5000ms in `vitest.setup.tsx` via `configure({ asyncUtilTimeout: 5000 })`
  rather than passing per-call timeouts everywhere. Fixed a flaky `findByRole` in Hero.test.tsx
  with no code change needed to the component itself.
- Design tokens in `app/globals.css` (`--surface`, `--surface2`, `--surface3`, `--border2`,
  `--line`, `--text2`, `--text3`, `--feat-bg`/`--feat-foreground`, `--ok`/`--ok-soft`) are consumed
  via Tailwind utility classes like `bg-surface2`, `text-text2`, `bg-[hsl(var(--feat-bg))]` —
  the `@theme inline` block in globals.css maps them, so plain Tailwind class names work directly
  (no arbitrary `[var(--x)]` syntax needed except for `feat-bg`/`feat-foreground`, which aren't in
  the `--color-*` theme map the same way and need the `hsl(var(--x))` wrapper).
- Before restyling a component, always check for existing responsive/behavior tests first
  (e.g. `dashboard-account-responsive.test.tsx`, `session-card-responsive.test.tsx`,
  `ShareBundleContent.open-all.test.tsx`) — several already lock in specific class names
  (`flex-col md:flex-row`, `border-t-2 md:border-t-0`) or button aria-labels/text that a visual
  restyle must preserve exactly, or the test-writer batch has to spend its budget fixing
  regressions instead of adding new coverage.
- Changing a button's visible text (e.g. "Sign in" -> "Continue" on the auth submit button) is a
  behavior-visible change even in an otherwise "visual-only" restyle — flag it explicitly to
  test-writer since existing tests may assert the old text via `getByRole('button', {name: ...})`.
- Importing `packages/shared/src/styles/theme.css` into `app/globals.css`: the web marketing
  site already has its own full shadcn-slot `:root`/`.dark` palette (warm off-white brand vs.
  the extension's white/near-black). A blind top-level `@import` would let the *unlayered*
  theme.css declarations win over the web's own values (CSS cascade layers always beat
  unlayered declarations regardless of source order). Fix: `@import "..." layer(shared-theme);`
  declared *before* the web's own `@layer base { :root {...} } ` block — layer priority is by
  declaration order of the layer name, so `base` (declared later) wins for every token both
  define (`--border`, `--background`, etc.), while extension-only tokens theme.css uniquely
  provides (`--zone-header`, `--sidebar-text-*`) still take effect since there's no conflict.
  Also had to manually add `--color-zone-header`/`--color-zone-sidebar` to web's `@theme inline`
  block — that mapping only existed in the extension's globals.css, not on the web side.
- `@tabmerger/shared` component subpath exports (e.g. `./components/*": "./src/components/*.tsx"`)
  resolve fine under Vite/Vitest for folder components like `Header/index.tsx` via
  `@tabmerger/shared/components/Header` (bundler-style directory-index fallback), but `tsc
  --noEmit` (moduleResolution: "bundler") does NOT apply that fallback across a package's
  exports map — it needs the exact literal target. Fix: import the folder-index component as
  `@tabmerger/shared/components/Header/index` explicitly. Flat-file components under a folder
  (e.g. `@tabmerger/shared/components/SidePanel/GroupItem`) don't have this problem since the
  wildcard match is already an exact file.
- Shared presentational components in `packages/shared/src/components/` can and did change
  shape mid-task (a concurrent extension-dev pass expanded `HeaderView` from a simple
  title+search+theme header into a full auth/tier/undo-redo/account-menu header with ~20 props).
  Don't assume a component read at the start of a session is still current — re-read before the
  final integration if a downstream test starts failing in a way the diff doesn't explain
  (e.g. unexpected DOM nodes appearing that your own code never rendered). In this case the
  ponytail call was to NOT force the marketing demo (a static, backend-less widget) onto the
  now much-heavier `HeaderView` contract — stubbing 15 no-op props to satisfy an unrelated
  auth/undo-redo surface is worse than a small hand-built header that just consumes the same
  shared CSS tokens (`bg-zone-header`, `border-border`, `text-muted-foreground`) directly.
- `GroupItemView`/`SidePanelView` (shared SidePanel extract) intentionally have NO rename-input
  UI built in — `onRename(groupId)` only *signals* "enter rename mode"; the caller still owns
  an inline `<input>` + local `useState` for the actual edit, same as before extraction. Don't
  expect the shared component to grow a text box just because it exposes an onRename callback.
- `SidePanelView` bundles its own internal `DndContext`+`SortableContext` for group reordering.
  Don't use it if the caller already needs a single top-level `DndContext` spanning multiple
  panels (e.g. the marketing demo's one `onDragEnd` handling group/window/tab drags together) —
  nested `DndContext`s fight over sensors. Use `GroupItemView` directly with your own
  `useSortable` per row instead, and skip `SidePanelView` entirely in that case.
- Realtime is NOT enabled for any table yet — grepped `supabase/migrations/` for
  `supabase_realtime`/`ALTER PUBLICATION` and found nothing, and no existing web code calls
  `.channel(`/`postgres_changes`. Built the `SyncIndicator` component (dashboard header live sync
  pill, `packages/web/components/dashboard/SyncIndicator.tsx`) assuming Realtime *will* be turned
  on for `public.groups` — it degrades gracefully to a static "last synced" read via the initial
  `select().order('updated_at').limit(1)` if the publication isn't there, since `.channel().on()`
  just never fires rather than erroring. Enabling replication for `groups` is a `database` agent
  change (`ALTER PUBLICATION supabase_realtime ADD TABLE groups` + RLS already covers filtering
  since Realtime respects RLS) — flagged, not routed around.
- Client components using `createClient` from `@/lib/supabase/client` need `@/lib/supabase/client`
  mocked in ANY test that renders them, even indirectly (e.g. `app-layout.test.tsx` broke when
  `SyncIndicator` was added to the `(app)` layout, because `createBrowserClient` throws
  synchronously in jsdom without real `NEXT_PUBLIC_SUPABASE_URL`/key envs). Grep for existing
  renders of a server layout/page before adding a new client-side Supabase call to it.
- Investigated "renewal date invisible on dashboard/account" bug end-to-end: webhook
  (`app/api/webhooks/stripe/route.ts`), `subscriptions` schema/RLS, both page queries, and
  `SubscriptionBadge` prop-wiring were ALL already correct — the real gap was that every existing
  test for both pages `vi.mock()`s `SubscriptionBadge` away entirely, so a real prop-shape
  regression would never fail CI, AND the rendered line was `text-xs text-muted-foreground`
  tucked under the tier badge — technically present but easy to miss next to Stripe's own
  prominent "Renews 19 Aug" checkout confirmation the user was comparing it to. Fix was two-part:
  (1) added `__tests__/SubscriptionBadge.test.tsx` that renders the real component (no mock) with
  realistic `subscriptions`-row-shaped props — this is the missing regression net, not just a
  bugfix; (2) restyled the renewal line to `text-sm font-medium text-foreground` with a `Calendar`
  icon. Also loosened `isActive` from `status === 'active'` to `status !== 'canceled'` so
  `past_due`/`trialing` subs (which still have a real upcoming date) don't have it hidden — small
  but real behavior bug found by re-reading the gate condition literally against all Stripe
  subscription statuses, not just "active".
  Lesson: when a UI paper-checks-out at every layer, check whether the existing tests actually
  exercise the real component before concluding "nothing to fix" — a component fully mocked out
  of every test suite is itself the finding.
- `faq-page-routing.test.tsx`'s "no longer renders FAQ content" test is flaky under full-suite
  `pnpm test` (5000ms timeout) but passes reliably in isolation — pre-existing, unrelated to
  Supabase/Realtime work; don't waste time chasing it as a regression from unrelated changes.
- Theme-aware asset selection (`DemoSection`/`DemoVideo`): `fs.statSync`/`existsSync` are
  server-only, but the resolved light/dark theme is only known client-side after hydration
  (this app's hand-rolled `ThemeProvider` in `components/theme-provider.tsx`, not next-themes —
  no SSR cookie, defaults to `'light'` until a `useEffect` reads localStorage). Split into a
  server component that stats files and passes plain `src`/null props down, and a client
  component that picks `src` based on `useTheme()` gated by a `mounted` flag defaulting to
  `'light'` (matches the provider's own initial state, avoids a src-swap flash on hydration).
- Next 16's `next/image` throws `Uncaught Error: ... using a query string which is not
  configured in images.localPatterns` for ANY local image src with a `?query`, even a harmless
  cache-buster — this only surfaces at runtime in the browser, not in `tsc`/Vitest/jsdom (jsdom
  doesn't invoke the real image loader validation). Don't cache-bust static poster/preview
  images with `?v=mtime` the way video `src` does; static images change rarely enough that
  next/image's own content-based caching is sufficient. If cache-busting a local `next/image`
  src is truly required, configure `images.localPatterns[].search` in `next.config.ts` instead
  of guessing — don't skip straight to disabling optimization.
- No existing build/copy step moves `packages/demo/out/tabmerger-demo-{dark,light}.mp4` (the
  Remotion render output) into `packages/web/public/videos/` — grepped `.github/`, root scripts,
  and `packages/demo/package.json` and found none. Until the `devops`/`demo` agents wire up an
  automated copy (e.g. a predeploy script), these need to be copied over manually whenever
  they're re-rendered, or the web app's video will silently stay stale/fall back to the preview
  image because `fs.existsSync` will see last time's file mtime is unchanged... actually it'll
  just serve whatever's physically present in `public/videos/` — the risk is nobody re-copies
  after a re-render and the site quietly keeps serving an old cut.

- Added an active `chrome.runtime.sendMessage(extensionId, {type:'PING'}, cb)` probe to
  `useExtensionInstalled.ts` (via `externally_connectable`, extension-dev's addition) alongside
  the existing passive `postMessage` listener — both write the same `tm_extension_installed`
  localStorage key so either signal converges. This package has no `@types/chrome` dependency
  (extension-only concern), so `chrome` isn't a known global here; added a minimal inline
  `declare global { interface Window { chrome?: {...} } const chrome: Window['chrome'] }` scoped
  to just the one API surface touched, rather than pulling in `@types/chrome` for one hook.
  Extension ID env var: `NEXT_PUBLIC_CHROME_EXTENSION_ID` (falls back to the dev/unpacked ID
  `ogadhgghhdbaohdcajfakeogcamicdkm` when unset), added to `.env.example` next to
  `NEXT_PUBLIC_APP_URL` — not yet set in `.env.local`, needs the real Chrome Web Store ID once
  published.
- `window.postMessage` in Vitest+jsdom is unreliably async — a test that calls
  `window.postMessage(...)` and then `waitFor`s the listener's effect can time out even past 5s
  (jsdom's postMessage task scheduling doesn't reliably flush in the fake/real timer setup this
  repo uses). Dispatch the `MessageEvent` directly instead: `window.dispatchEvent(new
  MessageEvent('message', { origin, data }))` — this is what the `message` listener actually
  receives, and fires synchronously within the test.
- `SyncIndicator.tsx` "Sync now" button: the web app has no channel to command the extension
  (it only reads Supabase; the extension's `syncEngine.ts` pushes independently), so a manual
  refresh button here can only re-run the same `.from('groups').select('updated_at')` query the
  mount `useEffect` already does — it must not imply it forces a fresh extension-side sync. Made
  this explicit via a `title` tooltip rather than a new UI element (native `title` was enough,
  no need for a Radix tooltip just for this). Extracted the fetch into a shared `fetchLatestSync`
  callback so both the mount effect and the click handler stay in sync instead of duplicating the
  query. Used a separate `refreshing` state (drives the spinning `RefreshCw` icon + disabled button)
  from the existing `justSynced` state (drives the amber-pulse pill) — reusing `justSynced` alone
  would conflate "Realtime pushed an update" with "user clicked refresh," but it's fine to still
  trigger `justSynced` after a successful manual refresh completes since the pill's job is just
  "something updated," not "how."

- Added a hover-preview `Tooltip` to `ShareBundleContent.tsx` (public `/share/[slug]` page)
  mirroring the extension's `TabPreview.tsx` card but stripped of AI-summary and live
  `chrome.tabs`-based OG-image fetch — the share page has no extension APIs/auth, so it just reads
  `tab.ogImage` (already part of the `groups_snapshot` JSON captured at share time) directly, no
  fetch/loading state needed at all. Radix `Tooltip.Root` requires a `TooltipProvider` ancestor to
  actually open on hover in tests (and is good practice generally) — wrapped the whole component's
  return in one `TooltipProvider`, not one per row. In RTL tests, `<img alt="">` gets accessibility
  role `"presentation"`, NOT `"img"` — `screen.getByRole('img')`/`queryAllByRole('img')` silently
  finds nothing for these (favicon/OG-image use empty alt intentionally, matching the extension's
  pattern), so a `waitFor` around a `getByRole('img')` query just retries for the full 5s timeout
  with no useful error. Query `document.body.querySelectorAll('img')` (Radix `Tooltip.Content` is
  portalled to `document.body`, not inside RTL's `container`) and check `.src` instead.

- **Real bug found while finishing the E2E-share-link feature** (`ShareBundleContent.tsx`'s
  `useDecryptedGroups`): never parse a base64 value out of `location.hash` with `new
  URLSearchParams(hash).get('key')`. `URLSearchParams`/`application/x-www-form-urlencoded`
  decodes `+` as a literal space — standard base64's alphabet includes `+`, so any per-share AES
  key whose random bytes happen to base64-encode with a `+` gets silently corrupted on read,
  non-deterministically (only reproduces for ~25% of randomly generated keys, since `+` shows up
  in roughly 1 of ~64 chars per key). Symptom looked exactly like test flakiness/slowness (a
  `waitFor(...)` timeout that "sometimes" passed) — do NOT reach for a longer timeout when a
  crypto-roundtrip assertion is intermittently failing; write a tiny non-React script that logs
  `parsedValue === originalValue` first. Fix: parse the fragment manually (`hash.match(/(?:^|&)
  key=([^&]*)/)` + `decodeURIComponent`) instead of `URLSearchParams`. Full sharing pipeline as of
  this pass: `GroupGrid.tsx` (dashboard "Share" button) → `POST /api/share-bundle`
  (`app/api/share-bundle/route.ts`, server-side key-gen + `encryptBlob` + insert into
  `shared_bundles.groups_snapshot` as `{v:1,iv,ct}`, key returned once in the response, never
  persisted) → link built as `${origin}/share/${slug}#key=${key}` in `GroupGrid.tsx` → public
  `/share/[slug]/page.tsx` fetches the row server-side (RLS: `using(true)`, public by design) and
  hands ciphertext to `ShareBundleContent`, which reads `location.hash` client-side and decrypts.
  Note this is server-side (not client-side) encryption despite the plan's "client-side E2E"
  framing — the Next.js API route sees plaintext groups transiently during the request but never
  stores them; only ciphertext + the (never-persisted) key leave the route. A second, separate,
  OLDER write path also existed — `packages/extension/src/lib/sharing.ts`'s `createSharedBundle`
  (called from `SelectionActionBar.tsx`) — which inserted `groups_snapshot` as plaintext at the
  time. **Both are superseded:** the extension now encrypts in the browser (`encryptBlob`), and on
  2026-09-26 the web `/api/share-bundle` route was deleted in favour of a browser-only
  `lib/sharing.ts` that mirrors the extension (see `share-bundle-pattern.md`).

- **Second confirmed instance of "server-side read of `groups.windows` chokes on ciphertext once
  encryption went mandatory"** (first was `/api/ai/organize`, which now takes client-decrypted groups in the POST body and skips content-bearing writebacks instead of re-encrypting):
  `app/api/share-bundle/route.ts` queried `groups.windows` server-side and wrapped the resulting
  ciphertext blob as the OUTER share-bundle layer — double-encryption, not a crash at write time.
  The crash surfaced downstream in `ShareBundleContent.tsx`'s render (`g.windows.reduce is not a
  function`) because the inner "decrypted" content was itself still an `{v:1,iv,ct}` object, not
  a real array. Fixed the same way as `organize`: route now takes `{ groups: ClientGroup[] }`
  (plaintext, client already decrypted it for its own dashboard render via `GroupGrid.tsx`'s
  `useDecryptedGroups`) instead of `{ groupIds }`, does an id-only ownership lookup (`select('id')`,
  no `windows`) to filter to groups the caller actually owns, then encrypts the client-supplied
  content as the outer layer. Security note worth remembering: sharing is *creating* new public
  data the caller already fully controls, not granting read access to someone else's data — so
  trusting client-supplied plaintext for the CALLER'S OWN groups is fine (no privilege escalation),
  the ownership check exists only to stop a group id the caller doesn't own from being attributed
  to their share, not to prevent data exposure.
  **Systematic audit performed** (grepped `from('groups')`/`from('sessions')`/`from('device_sessions')`
  across `packages/web/app/`): `sessions/[id]/route.ts` DELETE only deletes by id, no content read —
  clean. `groups/[id]/publish/route.ts` (POST/DELETE) only writes `public_slug`, never reads
  `windows` — clean, BUT note this route sets a `public_slug` column with no corresponding public
  page found anywhere in `packages/web/app/` that reads it to render content (grepped `public_slug`
  repo-wide, only hits are this route + `GroupGrid.tsx`'s `ShareButton` UI which never fetches
  content by slug). Looks like a half-built/dead parallel share mechanism — flag before anyone
  wires up a `/g/[slug]` page against it, since it'll have the exact same ciphertext-read bug the
  moment someone builds that page against `groups.windows` server-side. The `(app)/dashboard/page.tsx`
  Server Component read of `groups` (`select('id, name, color, windows, ...')`) is NOT a bug —
  it correctly hands raw (possibly ciphertext) rows to `GroupGrid.tsx`, which decrypts client-side.
  The pattern to keep checking for: any route/Server Component that both reads `windows`/`groups`
  content columns AND does something with the content server-side (encrypt it, summarize it, parse
  it) rather than just passing the raw row through to a client component that already knows how to
  decrypt it.

- **`eslint-plugin-react-hooks@7.x`'s `react-hooks/set-state-in-effect` (pulled in transitively via
  `eslint-config-next@16.x`, not a repo-added rule) fired 9 errors repo-wide the first time ESLint
  actually ran clean** (it had been silently crashing on an unrelated `brace-expansion` override
  bug until fixed separately) — these were long-standing patterns, not new regressions. Empirically
  probed the rule's exact detection boundary (`components/__eslint_probe.tsx` scratch file, deleted
  after): (1) `setX(...)` called directly/synchronously at the top level of an effect body IS
  flagged, always; (2) `setX(...)` called inside a nested `async () => {...}` IIFE defined inline in
  the effect (the `let cancelled = false; (async () => {...})(); return () => {cancelled = true}`
  pattern already used everywhere in this repo for cancellable fetches) is NEVER flagged, even
  though it's the exact same eventual state update; (3) calling a `useCallback`-wrapped **named**
  async function that itself sets state (e.g. `fetchLatestSync()`) directly at the top of an effect
  IS flagged, even though the setState inside it happens after an `await` — the rule's static
  analysis apparently treats "call a known state-setting helper" the same as inlining it, regardless
  of async-ness. Fix for case 3: wrap the call itself in a fresh inline `;(async () => { await
  helperFn() })()` — moves the call site into a nested async scope and the rule stops flagging it,
  with zero behavior change. Fix for case 1's most common shape here (`if (someSyncCondition) {
  setX(derivedFromProps); return } ... await asyncWork(); setX(result)`): split into "derive the
  sync branch's value straight from props/render, no state needed" + "keep only the genuine
  post-await setState in the nested-async form" — applied to `GroupGrid.tsx`/`SessionList.tsx`'s
  `useDecryptedGroups`/`useDecryptedSessions` (the `!hasEncrypted` fast path no longer needs a
  `useState` at all) and `ShareBundleContent.tsx`'s `useDecryptedGroups` (the "no key in the hash"
  branch is now derived, only the real decrypt-with-key path uses state).
- For the "read a browser-only external value (localStorage/matchMedia/`location.hash`) once after
  mount, SSR-unsafe to read during render directly" pattern — previously always `useState(default) +
  useEffect(() => setState(realValue), [])`, which IS flagged — `useSyncExternalStore(subscribe,
  getSnapshot, getServerSnapshot)` is a strictly better replacement with zero lint issue AND it
  removes the pre-existing one-paint flash-of-default-then-swap those effects always had (the
  server-snapshot/client-snapshot resync happens before paint on hydration, not in a post-paint
  effect). Two flavors ended up needed: (a) pure read-only derivation with no local override
  afterward (`useLocationHash.ts` new shared hook used by both `CopyShareUrl.tsx` and
  `ShareBundleContent.tsx`; `useExtensionInstalled.ts`'s persisted-flag half) — just call
  `useSyncExternalStore` directly, no `useState` needed at all; (b) a value that's ALSO
  user-togglable afterward (`theme-provider.tsx`'s theme, `GroupGrid.tsx`'s grid/list view
  preference) — do NOT try to seed a separate `useState` from the store's snapshot (that value
  freezes at whatever the snapshot was on first mount, since `useState(x)`'s argument is only read
  once; the subsequent hydration resync render silently never reaches the mirrored state). Instead
  make the toggle itself a tiny module-level pub/sub store with no separate React state anywhere:
  `write to localStorage` + `notify a Set<() => void> of listeners` on toggle, and let
  `useSyncExternalStore`'s own subscribe/getSnapshot be the only source of truth — the component
  never holds its own copy of the value.
- Fixing `theme-provider.tsx` this way had a compounding effect: `DemoVideo.tsx` had a separate
  `mounted` boolean + effect purely to avoid trusting `useTheme()` before hydration (comment: "before
  hydration we don't know the resolved theme yet"). Once `theme` itself resolves correctly
  synchronously-before-paint via the fixed provider, that whole `mounted` workaround became dead
  weight and was deleted outright — worth re-checking other consumers of a value you just moved to
  `useSyncExternalStore` for their own now-redundant "wait for mount" gates.
  Correction (2026-10-10): this holds for what is *rendered*, not for *effects*. While hydrating,
  effects still run once on the commit that carries the server snapshot (`'light'`), so an effect
  that acts on `theme` needs a hydration guard. See `learnings/theme-dependent-media-hydration.md`.
- `@next/next/no-img-element` on `ShareBundleContent.tsx` (public share page rendering arbitrary
  shared tabs' favicons/OG images): correctly a permanent disable, not a `next/image` migration —
  the source hostnames are unbounded (any URL a user ever had open), so `next.config.ts`'s
  `images.remotePatterns` (currently just `*.supabase.co` + `lh3.googleusercontent.com` for avatars)
  can never allow-list them all. Left `next/image` in place for hostnames actually known ahead of
  time (avatars); disabled the rule with a comment at each of the 3 `<img>` sites here instead.

- **Made `/api/og-preview` opt-in-only for privacy** (previously always fetched on tooltip hover,
  which silently sent every hovered tab's URL to our server — a real privacy-policy contradiction).
  Changes: (1) dropped the GET `?url=` query-string variant entirely and made POST `{url}` in the
  JSON body the only API — no back-compat GET needed since nothing older was ever shipped calling
  it; if a route like this ever DOES need back-compat, don't default to keeping GET "just in case,"
  confirm with a maintainer first, since removing a whole HTTP method is a real API surface decision.
  (2) deleted the module-level `Map` cache outright rather than shrinking its TTL — a URL-keyed
  cache is itself the thing the privacy policy now promises doesn't exist, so "cache it briefly" is
  not a safe middle ground here. (3) Added `Cache-Control: no-store` to every response. (4) Sentry
  scrubbing needed ZERO route-specific changes — `lib/sentry-scrubber.ts`'s `beforeSend: scrubEvent`
  already redacts `event.request.url` + breadcrumb urls/from/to globally for every route, wired via
  `instrumentation.ts`/`instrumentation-client.ts`. Don't assume a new sensitive route needs its own
  Sentry scrubbing pass without first checking whether a global `beforeSend` already covers it.
- **Share-page opt-in toggle pattern** (`ShareBundleContent.tsx`'s "Show page previews" switch):
  turning ON requires confirming a Radix `Dialog` first (any dismissal path — Cancel button,
  Escape, overlay click — must leave state unchanged, so route all of them through one
  `onOpenChange` handler rather than a separate per-button handler); turning OFF is immediate, no
  dialog. Gate the actual network call (not just the UI) behind a React Context flag threaded from
  the top-level toggle down to each `TabPreviewTooltip`, rather than trusting the switch's rendered
  state alone — a context read at the exact call site is the only way to guarantee "flip it off"
  really means "no more requests," independent of any prop-drilling mistakes elsewhere in the tree.
  RTL gotcha: while the confirmation `Dialog` is open, Radix marks background siblings
  `aria-hidden="true"` (correct a11y behavior — hides inert content from screen readers), so
  `screen.getByRole('switch', ...)` finds NOTHING for the switch behind the open dialog, even though
  it's still literally in the DOM. Don't assert on the switch's accessible role/state while a modal
  covering it is open — assert on a side effect that doesn't depend on the accessibility tree
  instead (here, `localStorage.getItem(...)` staying `null` until confirmed).
- For a browser-only value that's read once on mount and then user-togglable afterward (e.g. this
  switch's localStorage-backed default), a **lazy `useState(() => ssrGuard ? default : readIt())`
  initializer** avoids `react-hooks/set-state-in-effect` (see the earlier entry on that rule) just
  as well as `useSyncExternalStore` does, with less ceremony — reach for `useSyncExternalStore`
  instead only when something outside this component can also change the value while it's mounted
  (cross-tab storage events, another component's toggle) and needs the read to re-sync; a one-shot
  own-toggle case like this one doesn't need that.

- **`res.headers['content-type']` in the node:http(s) mock/live path is often the empty string,
  not undefined-vs-html.** When gating on content-type to skip non-HTML responses in
  `app/api/og-preview/route.ts`, checking `!/text\/html/.test(contentType)` alone rejects every
  response that simply omits the header (a real possibility, and what the test mocks in
  `og-preview-route.test.ts` do by default via `headers: {}`). Guard with `contentType &&
  !/text\/html.../.test(contentType)` so a missing header falls through to "try parsing it anyway"
  instead of silently returning null for the entire existing happy-path test suite.
- **Meta-tag attribute-order/name tolerance is worth generalizing into one regex-builder, not
  copy-pasting four near-identical regexes per tag.** `metaContentMatch(head, attrName)` in
  `og-preview/route.ts` builds both `attr-then-content` and `content-then-attr` variants for a
  single tag name, tried against `property=`/`name=` interchangeably in one call — real sites (MDN
  serves `og:image` via `name=`; others serve `twitter:image` via `property=`) mix these
  inconsistently and a hardcoded assumption per attribute misses roughly half of it.
- **Relative image URLs from a scraped page must resolve against the final URL post-redirects,
  not the originally-requested URL.** `fetchCapped()` now returns `finalUrl` alongside `body`/
  `contentType` specifically so `new URL(ogImage, finalUrl)` in `fetchPreview` uses the page that
  actually served the tag, not wherever the caller originally pointed.
- **Resend's `error` object on `.emails.send()` has `name`/`statusCode` fields safe to log — never
  log `error.message`,** since Resend error messages can embed the recipient/sender email address.
  `app/api/contact/route.ts` logs `console.error('[contact] send failed', { name, statusCode })`
  only; a thrown (non-Resend) exception falls back to `err.name` with `statusCode: undefined`.
- **Per-attribute-name backtracking regexes (`<meta[^>]+X["'][^>]+content=...`) are a real ReDoS
  surface, not just a style nit, once a fallback raises the scanned region to MAX_BYTES.** A hostile
  head with one unclosed `<meta` followed by tens of thousands of `property="og:image"` occurrences
  makes every occurrence's second `[^>]+` re-scan/backtrack across the rest of the document —
  ~O(n × occurrences), ~10^11 steps at 2MB. Fixed in `og-preview/route.ts` by scanning tags linearly
  with a single bounded regex (`<(meta|link)\b([^>]{0,2048})>` — the `{0,2048}` cap means a tag body
  is skipped, never backtracked, if absurdly long) and only then running an attribute regex against
  that already-bounded ≤2048-char substring. Same trick applies to any future HTML-scraping regex:
  bound the per-tag scan first, parse attributes second, never let attribute-name matching span the
  whole document.
- **WebP dimensions aren't readable via `file`/`identify` in this environment** (no ImageMagick) —
  parse the WebP RIFF header directly: bytes 12-16 give the sub-format (`VP8 `/`VP8L`/`VP8X`), then
  width/height live at different fixed offsets per sub-format (`VP8X`: 3-byte LE fields at offsets
  24/27, both stored as `value - 1`). Used this to confirm real screenshot dims for the beta page's
  `next/image` `width`/`height` props instead of trusting the existing (sometimes stale) values.
- **`next.config.ts`'s `images.qualities` allow-list is required, not optional, once any `<Image
  quality={N}>` prop is used where N isn't 75.** Next only serves qualities present in that array
  (default `[75]`); passing an unlisted quality throws at request time, not build time.
- **The beta page's search test description was simply wrong before this pass** — Ctrl/Cmd+K search
  in `Header/SearchOverlay.tsx` is a plain case-insensitive `.includes()` substring match on tab
  title/URL (plus `group:`/`window:`/`tag:` prefix scoping with a picker), not letters-in-order
  fuzzy matching. `fuzzyMatch` (in `Windows/index.tsx`/`Tab.tsx`) only drives in-list highlighting,
  a separate code path from the overlay's `getResults()`. When documenting UI behavior for the beta
  page (or anywhere user-facing), trace the actual matching function called by the component in
  question — a plausible-sounding feature description (fuzzy search) can persist for a while if
  no one traces the real code path it claims to describe.
- **The extension's Settings.tsx has no "reminders" control at all** — reminders are set per-tab via
  right-click → "Remind me…" (`Windows/Tab.tsx`), never surfaced in the Settings modal. A prior beta-
  page item hedged with "if reminders are available in Settings" instead of just checking — moved it
  to the correct place (the "Groups and tabs" area) with the real per-tab entry point once traced.
- **Two independent encryption-key caches exist for the same account — extension vs web dashboard —
  and they're not the same "unlocked" state.** Extension: `chrome.storage.local`, unlocked once ever
  per device until sign-out (`encryptionKey.ts`). Web dashboard: `sessionStorage`, unlocked once per
  browser tab, cleared on tab/browser close (`lib/encryption/context.tsx`). A tester who unlocks in
  the extension will still get re-prompted on the dashboard (and vice versa per new tab) — document
  this explicitly rather than implying one unlock covers both surfaces.
- **`shared_bundles` has an `expires_at` column and an owner-only DELETE RLS policy (migration 009),
  but nothing in the app ever sets `expires_at` on insert or calls delete from any UI** — grepped the
  whole extension and web packages for `shared_bundles` usage to confirm before writing "no revoke/
  expiry" copy into the beta page; the DB-level capability existing is not the same as a tester-
  reachable feature existing. Always grep for actual callers before describing a "not possible" gap,
  not just the absence of a button you happened to notice.
- **`docs/PUBLISHING.md`'s new "Browsers and stores" section is the canonical source for which
  browsers TabMerger supports and how each maps to a store/ID** — used it to correct
  `FAQ.tsx`'s stale "Firefox support is on our roadmap" (TabMerger has actually been live on
  Firefox Add-ons for a while) and its "stay in sync in real time" claim (sync runs when the
  popup is open, per `useSync`, not continuously in the background — CLAUDE.md says this
  explicitly). Also learned mid-task: don't casually link the beta page to the *stable* Firefox
  AMO listing as a "test it here" fallback — that stable release can be far behind the beta
  (was v2.0.0 at the time), so pointing beta testers there is actively misleading. The safe
  beta-page framing for Firefox until a real Firefox beta ships: "join with any of the supported
  Chromium browsers" — no external link at all. The *stable* FAQ can still legitimately list
  Firefox Add-ons as an install link since that page describes the stable product truthfully.
