# Extension Dev Learnings

## Local types.ts is not re-exported from shared

`packages/extension/src/lib/types.ts` is a **duplicate** of `packages/shared/src/types/index.ts`, not a re-export. Adding a field to the shared package's `Tab` interface does NOT update the local one — you must update both files. The extension's hooks and components import from `@/lib/types`, not `@tabmerger/shared`.

## Tab type fields must be added in both places

Pattern: when adding a new field to `Tab` or `Group`, always check and update:
1. `packages/shared/src/types/index.ts`
2. `packages/extension/src/lib/types.ts`

## useGroupsMutation is not exported

`useGroupsMutation` is a private internal helper in `useGroups.ts`. To expose group mutation logic to components, create a new exported hook (e.g. `useRemoveStaleTabs`) that uses it internally, rather than re-exporting the low-level mutator.

## Tab type imports in useGroups.ts

`useGroups.ts` only imported `Group` and `GroupsState` from `@/lib/types`. If you add logic in that file that references the `Tab` type, add it to the import line.

## Settings are stored under a single key with merged objects

All app settings live in IndexedDB under the key `'appSettings'` as one object (read with `getSetting<AppSettings>('appSettings', DEFAULT_SETTINGS)`). To add a new setting, add it to the `AppSettings` interface and `DEFAULT_SETTINGS` default object in `Settings.tsx`, then read it anywhere via `getSetting<{ yourField?: T }>('appSettings', {})`.

## chrome.alarms survive extension reload but not browser restart

`chrome.alarms` registered in the popup or background are lost when the browser restarts. To survive restarts, also write alarm metadata to `chrome.storage.local` (keyed by alarm name) and re-register any missing alarms in the background script's startup path (`chrome.runtime.onStartup` + the immediate `defineBackground` body). Check `chrome.alarms.getAll()` first to avoid duplicating still-live alarms.

## useSetTabReminder: mutate returns the saved state

`useGroupsMutation` (the internal helper) returns the saved `GroupsState`. You can `await mutate(...)` and read the just-written tab from `state.available[g][w].tabs[t]` to get the final id/url before registering the alarm — no second IDB read needed.

## Stale indicators: read threshold once at panel level, pass down

For per-tab derived state that depends on a setting (like stale age), read the setting once at `WindowsPanel` level via `useEffect` + `useState`, then pass the threshold as a prop through `WindowItem` → `TabItem`. Avoids N async reads per render.
