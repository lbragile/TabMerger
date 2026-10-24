---
name: ai-request-validation
description: Every /api/ai/* body goes through lib/ai-validation.ts (zod) after auth and before the usage check; lists the order, the two tab-summary shapes, and two tooling gotchas hit while writing it
metadata:
  type: project
---

Every `/api/ai/*` handler reads its body with `readJsonBody` and a `parse*Body` helper from `packages/web/lib/ai-validation.ts`. The helpers return sanitized data (only the fields the prompts use, text truncated, control characters and line breaks flattened to spaces) or the route's 400 message. Limits are the `AI_MAX_*` constants in that module.

Handler order: `aiDisabledResponse()` -> auth (401 `ai_unauthorized`) -> body validation (400 `{ error: 'ai_invalid_request', message }`) -> `resolveAiContext` in `lib/ai-route.ts` (403 `ai_plan_required` unless pro_ai + entitled status, 400 `byok_key_missing`, 400 `ai_model_invalid`) -> `runAiTask` (reserve, call, settle). A rejected body therefore never costs anything. The optional `model` field is read with `modelChoiceOf` and resolved with `resolveAiModel` from shared.

Every string that reaches a prompt is cleaned by `lib/ai-prompt-safety.ts` inside the zod transforms (`cleanUntrustedText` for titles/names, `cleanUrl` for URLs). `cleanUrl` returns `''` for text that does not parse as a URL, and reduces non-http(s) URLs to the scheme, so test fixtures need real URLs.

**Why:** titles and URLs come from web pages and reach model prompts, so length caps bound prompt size and cost, and one shared module keeps the routes consistent.

**How to apply:**
- A new AI route adds its schema and `parse*Body` helper to `lib/ai-validation.ts`; it does not call `request.json()` itself.
- Truncate text, reject only wrong types, empty arrays and counts above a ceiling.
- Tabs inside a group (`organize`, `suggest-sessions`) are read tolerantly: an entry without a string `url` is dropped and a non-string `title` becomes `''`, because imported groups can hold such tabs. Structural problems (group without string id, string name, tabs array) are a 400.
- `organize` returns `data: null` (stored-rows path) only when no groups were sent: non-object body, or `groups` missing, null or empty. Decision: groups that are present are used or rejected, never replaced by the stored-rows read, because for an encrypted account those rows are ciphertext. `loadStoredOrganizeGroups` (`lib/ai-organize.ts`) answers 400 with `ORGANIZE_NEEDS_CLIENT_DATA_ERROR` before the model call if a row's `windows` is anything but an array; the check is on the readable shape, not on `isEncryptedBlob`, so a later blob version is covered too.
- A group sent with tabs that has none left after the tolerant read is left out of the result (`withoutEmptiedGroups`), and a request left with no groups is a 400. Decision: an unreadable group must not look empty to the model, because the organize instructions allow removing empty groups. A group sent with `tabs: []` is kept.
- `tab-summary` accepts `{ url, title }` (shared `AITabSummaryRequest`, what the extension sends) and `{ tab: { id, title, url } }`; both become `{ title, url }`.
- Organize's answer type is `OrganizeAction` in `@tabmerger/shared` (the extension imports it too). The rename field is `newName`, capped at `AI_MAX_RENAME_LENGTH` (30).
- Model output is bounded in `lib/ai.ts`: each task's `parse` cleans it (`sanitizeTabGroups`, `sanitizeOrganizeProposal`: only ids that were sent, never a permanent group).
- Gotcha: writing a ` ` or ` ` escape through the Edit/Write tools can land as the raw character, which ends a regex literal ("Unterminated regular expression literal"). Check the bytes after writing, or build the character with `String.fromCharCode` in tests.
- Gotcha: `vi.clearAllMocks()` keeps mock implementations, so a `mockRejectedValue` set in one test in `ai-routes.test.ts` leaks into later describes. Reset the mock in the later `beforeEach`.

Related: [[ai-kill-switch]], [[organize-e2ee-writeback]]
