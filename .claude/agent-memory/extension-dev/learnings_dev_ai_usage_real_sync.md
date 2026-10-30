---
name: learnings-dev-ai-usage-real-sync
description: Settings > Dev "Credits used this month" (DevAiCredits.tsx) sets the real ai_usage row via /api/ai/dev-usage; no local dev counter exists any more, useAiUsage reads real tables in every build
metadata:
  type: reference
---

Current design (2026-10-24):

- `useAiUsage` has no DEV branch. Dev builds read `ai_usage` / `subscriptions` / `ai_credit_purchases`
  like any build, because the web dev server's `AI_MOCK=true` replies meter real credits. The query
  is enabled only with a signed-in user.
- `src/mocks/devAiUsage.ts` (a `chrome.storage.local` counter) and its test were deleted, and the
  `src/mocks/**` eslint ignore with them.
- Settings > Dev "Credits used this month" lives in `components/Settings/DevAiCredits.tsx`, shown
  for `import.meta.env.DEV && AI_MANAGED_ENABLED` (credits exist only on TabMerger's key). Set/Reset
  POST `{ count }` to `/api/ai/dev-usage`; `count` is credits (the route upserts
  `ai_usage.credits_used`, and `count: 0` also deletes this month's `ai_credit_purchases`). On
  success it invalidates `['aiUsage']` (prefix, so every user id) so the meter re-reads.
  `parseDevCreditsUsed` clamps the typed value to a whole number in 0..1,000,000 (the route's
  `AI_MAX_DEV_USAGE_COUNT`, a web-only constant).
- The toast interpolates `{{credits}}`, not `{{count}}`: `count` makes i18next look for plural
  variants.

`aiPost` (useAI.ts) is the shared Bearer-token fetch helper; grep for it before writing another.
