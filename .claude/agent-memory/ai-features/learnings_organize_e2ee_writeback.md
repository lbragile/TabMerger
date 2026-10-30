---
name: organize-e2ee-writeback
description: How /api/ai/organize handles E2EE — synchronous route, client sends decrypted groups, server answers { actions } and never writes; why the old Workflow + dashboard approval path was removed
metadata:
  type: project
---

`POST /api/ai/organize` is a plain synchronous AI route: one metered (or own-key) model call, answered as `{ actions: OrganizeAction[] }` (`OrganizeAction` / `OrganizeResponse` live in `packages/shared/src/types`). The extension reviews the proposal in the popup and applies the accepted actions to its local groups, which then sync re-encrypted through the normal path. The server stores nothing and writes nothing.

- **Read:** the extension POSTs its decrypted `{ groups: [{id, name, permanent, tabs}] }` unless it confirmed there is no encryption key. Only a request with no groups reads the stored rows (`loadStoredOrganizeGroups` in `lib/ai-organize.ts`), which 400s before the model call if any row's `windows` is not a plaintext array.
- **Answer:** `sanitizeOrganizeProposal` (lib/ai.ts) keeps only ids from the request, never names a permanent group in merge / rename / delete, and cleans and caps rename text at 30 chars. The rationale is dropped from the response.
- **Write:** none on the server.

**Why:** every signed-in Pro account is E2E-encrypted and the server holds no key, so a server-side apply step can never merge or rename. The earlier design (Workflow DevKit run, `organize_runs`, GET stream, approve route, web-dashboard `OrganizeProposal`) could only skip those actions, needed `withWorkflow` + a proxy-matcher exclusion to run at all, and persisted proposals in Workflow storage. It was removed (2026-10-24). Leftovers: the `organize_runs` table (needs a drop migration) and the `workflow` / `@workflow/*` deps in packages/web/package.json (removal touches the lockfile).

**Decision:** no credit refund on any post-model failure. A refund would let a managed account repeat paid calls at no charge during an outage, putting provider spend outside the monthly cap. With the synchronous route there is no post-model server step left anyway.

**How to apply:** any future AI feature that changes user content returns a proposal for the client to apply; never add a server-side write or re-encrypt path for content columns.

Related: [[ai-request-validation]], [[ai-metering-flow]], [[groups-position-now-open]]
