---
name: organize-e2ee-writeback
description: The organize workflow's E2EE approach — client sends plaintext groups in POST, server refuses content-bearing writebacks rather than re-encrypting
metadata:
  type: project
---

`/api/ai/organize` handles E2E encryption by **splitting reads from writes**, not by round-tripping ciphertext:

- **Read:** the extension POSTs `{ groups: [{id, name, permanent, tabs}] }` (unless it confirmed there is no encryption key), mirroring `/api/ai/suggest-sessions`. The POST route itself loads the groups (`loadOrganizeGroups` in `lib/ai-organize.ts`), calls the model, and starts the workflow with only the sanitized proposal and the pinned (Now Open) ids. Workflow arguments are persisted in its event log, so no tab data and no BYOK key may ever be passed to it. Only a request with no groups falls back to the service-role DB read, which 400s before the model call if a row is not a plaintext array. See [[ai-request-validation]], [[ai-metering-flow]].
- **Stream:** the workflow's `publishProposal` step writes one JSON array of actions and closes the stream (what `OrganizeProposal.tsx` parses). The approval hook is created before publishing, so an immediate approval always finds it.
- **Write:** `applyChanges` never re-encrypts. It calls `isEncryptedBlob(group.windows)` and pushes any *content-bearing* action (`rename`, `merge`) onto `skipped` for the client to re-apply locally through the sync engine. Only `delete` and `reorder` (row-level / position-only) run server-side.
- The web dashboard is **not** an E2EE client — `OrganizeProposal` takes an `encrypted` prop and renders a refusal card instead of streaming.

**Why:** the server holds no data key by design. Decision: the approve request does not accept pre-encrypted blobs, because merging two `windows` trees requires plaintext, so the server could not produce a correct blob anyway.

**How to apply:** any future AI route that *writes* user content must follow the same skip-and-report pattern. Never add a server-side re-encrypt path. If a route needs plaintext, take it from the client body; don't query `groups.windows`.

Related: [[suggest-sessions-shape]]
