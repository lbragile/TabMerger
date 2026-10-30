---
name: learnings-ai-byok-model-choice
description: Pro AI own-key (BYOK, Anthropic/OpenAI/Google) + model picker in the extension — key storage, two AI flags, WXT auto-import class trap, error mapping, cost levels, catalog/test gotchas
metadata:
  type: reference
---

Where things live: `lib/byokKey.ts` (key in `chrome.storage.local` `aiByokKey` as `{ userId, key, provider }`,
never in `appSettings`; cleared in `useAuth.signOut`), `lib/aiErrors.ts` (QuotaExceededError,
AiRequestError, `aiErrorMessage`, `isFixedInAiSettings`; deliberately NOT re-exported from `hooks/useAI`),
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

- **WXT auto-import (unimport) class trap — blanked the dev popup.** WXT auto-imports every export
  of `src/components|composables|hooks|utils`. unimport skips a module's own declarations by
  regex, and its class pattern is `class Name {`, so `class Name extends Base {` is NOT seen as a
  declaration. `export { AiRequestError } from '@/lib/aiErrors'` in `hooks/useAI.ts` made the dev
  server inject `import { AiRequestError } from "/src/hooks/useAI.ts"` into `lib/aiErrors.ts`
  itself: "Identifier 'AiRequestError' has already been declared", popup root empty. Production
  builds were fine, so only a dev-build check catches it. Never re-export into an auto-import
  folder from outside; guard: `__tests__/unit/wxt/autoImportCollisions.test.ts`. The running dev
  server keeps the old auto-import registry in memory after the fix: it must be restarted.
- **Two AI flags** (`lib/aiFlag.ts`): `AI_ENABLED` = any option live, `AI_MANAGED_ENABLED`,
  `AI_BYOK_ENABLED` (managed implies byok, via shared `aiAvailability`). `useEntitlements` ANDs
  `aiFeatures` with the subscriber's own option (`isAiModeLive`). Every `vi.mock('@/lib/aiFlag')`
  must export all three names.
- **Providers:** one saved key; provider read from the key's shape (`byokKeyProvider`) and stored
  too (a stored provider that doesn't match the shape reads as "no key"). The picker shows `auto`
  plus `aiModelsForProvider(provider)`; `choiceForProvider` turns another provider's model into
  `auto` at display and request time, and saving a key of a new provider resets the draft.
- **No dollar figures in AI UI** (decision): own-key options show a cost level (`costLevel`: rank
  among the provider's models by summed `estimateAiCostUsd` over the examples), Auto lists the
  level per example; managed keeps credits. Tests build OpenAI/Google-shaped keys at run time
  (`'AIza' + 'z'.repeat(35)`) so no key-shaped literal lands in the repo.
- **Heredoc/regex pitfalls in this shell:** Python edit scripts passed through Bash heredocs
  failed to parse twice (quotes); write them to the scratchpad with Write. A `'\b'` written
  through a non-raw Python string can land as a literal backspace (0x08) in a TS regex: grep for
  `$'\b'` after scripted edits.
- **`.gitignore` ignores any folder named `build`**, including under `src/__tests__/` — a test placed in `__tests__/unit/build/` silently never gets committed. Check new paths with `git check-ignore -v`.

- **Provider first (Settings → AI, own key).** `AiProviderPicker` (a Select dropdown since the
  radios were replaced, see [[learnings-ai-settings-dropdowns]]) comes before
  anything provider-specific. Shown provider = `useByokKey().picked ?? saved?.provider`; the
  pick lives in `chrome.storage.local` `aiByokProvider` (`{ userId, provider }`), is forgotten
  when it equals the saved key's provider or a key is saved, and `clearByokKey` removes it too
  (Remove then re-picks the removed key's provider). `AiKeySetting` is keyed by provider, so a
  switch resets its draft. Setup links come from shared `AI_PROVIDER_KEY_LINKS` (guide + keys).
- **Focus after a query-driven view change needs a retry.** After `await refresh()` or
  `setQueryData`, react-query's observer update can land a render later, so a one-shot
  `useEffect` that focuses the new element finds `null` and focus falls to `<body>`. Keep the
  "focus X" flag until the target exists (depend on the view flag / provider) and clear it only
  after focusing.
- **The unit-test `chrome.storage.local.remove` stub takes ONE key** (setup.ts Map delete); an
  array silently removes nothing there. Use one call per key.
- **Own-key e2e** (`e2e/tests/aiByokSettings.spec.ts`): `signInAsPro` then re-route
  `**/rest/v1/subscriptions*` with `tier: 'pro_ai', ai_mode: 'byok'` (the later route wins) and
  stub `**/api/ai/byok/verify*`. The test skips on builds without `VITE_AI_BYOK_ENABLED` (no AI
  tab), which includes the production build CI tests; it runs against a local dev build.
