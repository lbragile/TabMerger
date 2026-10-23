---
name: learnings-ai-byok-model-choice
description: Pro AI own-key (BYOK) + model picker in the extension — key storage, error-code mapping, entitlement read fallback, Settings footer, catalog/test gotchas
metadata:
  type: reference
---

Where things live: `lib/byokKey.ts` (key in `chrome.storage.local` `aiByokKey` as `{ userId, key }`,
never in `appSettings`; cleared in `useAuth.signOut`), `lib/aiErrors.ts` (QuotaExceededError,
AiRequestError, `aiErrorMessage`, `isFixedInAiSettings`; re-exported from `hooks/useAI`),
`lib/aiModel.ts` (`readAiModelChoice`, `estimatesFor`, `organizesFor`), and
`components/Settings/AiSettings.tsx` + `AiKeySetting.tsx` + `AiModelPicker.tsx`.

Non-obvious points:
- **Error classes live outside `hooks/useAI`.** Many component tests `vi.mock('@/hooks/useAI')`
  with a fixed export list; a new named import from that module throws there (see
  [[vitest-dndkit-mocks]]). Components import `AiRequestError`/`isFixedInAiSettings` from
  `@/lib/aiErrors`, which those tests leave real.
- **Error-code messages are a complete `Record<keyof typeof AI_ERROR_CODES, MessageKey>`**, so a
  code added to the shared constant fails `tsc` until it has a message; unknown codes from a newer
  server fall back to `errors.ai.failed`.
- **`ai_mode` is read with a fallback.** `fetchSubscription` selects `ai_mode` only while AI is on
  and re-reads without it on any error: a failed select would otherwise resolve the tier to
  `free` for every payer on a database without the column.
- **`useAiUsage().known`.** The cap falls back to `PRO_AI_MONTHLY_CREDITS` for display while
  loading or after a failed read; the client estimate check in `useAI` only refuses when
  `known` is true. BYOK disables the query entirely.
- **Settings footer.** Save/Restore used to render only on the General tab, so the AI tab's
  toggles had no way to be saved; the footer now shows on General and AI (the model picker edits
  the draft). The key itself saves immediately via its own button after `/api/ai/byok/verify`.
- **Settings can open on a tab:** `openModal('settings', { tab: 'ai' })` (validated list in
  Settings.tsx). Used by the quota prompt's "Change model" and the "Open Settings" toast action.
- **`toast.error(msg, undefined)` breaks `toHaveBeenCalledWith(msg)`** in existing tests; call
  with options only when there is an action.
- **Test API keys:** keep them under the secret scanner's `sk-ant-` + 32-char threshold
  (`sk-ant-test-xxxxxxxxxxxxxxxx` passes `isAnthropicApiKey`, which needs 20+).
- **i18n lint:** JSX attribute string literals (even `placeholder="sk-ant-…"`) fail
  `no-restricted-syntax`; a module constant is fine for untranslatable formats.
- **Catalog edits by script:** the locale JSON files are CRLF, 2-space, and escape U+2066–U+2069
  (`⁨`) and private-use chars; `json.dumps(indent=2, ensure_ascii=False)` round-trips them
  exactly once those are re-escaped. Plural families need exactly the `Intl.PluralRules` forms
  per locale (ar 6, he one/two/other, fr/es/it/pt-BR one/many/other, ru/pl 4, ja/ko/zh/vi/id
  other); placeholders are compared as the union across forms, so a form may drop `{{count}}`
  or another value. A "Label: ≈ {{formatted}}" phrasing avoids noun agreement where forms are many.
- **Bash `sed` replacement strings eat `\d`** — edit regexes in test files with the Edit tool.
