---
name: organize-e2ee-writeback
description: The organize workflow's E2EE approach — client sends plaintext groups in POST, server refuses content-bearing writebacks rather than re-encrypting
metadata:
  type: project
---

`/api/ai/organize` handles E2E encryption by **splitting reads from writes**, not by round-tripping ciphertext:

- **Read:** the extension POSTs `{ groups: [{id, name, permanent, tabs}] }` (only when `hasEncryptionKey()`), mirroring `/api/ai/suggest-sessions`. `fetchUserData` uses it verbatim and skips the DB entirely. Only a request with no groups (missing, null or empty `groups`) falls back to the service-role DB read; groups that are present but structurally invalid get a 400, and the DB read itself ends the run if a row is an encrypted blob. See [[ai-request-validation]].
- **Write:** `applyChanges` never re-encrypts. It calls `isEncryptedBlob(group.windows)` and pushes any *content-bearing* action (`rename`, `merge`) onto `skipped` for the client to re-apply locally through the sync engine. Only `delete` and `reorder` (row-level / position-only) run server-side.
- The web dashboard is **not** an E2EE client — `OrganizeProposal` takes an `encrypted` prop and renders a refusal card instead of streaming.

**Why:** the server holds no data key by design. Decision: the approve request does not accept pre-encrypted blobs, because merging two `windows` trees requires plaintext, so the server could not produce a correct blob anyway.

**How to apply:** any future AI route that *writes* user content must follow the same skip-and-report pattern. Never add a server-side re-encrypt path. If a route needs plaintext, take it from the client body; don't query `groups.windows`.

Related: [[suggest-sessions-shape]]
