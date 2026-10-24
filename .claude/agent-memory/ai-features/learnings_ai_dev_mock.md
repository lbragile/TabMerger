---
name: ai-dev-mock
description: Dev-only AI mock (AI_MOCK=true) in packages/web/lib/ai-mock.ts — where the seam is, why count_tokens is mocked too, how over_quota reaches the real reservation, gate and test gotchas
metadata:
  type: project
---

`lib/ai-mock.ts` is the only dev AI mock (the extension's old client-side fetch mock was removed). It replaces only the provider calls, so flags, auth, plan checks, validation, metering and each task's `parse` run for real.

- **Seams:** in `callAnthropic` both `client.messages.countTokens` and `.create` are swapped (managed metering calls count_tokens first, which is a network call too); in `callOwnKeyProvider` the `callOpenAi`/`callGoogle` call; in `/api/ai/byok/verify` the key check. Organize needs nothing extra: its model call is `runAiTask` in the route like every other task.
- The mock builds answers from `task.action` + `task.data` (already cleaned), never by parsing the prompt text back.
- **Gate:** `AI_MOCK === 'true'` && `NODE_ENV === 'development'` && no `VERCEL_ENV`/`VERCEL`. Read per call so `vi.stubEnv('NODE_ENV', 'development')` works in tests.
- **Errors are provider-shaped** (an `AiMockAnthropicError` with `status` + `error.error.type`, or a `ProviderHttpError`), so `mapAnthropicError`/`mapProviderError` produce the codes; thrown create errors release the reservation like real failures.
- **Managed `error:over_quota`** is driven by the mocked count step reporting 100M input tokens, so the real `ai_reserve_credits` refuses and the 429 carries the real balance (`needed` is huge). Own-key over_quota is the provider's billing error (402 `byok_billing`).
- Managed `rate_limited` maps to 503 `ai_overloaded` (Anthropic rate limits never surface as 429 in managed mode), and managed `invalid_key` to 500 `ai_failed`.
- The SDK `Message` usage type has many required null fields; the mock returns `Pick<Message, 'content' | 'stop_reason' | 'usage'>` and `callAnthropic` reads only that shape, so no casts.
- Test gotcha: organize client payloads without `permanent` treat index 0 as Now Open (permanent), so fixtures need a Now Open group first or the merge target is skipped.
- `x-tabmerger-ai-mock: 1` is added by `withAiMockHeader` in `aiJson`/`aiErrorResponse` and the verify route.

Related: [[ai-metering-flow]], [[own-key-providers]], [[ai-kill-switch]], [[organize-e2ee-writeback]]
