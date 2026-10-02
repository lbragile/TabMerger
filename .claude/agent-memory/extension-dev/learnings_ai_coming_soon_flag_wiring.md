---
name: ai-coming-soon-flag
description: How the extension's global VITE_AI_ENABLED "AI features coming soon" kill switch is wired and why aiFeatures alone isn't enough
metadata:
  type: project
---

The extension has a global AI kill switch, independent of per-user tier entitlement: `AI_ENABLED` in `packages/extension/src/lib/aiFlag.ts`, computed once as `isAiEnabled(import.meta.env.VITE_AI_ENABLED)` (from `@tabmerger/shared`, exact-string-"true" check). Default is OFF (unset/anything else = off).

**Why:** Decision: ship the UI groundwork for AI features before the AI backend is ready for GA, without exposing them even to real `pro_ai` subscribers. `useEntitlements()`'s `aiFeatures` field is now `TIER_LIMITS[tier].aiFeatures && AI_ENABLED` (both the DEMO_MODE branch and the normal branch) — this is the single choke point most AI UI already gates on (`AIGroupSuggestion`, `GroupContextMenu`'s AI rename item, `TabPreview`'s AI summary block, Settings' AI tab/AI-credits row all already checked `aiFeatures` before this flag existed, so gating entitlements was sufficient for them). Header's Sparkles AI-actions button and the "Upgrade to Pro AI" menu item needed an *explicit* `AI_ENABLED` check too, because the decision is to hide those fully (not just disable them) rather than routed through the aiFeatures-false disabled state that used to link to an upgrade modal.

`useAI.ts`'s mutations (`useAutoGroup`/`useNameGroup`/`useSuggestSessions`/`useOrganizeTabs`/`useTabSummary`) each guard `if (!AI_ENABLED) throw/return` as the *first* line of `mutationFn`, before the `aiFeatures`/session/settings checks — useMutation has no `enabled` option, so the only way to guarantee zero network calls is an early throw inside the function body. `useAiUsage.ts`'s query additionally ANDs `AI_ENABLED` into its `enabled` predicate for the same "zero network calls" guarantee, even though it's already redundant with `aiFeatures`.

**How to apply:** when adding new AI-gated UI or hooks, check `aiFeatures` from `useEntitlements()` first — it already encodes the global flag. Only reach for `AI_ENABLED` directly when you need full hide-vs-disabled-with-upgrade-CTA distinction (Header-style) or a mutationFn-level network guard. See [[feedback-test-mocking-aiflag]] for the test-suite implication of importing `AI_ENABLED` into a component/hook.

`UpgradePromptModal` (`components/Modal/UpgradePrompt.tsx`) is the one deliberate exception to "hide when off": the Pro AI tier row in its plan list always renders, showing the real price followed by `(AI_COMING_SOON_LABEL)` ("Coming soon") when `!AI_ENABLED`, and the primary CTA is disabled (`disabled` + `aria-disabled`) *only* when the modal's `reason` prop is specifically `'aiFeatures'` — a `maxGroups`/`maxTabs`/`cloudSync` reason must still let the user upgrade normally even while AI is coming-soon.
