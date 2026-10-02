---
name: learnings-persistent-unlock-local-storage
description: Deliberate product/security decision to persist the unwrapped E2E data key in chrome.storage.local forever, so unlock is one-time-per-device — supersedes the earlier session-only approach
metadata:
  type: project
---

Deliberate product decision (not a bug fix): the recurring
"Unlock" prompt was removed entirely. Once a user unlocks once on a device, they are never
asked again — not on popup close, not on service worker restart, not on full browser
restart — barring explicit sign-out.

This **supersedes** [[learnings_encryption_locked_sync_silent_gap]], which had the data key
cached in `chrome.storage.session` (memory-only, cleared on browser restart). That was an
intermediate state, not the final design — do not "fix" this back to session-only storage
without re-reading this file; the tradeoff below was made explicitly.

**Why this is an accepted tradeoff, not an oversight:** local IndexedDB already stores all
group/tab content in plaintext at rest on the device, regardless of E2E encryption. The E2E
encryption's actual threat model has only ever been "protect against a Supabase/server-side
breach," never "protect against local device compromise." Persisting the unwrapped key in
`chrome.storage.local` doesn't weaken that specific guarantee — an attacker with local
device access already has the plaintext data via IndexedDB either way.

**Technical constraint that shaped the implementation:** `chrome.storage.local` JSON-
serializes values — it CANNOT hold a live `CryptoKey` object directly via structured clone
the way `chrome.storage.session` can. Confirmed this is a real limitation, not an assumption:
had to export the key to raw bytes (base64) before storing, and re-import (non-extractable)
on read. This required `unwrapDataKey(..., extractable: true)` in `unlockEncryption` (was
`false` before) so `cacheDataKey` can call the shared `exportKeyToBase64` helper — that
helper already existed, built for the web app's `sessionStorage` caching in
`packages/web/lib/encryption/context.tsx`, so no new shared crypto code was needed, just
reuse.

**UI consolidation:** `Settings.tsx`'s Account tab previously hand-rolled its own inline
unlock form (passphrase input + button). That's now gone entirely — Settings only shows a
passive "Unlocked on this device." status line once unlocked, no action button ever. The
only place an unlock prompt can appear is `EncryptionSetupModal`
(`packages/extension/src/components/Modal/EncryptionSetup.tsx`), which now self-detects via
`hasEncryptionKey()` on mount whether to show the two-field "Set up encryption" form (no key
row yet) or the "Unlock encryption" form (key exists, this device hasn't unlocked it) —
`useSync.ts`'s `doSync` opens this same modal for both gates now, instead of the old
dismissible "Sync is locked" toast for the locked-but-has-key case. That toast/`sonner`
import was removed from `useSync.ts` entirely.

**Test infra note:** `src/__tests__/setup.ts`'s global chrome stub had the real
read-your-writes `Map`-backed store on `chrome.storage.session` before (because
`encryptionKey.ts` used to persist there); it moved to `chrome.storage.local` to match. If a
future change touches this stub, check which storage area the code under test actually
reads/writes — the two areas' stubs are NOT symmetric (only one has real Map semantics, the
other resolves to `{}`).

**Web app was NOT touched** — `packages/web/lib/encryption/context.tsx` still uses
`sessionStorage` (tab-scoped, cleared on tab close). Flagged as a much smaller annoyance
than the extension's popup-teardown-triggered re-prompting (a web tab staying open is a much
longer-lived session than an MV3 popup), left as a known follow-up if ever raised.
