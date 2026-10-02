---
name: suggest-sessions-shape
description: suggest-sessions AI route returns { message, staleGroupIds, suggestion } — `suggestion` is a deprecated alias pending an extension banner migration
metadata:
  type: project
---

`/api/ai/suggest-sessions` returns `{ message: string, staleGroupIds: string[], suggestion: string }`.
`suggestion` duplicates `message` and is deprecated — it exists only so the currently-shipped
`AIGroupSuggestion.tsx` banner keeps working. A follow-up task builds an actionable banner
(per-group Archive buttons) off `staleGroupIds`; `suggestion` should be deleted from
`lib/ai.ts`'s route, `packages/shared/src/types/index.ts` (`AISuggestSessionsResponse`),
`useAI.ts`, and `mocks/handlers.ts` once that lands.

**Why:** the old prose-only `{ suggestion }` shape named no groups, so users couldn't act on it.
**How to apply:** when asked to remove the deprecated alias or wire the banner, those four files
plus `packages/web/__tests__/ai-routes.test.ts` (`expected` object) are the full blast radius.
