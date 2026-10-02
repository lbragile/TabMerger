---
name: learnings-dev-ai-usage-real-sync
description: Settings > Dev "Mocked AI usage" Set/Reset now also writes to real Supabase ai_usage via /api/ai/dev-usage, kept alongside the untouched local chrome.storage mock
metadata:
  type: project
---

`useAiUsage.ts` still reads the local `chrome.storage.local` counter (via `getDevAiUsage`)
whenever `import.meta.env.DEV` is true — this was NOT changed, because `devFetchMock.ts`
increments that same local counter on every mocked `/api/ai/*` call and switching the
read source to real Supabase would silently stop reflecting mocked-AI-call usage in the
displayed quota.

Instead, Settings.tsx's dev-tab Set/Reset buttons now do both writes on click:
1. `setDevAiUsage(count)` — local mock counter (unchanged, still what the UI displays in DEV)
2. `aiPost('/api/ai/dev-usage', { count }, token)` — real Supabase `ai_usage` row for the
   signed-in user, so real server-side quota enforcement (hitting real, non-mocked
   `/api/ai/*` routes) can be tested end-to-end.

`aiPost` (the Bearer-token fetch helper in `useAI.ts`) was exported for reuse here rather
than re-implementing fetch-with-Bearer-token a third time — grep for `aiPost` before adding
a new authenticated fetch helper anywhere in the extension.

If not signed in, the sync step is skipped with a `toast.error('Sign in to sync AI usage to
the server')` and no fetch call — local mock still updates either way.
