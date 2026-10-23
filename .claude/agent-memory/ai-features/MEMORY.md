# AI Features Agent Memory

- [organize E2EE writeback](learnings_organize_e2ee_writeback.md) — client sends plaintext groups in POST; server skips content-bearing writes instead of re-encrypting
- [AI kill switch](learnings_ai_kill_switch.md) — NEXT_PUBLIC_AI_ENABLED guard in lib/ai-guard.ts runs before auth on all /api/ai/*; tests must stub it on
- [suggest-sessions response shape](learnings_suggest_sessions_shape.md) — `{ message, staleGroupIds, suggestion }`; `suggestion` is a deprecated alias to delete after the banner migration
- [AI request validation](learnings_ai_request_validation.md) — bodies parsed by lib/ai-validation.ts after auth, before plan/key/model checks; prompt-safety cleaning; limits
- [groups.position is not Now Open](learnings_groups_position_now_open.md) — Now Open is never a groups row; legacy rows default to position 0; reorder slots start at 1
- [AI metering flow](learnings_ai_metering_flow.md) — count_tokens -> reserve -> call -> settle; month fixed per request; BYOK unmetered; test gotchas (Haiku rounds to 1, SDK in jsdom)
- [5.5 model request settings](learnings_model_request_settings.md) — thinking/effort per model, no temperature, structured-output schema rules, SDK 0.112.3 between_tools cast
