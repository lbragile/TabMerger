---
name: learnings-tour-ai-sort-scene
description: Tour scene 10 (Pro AI auto-group) - how the local AI backend is faked (AI_MOCK), the throwaway pro_ai user recipe, what the popup does on Auto-group, and recorder pitfalls
metadata:
  type: project
---

- The web dev server's `AI_MOCK=true` (dev only, `packages/web/lib/ai-mock.ts`) replaces just the model call: auth, plan check (`subscriptions.tier = pro_ai`, entitled status), option check (ai_mode managed), credit reservation (`ai_reserve_credits`, `ai_usage` row created on first call) and the extension's apply step are real. Mock group-tabs = one group per site, max 6, small sites lumped into "Other". It needs no provider key (`ANTHROPIC_API_KEY` is empty locally) and costs nothing.
- Throwaway local user recipe: admin-create user, PATCH its pre-created `subscriptions` row to `tier pro_ai, status active, ai_mode managed, ai_monthly_credits 2500`. The demo build fakes pro_ai client-side (`useEntitlements` DEMO_MODE, `aiFeatures` = managed flag) but the AI request still needs a real signed-in session token, so the recorder signs in first.
- Auto-group in the popup (`Header/AiMenu.tsx`): sparkles button aria-label "AI actions" (testid menu `header-ai-menu`, item `header-ai-auto-group`); it applies the suggestion immediately (no review modal), toast "AI created N groups", Undo is the safety net. Name group / Describe group act on the selected saved group; Organize opens a review modal.
- A second recorder cannot share `.pw-user-data` with another running agent (EPERM on the wipe): set `TM_DEMO_USER_DATA_DIR`.
- `Scene10ClosingCard` embeds the previous scene as its backdrop, so inserting a scene before it means pointing that import at the new scene.
- Dry run on the rebuilt demo build failed in the shared replay (no Q4 Launch group after the scene 3 helpers), i.e. the shared helpers were mid-fix; recordings must wait for them.
