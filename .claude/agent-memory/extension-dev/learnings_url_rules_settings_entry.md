---
name: learnings-url-rules-settings-entry
description: URL Rules feature was fully built (engine, hooks, modal, background wiring) but had no Settings entry point; found the pipeline was already end-to-end tested across two files
metadata:
  type: project
---

Found and fixed: `UrlRulesModal` (Modal/UrlRules.tsx), `useUrlRules` hooks, `urlRuleEngine.ts`
(`applyUrlRule`/`getAllUrlRules`), and background.ts's `onCreated`/`onUpdated` listeners were all
fully implemented and wired together — the only missing piece was a way to reach the modal from
the UI. `Modal/index.tsx` already had `case 'urlRules':` ready; `uiStore.openModal` already
supported it. Added a "URL rules" row + "Manage" button to Settings.tsx's General tab (global
setting, not per-group — matches the feature's flat-rule-list design), calling
`openModal('urlRules')`.

**Coverage check before adding new tests — don't assume a gap exists.** The
background→matching→save pipeline looked suspicious for gaps because `background.test.ts` mocks
the entire `@/lib/urlRuleEngine` module (so it only proves the listener calls `matchUrlToRule` +
`applyUrlRule` with the right args). But `urlRules.test.ts` separately unit-tests `applyUrlRule`
itself against a mocked `localDb`, asserting the tab actually lands in `workGroup.windows[].tabs`
for the matched group id. Together these two files *do* prove the full pipeline — the split is
just the normal mocking boundary between "chrome listener wiring" and "IndexedDB persistence
logic," not a real coverage hole. Read both test files fully before concluding end-to-end coverage
is missing; the two halves may already stitch together.

Settings.tsx test file uses a `renderModal()` helper that does NOT return `{ user }` from
userEvent — call `userEvent.setup()` directly in the test body instead of destructuring off the
render helper (a pattern that exists in some other test files in this repo but not this one).
