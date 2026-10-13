---
name: worker-paid-action-review-method
description: Audit questions for a background-worker action that checks tier/identity then writes to Supabase (identity re-check, sender checks, RLS update proofs)
metadata:
  type: reference
---

Questions to ask when a service-worker job checks "who is signed in / are they paid" and then uploads or deletes rows:

- **Identity is read once, used many times.** Helpers that call `supabase.auth.getSession()` again (upload, delete, key lookup) act for whoever is signed in at THAT moment. The web bridge can replace the session at any time, and a bridge message also wakes the worker, which starts the "on worker start" job in parallel with the session swap. Look for: the user id captured at the top being passed down and written as `user_id` (so RLS rejects a mismatch), and a re-check right before local writes.
- **`sender.id === chrome.runtime.id` is true for content scripts too.** "Own pages only" needs `!sender.tab` or an extension-origin `sender.url` as well. For any relay content script, check the object spread order when it builds the forwarded message: a payload spread after `type` lets the page choose the type.
- **`onMessageExternal` is a separate event**; a listener on `onMessage` never sees external messages.
- **RLS UPDATE denial is silent.** A failed `USING` gives 0 rows and no error, so a pgTAP proof must assert the row is unchanged, not `throws_ok`. An upsert on an existing id by an unpaid account fails on the INSERT `WITH CHECK` (42501) before the conflict path. A test of INSERT alone does not prove either.
- **A text primary key that is global (not per user)** means ids from one account's pending-delete list cannot name another account's rows; with `.eq('user_id', me)` plus the delete policy a replay is a no-op. A no-op still reports success, so the list is cleared.
- **Client rotation is not a server cap.** Check migrations for a row-count trigger or a size check before calling storage bounded.
