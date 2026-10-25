# AI Features Agent Memory

- [organize E2EE design](learnings_organize_e2ee_writeback.md) — sync route answers { actions }; client applies; server never writes; no refunds
- [AI kill switch](learnings_ai_kill_switch.md) — lib/ai-guard.ts: any-option guard first, per-option gate after the plan lookup; tests must stub the flags
- [suggest-sessions response shape](learnings_suggest_sessions_shape.md) — `{ message, staleGroupIds, suggestion }`; `suggestion` is a deprecated alias to delete after the banner migration
- [AI request validation](learnings_ai_request_validation.md) — bodies parsed by lib/ai-validation.ts after auth, before plan/key/model checks; prompt-safety cleaning; limits
- [groups.position is not Now Open](learnings_groups_position_now_open.md) — Now Open is never a groups row; legacy rows default to position 0; reorder slots start at 1
- [AI metering flow](learnings_ai_metering_flow.md) — count_tokens -> reserve -> call -> settle; month fixed per request; BYOK unmetered; test gotchas (Haiku rounds to 1, SDK in jsdom)
- [5.5 model request settings](learnings_model_request_settings.md) — thinking/effort per model, no temperature, structured-output schema rules, SDK 0.112.3 between_tools cast
- [Own-key providers](learnings_own_key_providers.md) — BYOK to Anthropic/OpenAI/Google by key shape; fetch adapters, error mapping, per-option flags, key hygiene
- [Prompt caching](learnings_prompt_caching.md) — Claude system-block breakpoint, OpenAI caching off (1.25x write on data turn), Gemini implicit; cache pricing in metering
- [Dev AI mock](learnings_ai_dev_mock.md) — AI_MOCK=true seams (count+create, own-key fetch, verify), gate, over_quota via inflated count, test gotchas
