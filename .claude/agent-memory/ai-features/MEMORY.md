# AI Features Agent Memory

- [organize E2EE writeback](learnings_organize_e2ee_writeback.md) — client sends plaintext groups in POST; server skips content-bearing writes instead of re-encrypting
- [AI kill switch](learnings_ai_kill_switch.md) — NEXT_PUBLIC_AI_ENABLED guard in lib/ai-guard.ts runs before auth on all /api/ai/*; tests must stub it on
- [suggest-sessions response shape](learnings_suggest_sessions_shape.md) — `{ message, staleGroupIds, suggestion }`; `suggestion` is a deprecated alias to delete after the banner migration
