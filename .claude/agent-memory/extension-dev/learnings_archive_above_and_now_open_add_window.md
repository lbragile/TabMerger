## Archive-group "activate group above" + Now Open "Add Window"

- `useArchiveGroup` (useGroups.ts) never removes/reorders the group in `available` —
  it only flips `archived: true`. So `activeGroupIndex` (an index into `available`)
  never needs shifting for OTHER groups when one is archived — only the archived
  group's own displayed neighbor matters. This is unlike `useDeleteGroup`, which DOES
  splice the array and already had its own index-recompute logic.
- "Above" in the sidebar is NOT raw array order — extracted the exact derivation
  `SidePanel/index.tsx` used inline (Now Open first, then starred saved groups, then
  unstarred, each zone's relative order preserved, archived filtered out) into
  `src/lib/sidebarOrder.ts`'s `getSidebarDisplayOrder()`, and now both `SidePanel` and
  `useArchiveGroup` import it. Any future change to the sidebar's ordering rule must
  update this one function, not both call sites separately.
- `useArchiveGroup` reads `qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)` (may be
  `undefined` in tests that don't seed the cache) to compute the pre-archive display
  order, then after `mutate()` resolves, checks `next.available[groupIndex]?.archived
  === true` (guards the permanent-group refusal no-op) AND
  `useUIStore.getState().activeGroupIndex === groupIndex` before reassigning — reading
  via `useUIStore.getState()`/`.setActiveGroupIndex()` directly inside `mutationFn`
  rather than a hook value, since a hook value closed over at render time would be
  stale by the time the async mutation resolves.
- Gotcha: `useUIStore`'s `setActiveGroupIndex` calls `setSetting(...)` from
  `@/lib/localDb` as a fire-and-forget side effect. Any test file that `vi.mock`s
  `@/lib/localDb` with only `{ saveGroupsState, getGroupsState }` and then exercises a
  mutation hook that (directly or transitively) calls `setActiveGroupIndex` on the
  REAL (unmocked) `uiStore` will crash synchronously (`setSetting is not a function`)
  — add `setSetting: vi.fn()` to the mock.
- `useGroups.test.ts` shares one real `uiStore` singleton across the whole file (only
  `localDb` is mocked, not the store) — `activeGroupIndex` leaks between tests unless
  each archive test resets it with `useUIStore.setState({ activeGroupIndex: 0 })` in a
  `beforeEach`.
- Now Open's "Add Window" button: verified `useCurrentTabs`'s `syncNowOpen` only drops
  windows with `tabs.length === 0` and the extension's own pages — a freshly
  `chrome.windows.create({})`'d window (New Tab page) has 1 tab and is NOT filtered,
  so it needed ZERO changes to `useCurrentTabs` to show up; only `Windows/index.tsx`
  needed a permanent-group branch that calls `chrome.windows.create({})` instead of
  `useAddWindow`. The `NewWindowDropZone` (drag-to-create) was deliberately left
  hidden for Now Open — enabling it means moving a REAL live tab into a REAL new
  window, a bigger behavior change explicitly out of scope.
- Test gotcha: `chrome.windows` isn't in the global stub (`src/__tests__/setup.ts`
  only stubs `chrome.storage`) — any test file exercising `chrome.windows.create`
  needs its own `globalThis.chrome = { ...globalThis.chrome, windows: { create:
  vi.fn() } }`, typically in `beforeEach` so `vi.clearAllMocks()` doesn't wipe it.
- Pre-existing, unrelated failure observed in the full suite:
  `src/__tests__/unit/lib/tabAccess.test.ts` > "returns null when VITE_WEB_APP_URL is
  unset" — fails independent of this change (a `VITE_WEB_APP_URL` env-stub leak
  between test files, same class of issue as the one already noted for
  `TabPreview.fetchedRef` in `learnings_supabase_env_import_crash.md`). Not touched or
  fixed here.
