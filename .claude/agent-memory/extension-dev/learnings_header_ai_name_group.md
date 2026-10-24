---
name: learnings-header-ai-name-group
description: Header AI menu "Name group" on the active group — shared useNameGroupAction hook, Trans + bdi for a truncated user name in a hint, fa ZWNJ in scripted catalog edits, e2e with a seeded own key
metadata:
  type: reference
---

- **One action, two menus.** `hooks/useNameGroupAction.ts` (`useNameGroupAction(group, groupIndex)`
  → `{ run, isPending, block }`) backs the sidebar's "AI rename" and the header AI menu's "Name
  group" (active group = `groupsState.available[activeGroupIndex]`). `block` is `notSaved` (Now
  Open / no group) or `noTabs`; the header disables the item with a hint, the sidebar hides it for
  Now Open and toasts on no tabs. The reply is cleaned (whitespace collapsed, trimmed, capped at
  100, empty = failure toast): it is provider output, so untrusted. Name-group quota errors stay a
  toast with "Buy more" in both menus (the header's other actions show `AIQuotaExceededPrompt`).
- **Mocks follow hook usage** ([[test-mocks-follow-hook-usage]]): rendering `Header` now needs
  `useNameGroup` in every `vi.mock('@/hooks/useAI')` and `useUpdateGroupName` in every
  `vi.mock('@/hooks/useGroups')` (sidePanelAndHeader.test.tsx).
- **User text inside a translated hint:** `"Suggest a name for “<name>{{name}}</name>”"` with
  `<Trans components={{ name: <bdi title={name} className="inline-block max-w-[6.5rem] truncate align-bottom" /> }} />`
  isolates RTL/LTR mixing, cuts only the name with an ellipsis (the closing quote stays), keeps the
  full name in the accessible name and title, and renders markup-looking names as text. The
  catalog validator compares `<tags>` too, so every locale must keep `<name>…</name>`.
- **Scripted catalog edits, Persian:** `fa/*.json` keep ZWNJ (U+200C) as a literal character.
  Re-escaping the U+200B–U+200D range turns every Persian compound word into `‌` in the diff;
  leave U+200C out of the escape set and diff each file for `-` lines before moving on.
- **E2E that reaches the AI route on an own-key account:** after `signInAsPro` + the byok
  subscription route, `chrome.storage.local.set({ aiByokKey: { userId: E2E_USER_ID, key, provider } })`
  from the popup page (key built at run time), then stub `**/api/ai/name-group*` (answer OPTIONS
  with 204 + CORS) and reload. See `e2e/tests/aiByokSettings.spec.ts`.
