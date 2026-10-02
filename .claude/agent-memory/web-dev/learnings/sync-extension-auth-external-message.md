---
name: sync-extension-auth-external-message
description: Pattern for forwarding Supabase session to the extension via externally_connectable, replacing the old content-script approach
metadata:
  type: project
---

Moved "forward Supabase session to extension" from the extension's content script (which required host permissions on the web origin) to the web app itself, sending externally via `chrome.runtime.sendMessage(EXTENSION_ID, {...})` from a normal page script — same channel `useExtensionInstalled.ts`'s PING probe and `SyncIndicator.tsx`'s SYNC_NOW already use (`externally_connectable`).

Implementation: `packages/web/lib/hooks/useSyncExtensionAuth.ts` subscribes to `supabase.auth.onAuthStateChange` and on every event with a non-null session, fires `{ type: 'SYNC_AUTH', accessToken, refreshToken }`. Mounted by calling the hook inside `SyncIndicator.tsx` (already a client component rendered in `(app)/layout.tsx` for every authed page) rather than adding a new wrapper component to the layout — reuse over new scaffolding.

Gotcha: any test file that mocks `@/lib/supabase/client`'s `createClient()` return value must now also stub `auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) }` or components using this hook will throw `Cannot read properties of undefined (reading 'onAuthStateChange')` at mount. Bit `SyncIndicator.test.tsx` here.
