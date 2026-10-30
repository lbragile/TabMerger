---
name: learnings-buy-credits-entry
description: Settings → AI "Buy more credits" (lib/buyCredits.ts) — one URL helper for both buy paths, low-balance rule, e2e tabs.create recording, Windows line-ending trap in Python edits
metadata:
  type: reference
---

Where it lives: `lib/buyCredits.ts` (`buyCreditsUrl` = `${VITE_WEB_APP_URL}/account#${ACCOUNT_AI_CREDITS_ANCHOR}`
from `@tabmerger/shared`, `openBuyCredits`, `LOW_CREDIT_BALANCE_RATIO`, `isLowCreditBalance`),
`components/Settings/BuyCreditsLink.tsx`, used by `AiSettings.tsx` and `AIQuotaExceededPrompt.tsx`.
The web account page's credits card carries the shared anchor id; change both through the shared constant.

- **Shown when** `aiFeatures && aiMode === 'managed' && AI_MANAGED_ENABLED`. Emphasis (button look)
  only when `useAiUsage().known` and `remaining / total < 0.1`; a total of 0 counts as low only
  when nothing is left. Division is exact at the 10% boundary for whole totals (checked 10..20000).
- **Accessible name convention for new-tab links:** visible words + the locale's "(new tab)"
  phrase via `aria-label` (as `header.openWebsite`), so the name starts with the visible label.
- **e2e: a tab opened by `chrome.tabs.create` from the popup was not answered by
  `context.route('**/account*')`**; the real local web server served it (and redirected a
  signed-out visitor to sign-in). Assert on the request instead: wrap `chrome.tabs.create` in
  `page.evaluate` to record its arguments (and call through), then compare with the link's href.
  Spec: `e2e/tests/aiBuyCredits.spec.ts` (skips on builds without `VITE_AI_ENABLED`).
- **Python `read_text`/`write_text` on Windows rewrites a LF file as CRLF** (text mode writes
  `os.linesep`). Most `src/` files are LF on disk. Use `read_bytes`/`write_bytes` for scripted edits.
- Other quota "Buy more" toast actions (`useNameGroupAction`, `useDescribeGroupAction`) open
  `/pricing`, not this helper.

Related: [[learnings-ai-byok-model-choice]], [[scratchpad-script-names]].
