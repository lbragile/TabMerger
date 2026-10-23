---
name: ai-metering-flow
description: How managed AI calls are metered (count_tokens -> ai_reserve_credits -> call -> ai_settle_credits) and the test gotchas that come with it
metadata:
  type: project
---

Every `/api/ai/*` model call goes through `runAiTask` in `packages/web/lib/ai.ts`; the route-side steps (auth, plan, BYOK key, model allowlist, client + meter) are in `lib/ai-route.ts`.

Managed flow: `messages.countTokens` with the exact create params minus `max_tokens` -> `reserveCredits` (RPC `ai_reserve_credits`, amount = `aiCallCredits(model, input, max_tokens)`) -> `messages.create` -> `settleCredits` (RPC `ai_settle_credits`, delta = actual − reserved, actual from `usage` input + cache tokens + output incl. thinking).
- The month is fixed once per request in the meter (`currentMonth()` in `resolveAiContext`), so a call that crosses midnight UTC at a month's end settles the row it reserved in.
- Thrown API error (no usage) -> settle `-reserved` (release). Refusal / `max_tokens` / unparseable output -> charged, then an error (`ai_refused` 422, `ai_failed` 502).
- Settle throws -> logged, reservation kept. Settle returns `null` (no row) -> nothing to settle, not an error.
- A reservation failure (DB error) refuses the request (500) instead of running unmetered.
- Remaining credits = `cap − credits_used` returned by settle; sent in `AI_CREDITS_REMAINING_HEADER`, which `proxy.ts` must list in `Access-Control-Expose-Headers` or the extension cannot read it.

BYOK: `anthropicClient('byok', key)` per request, no count/reserve/settle, no balance header. Anthropic errors map through `mapAnthropicError` to `byok_*` codes, never 401/429. Logs go through `describeErrorForLog` (name/status/type/requestID only), never the error object or message.

Test gotchas:
- Haiku 5.5 is so cheap that a short call's reservation and real cost both round up to 1 credit, so delta = 0 and settle is skipped. Use Opus in tests that assert a settle call.
- The Anthropic SDK refuses to construct in jsdom ("browser-like environment"), so route tests must `vi.mock('@anthropic-ai/sdk')` even when `runAiTask` itself is a spy.
- Use `vi.hoisted` for SDK mock state shared with the mock factory; capture the constructor's `apiKey` to prove which key a request used.

Related: [[ai-request-validation]], [[model-request-settings]], [[organize-e2ee-writeback]]
