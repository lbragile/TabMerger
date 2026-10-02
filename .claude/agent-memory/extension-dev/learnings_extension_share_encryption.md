---
name: learnings-extension-share-encryption
description: Extension's sharing.ts createSharedBundle was inserting plaintext groups_snapshot while the web share path encrypted; fixed to match
metadata:
  type: project
---

`packages/extension/src/lib/sharing.ts`'s `createSharedBundle` (invoked from `SelectionActionBar.tsx`'s Share button, groups selection type) was a second, older share-creation path that bypassed the E2E encryption scheme the web dashboard's `/api/share-bundle` route already used — it inserted the raw `Group[]` into `shared_bundles.groups_snapshot`, leaking titles/URLs/notes in plaintext.

Fixed by reusing `@tabmerger/shared`'s crypto module (`generateDataKey`, `encryptBlob`, `exportKeyToBase64` — already built/tested, do not modify) client-side before the Supabase insert: `groups_snapshot: { v: 1, iv, ct }`, and the returned share URL gets `#key=<base64>` appended as a fragment (never sent to the server).

**Why:** two independent share-creation code paths (web API route + extension direct-Supabase-insert) had drifted — only the web path got upgraded to E2E encryption when the encryption work landed. `ShareBundleContent.tsx` (the shared reader for both) already expected the `{v:1,iv,ct}` shape and decrypts via the URL fragment, so the extension path was silently broken from a security standpoint even though it "worked" functionally.

**Key format detail:** `exportKeyToBase64` produces *standard* base64 (not base64url) — contains `+`, `/`, `=`. `ShareBundleContent.tsx` deliberately avoids `URLSearchParams` for parsing the fragment (regex `hash.slice(1).match(/(?:^|&)key=([^&]*)/)` + `decodeURIComponent`) because `URLSearchParams` decodes `+` as a literal space per form-encoding convention, corrupting ~1/4 of keys. Any new share-link-building code must match this exact standard-base64 + regex-parse pairing, not URL-encode the key into a differently-decoded form.

**How to apply:** Whenever a new share/export path is added anywhere in the monorepo that touches `shared_bundles` or any other public-facing encrypted-blob table, check both the web app's route AND the extension's direct-Supabase path — they are not automatically kept in sync, and grep for all `groups_snapshot` insert sites before assuming there's only one.
