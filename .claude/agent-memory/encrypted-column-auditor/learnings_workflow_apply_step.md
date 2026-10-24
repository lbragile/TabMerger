---
name: workflow-apply-step
description: How to audit a server-side apply step (durable workflow or plain route) that merges/renames/deletes encrypted groups rows, and the actions-only alternative organize moved to
metadata:
  type: reference
---

`/api/ai/organize` no longer has a server apply step: it returns `{ actions }` keyed by `Group.id` and the extension applies them locally after review (the Workflow DevKit run, the approve route and the `organize_runs` writes were removed). Prefer that shape for any new AI route that changes groups. If a server-side apply step ever comes back, these checks apply:

- Encrypted `groups` rows keep everything (name, windows, note, info) inside the `windows` blob and write `name: ''`, `note: null`, `info: ''` (see `pushGroup` in the extension's `syncEngine.ts`). Per-row ciphertext detection must key on `windows`, not `name`.
- Merge is the dangerous action: it rewrites one row's `windows` from two rows' values and deletes the other. Any row whose `windows` is not a plain array must be skipped, not coerced to `[]`. Use an allow-list (`Array.isArray`), not `isEncryptedBlob`, which only matches `v === 1`.
- `reorder` (`position`) and `delete` (whole row) touch no content column and are ciphertext-safe.
- Durable-workflow arguments and stream writes are persisted server-side (event log). Ids, model-written names and rationales are plaintext derived from decrypted tabs.
- A step's return value is not seen by the caller of the route that resumed the hook; anything "reported back" (such as skipped actions) needs an explicit read path to a client.

For an actions-only route, the audit reduces to: the response carries ids and model-written names only, `sanitizeOrganizeProposal`-style filtering keeps ids to the ones sent, and nothing is inserted or upserted besides metering counts.
