---
name: model-request-settings
description: Per-model request settings for the 5.5 models (thinking, effort, max_tokens headroom), structured-output schema rules, and SDK 0.112.3 typing gaps
metadata:
  type: reference
---

`MODEL_REQUEST_SETTINGS` in `packages/web/lib/ai.ts`, checked against the `claude-api` skill (shared/models.md, shared/model-migration.md):
- `claude-haiku-5-5`: `thinking: {type:'disabled'}` (accepted at effort ≤ high), `output_config.effort: 'low'`.
- `claude-sonnet-5-5`: `disabled` is a 400; `{type:'between_tools'}` is its lowest setting (no thinking without tools), effort `low`. `between_tools` is a 400 on any other model.
- `claude-opus-5-5`: thinking cannot be disabled; omit `thinking`, effort `low`, and add `max_tokens` headroom (2,048) because thinking counts toward `max_tokens` and `usage.output_tokens`.
- No `temperature`/`top_p` on any 5.5 model (non-default values are a 400), no assistant prefill. The old "low temperature for JSON" guidance no longer applies; structured outputs replace it.

Structured outputs: `output_config.format = { type: 'json_schema', schema }`; every object needs `additionalProperties: false`; no min/max/length constraints; `enum`/`const`/`anyOf` are fine (group-tabs colours are an `enum` of `PRESET_COLORS`). Read text blocks by `type` (a response can start with `thinking` blocks). Check `stop_reason` for `refusal` and `max_tokens` before parsing.

SDK `@anthropic-ai/sdk` 0.112.3: has `output_config` (format + effort) and `messages.countTokens` (accepts `system`, `thinking`, `output_config`), but `ThinkingConfigParam` lacks `between_tools`, so it is sent through an `unknown` cast.

Related: [[ai-metering-flow]]
