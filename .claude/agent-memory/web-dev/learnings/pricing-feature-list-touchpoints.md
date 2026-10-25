---
name: pricing-feature-list-touchpoints
description: Every place a PRICING_TIERS feature line (or the Pro AI feature set) is repeated, and which tests pin each copy, so a new or renamed line lands everywhere in one change
metadata:
  type: reference
---

Adding or renaming a plan feature line touches more than `PRICING_TIERS`:

- `packages/shared/src/constants/index.ts`: `PRICING_TIERS[].features` and Pro AI's separate
  `byok.features` (two lists; update both).
- `packages/web/components/pricing/tierFeatures.ts`: the `FeatureLine['key']` union plus
  `TIER_FEATURE_LINES` and `PRO_AI_BYOK_FEATURE_LINES`, in the same order as the shared lists.
  `__tests__/i18n-infrastructure.test.tsx` renders them in English and requires an exact match.
- `packages/web/messages/<locale>/pricing.json` `features.<key>` (18 locales).
- The extension upgrade prompt (`UpgradePrompt.tsx`, `upgrade.plans.<tier>.f1..f3`) shows only the
  **first three** lines of each plan; `sharedCopyParity.test.ts` checks those against
  `features.slice(0, 3)`. Inserting a line at position 4 or later leaves the 18 extension
  catalogs alone; inserting earlier means extension-dev must update them.
- The Pro AI feature set is also written out in prose in places that no parity test links to
  the constants: `featuresPage.json` `proAi.*` (one row per key in `featureSections` in
  `app/[locale]/(marketing)/features/page.tsx`, numbered rows, not a grid, so any count lays out
  fine), `faq.json` `ai.answer` / `answerComingSoon` / `answerOwnKey` (the own-key answer is the
  plain answer plus extra sentences, so rebuild it as `answer + tail`), and
  `packages/extension/CHROMEWEBSTORE.md` "Known Issues". Grep all of them for an old feature
  count ("three AI features") when the set changes.

Pro AI copy stays provider-neutral (own-key users pick OpenAI, Anthropic or Google; TabMerger
handles setup on Claude), and the AI requests carry tab titles, URLs and, for naming, suggestions
and Organize, group names; never page content.

Bulk edits to the 18 message files: `json.dumps(data, ensure_ascii=False, indent=2) + '\n'`
round-trips them byte-for-byte (check that before writing), so a Python script that loads,
inserts keys in order and dumps gives a minimal diff.
