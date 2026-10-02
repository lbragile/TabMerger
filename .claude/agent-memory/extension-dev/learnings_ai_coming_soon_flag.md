---
name: learnings-ai-coming-soon-flag
description: AI_ENABLED kill switch was already fully wired by a prior attempt across nearly every file the spec listed; only one real gap found
metadata:
  type: project
---

The "AI features: coming soon" global kill switch (`packages/extension/src/lib/aiFlag.ts` exporting `AI_ENABLED = isAiEnabled(import.meta.env.VITE_AI_ENABLED)` from `@tabmerger/shared`) was already correctly threaded through nearly every listed surface by an earlier session's work, despite the task framing implying a prior attempt "left nothing on disk":
- `useEntitlements.ts` ANDs `TIER_LIMITS[tier].aiFeatures && AI_ENABLED` (and the DEMO_MODE branch too) — so every downstream component gating on `aiFeatures` from `useEntitlements()` is automatically correct without needing its own `AI_ENABLED` check (GroupContextMenu's "AI rename" item, TabPreview's summary UI, Settings' AI tab/usage row all rely on this transitively).
- `useAI.ts` mutations throw `'AI features are coming soon'` before any fetch when `!AI_ENABLED`; `useAiUsage.ts` guards the query with `enabled: AI_ENABLED && ...`.
- `UpgradePrompt.tsx` implements the FINAL pricing decision correctly: real price shown, only the Pro AI CTA swaps to `AI_COMING_SOON_LABEL` + `aria-disabled`.
- `main.tsx` skips installing the dev fetch mock entirely when `!AI_ENABLED` (since every AI mutation throws before fetching anyway).

The one real gap: `Settings.tsx`'s Dev-tab "Mocked AI usage count" control was gated only on `import.meta.env.DEV`, not on `AI_ENABLED` — it calls `aiPost` for a real network round-trip to `/api/ai/dev-usage` regardless of the flag. Fixed by adding `&& AI_ENABLED` to that block's condition.

Lesson: when asked to "roll out" a flag across a long file list, grep first for the flag's existing import (`AI_ENABLED` / `aiFlag`) across `src/` before assuming zero work has been done — a transitively-correct gate (via `aiFeatures` from `useEntitlements`) can make most of the listed files already compliant without touching them, and the real remaining work is often just one or two direct-fetch call sites that bypass the entitlement layer (dev-only debug tools are the recurring offender).
