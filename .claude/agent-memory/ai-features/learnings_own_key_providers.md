---
name: own-key-providers
description: How own-key (BYOK) AI requests reach Anthropic, OpenAI or Google — provider detection, the fetch adapters in lib/ai-providers.ts, per-option flags, error mapping and key hygiene
metadata:
  type: project
---

Own-key requests go to the provider the key belongs to (`byokKeyProvider` in shared reads the key's shape; header `X-AI-Key`). Managed requests always run on Anthropic. `resolveAiModel(choice, action, provider)` rejects a model of another provider (400 `ai_model_invalid`); a header that is no supported key → 400 `byok_key_invalid`, no header → 400 `byok_key_missing`.

- `lib/ai.ts` `runAiTask` branches on `ctx.provider`: Anthropic keeps the SDK path with metering; OpenAI/Google go through `lib/ai-providers.ts` (plain `fetch`, `AbortSignal.timeout`, no SDK dependency), unmetered and without token counting. Prompt framing, schema and answer cleaning are shared.
- OpenAI: Responses API `POST /v1/responses`, `instructions` + `input`, `text.format` json_schema `strict: true`, `reasoning.effort` (`none` only on GPT-6 Luna; Sol/Astra start at `low`), `store: false`. Refusals are `refusal` content parts or `incomplete_details.reason: content_filter`. Billing problems are 429s too: tell them from rate limits by `error.code` (`insufficient_quota`, `credit_balance_exhausted`, `*_spend_limit_exceeded`, `organization_usage_limit_exceeded`).
- Google: `generateContent` with `responseMimeType: application/json` + `responseJsonSchema`, `thinkingConfig.thinkingLevel` (`minimal` on 3.1 Flash-Lite, `low` on 3.8 Flash / 4 Argon). Key only in `x-goog-api-key`, never `?key=`. Skip `thought: true` parts. Blocks come as `promptFeedback.blockReason` or finishReason SAFETY/PROHIBITED_CONTENT/… Bad key is often 400 INVALID_ARGUMENT with ErrorInfo reason `API_KEY_INVALID`, so read `error.details[].reason`. The docs site now shows only the newer Interactions API; generateContent is still in the API reference.
- Structured-output schemas use `enum: ['x']` instead of `const`, which OpenAI strict mode and Gemini don't document.
- Provider error codes are logged, so only a short machine-code shape is kept (`ERROR_CODE_SHAPE`); free text from a provider body never reaches logs or responses (a provider could echo the key).
- `/api/ai/byok/verify` costs nothing: Anthropic `count_tokens`, OpenAI `GET /v1/models/{model}`, Google `GET /v1beta/models/{model}`; returns `{ ok: true, provider }`.
- Flags: `aiDisabledResponse()` (first statement) 503s only when no option is live; `aiModeDisabledResponse(mode)` runs right after the subscription lookup (in `resolveAiContext`, the approve route and verify), before any reservation or model call.

Related: [[ai-metering-flow]], [[model-request-settings]], [[ai-kill-switch]]
