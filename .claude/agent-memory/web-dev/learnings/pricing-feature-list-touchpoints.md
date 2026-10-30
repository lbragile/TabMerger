---
name: pricing-feature-list-touchpoints
description: Every place a PRICING_TIERS feature line (or the Pro AI feature set, or the own-key provider names) is repeated, and which tests pin each copy, so a new or renamed line lands everywhere in one change
metadata:
  type: reference
---

Adding or renaming a plan feature line touches more than `PRICING_TIERS`:

- `packages/shared/src/constants/index.ts`: `PRICING_TIERS[].features` and Pro AI's separate
  `byok.features` (two lists; update both).
- `packages/web/components/pricing/tierFeatures.ts`: the `FeatureLine['key']` union plus
  `TIER_FEATURE_LINES` and `PRO_AI_BYOK_FEATURE_LINES`, in the same order as the shared lists.
  `__tests__/i18n-infrastructure.test.tsx` renders them in English and requires an exact match.
- `packages/web/messages/<locale>/pricing.json` `features.<key>` (18 locales). The backups line
  is `AUTO_BACKUP_COPY.pricingFeature` in `constants/autoBackup.ts`, pinned by `autoBackup.test.ts`
  and `backup-file-copy.test.tsx`; the own-key note `aiOptions.byokHint` is pinned by
  `pricing-ai-options.test.tsx`.
- The extension upgrade prompt (`UpgradePrompt.tsx`, `upgrade.plans.<tier>.f1..f3`) shows only the
  **first three** lines of each plan; `sharedCopyParity.test.ts` checks those against
  `features.slice(0, 3)`. Inserting a line at position 4 or later leaves the 18 extension
  catalogs alone; inserting earlier means extension-dev must update them.
  Rewording an existing early line counts too: Pro's `unlimited` is Pro line 2, so it is
  `upgrade.plans.pro.f2` in all 18 extension catalogs.
- The Pro AI feature set is also written out in prose in places that no parity test links to
  the constants: `featuresPage.json` `proAi.*` (one row per key in `featureSections` in
  `app/[locale]/(marketing)/features/page.tsx`, numbered rows, not a grid, so any count lays out
  fine), `faq.json` `ai.answer` / `answerComingSoon` / `answerOwnKey` (the own-key answer is the
  plain answer plus extra sentences, so rebuild it as `answer + tail`), and
  `packages/extension/CHROMEWEBSTORE.md` "Known Issues". Grep all of them for an old feature
  count ("three AI features") when the set changes.

Pro AI copy stays provider-neutral (own-key users pick Anthropic, OpenAI or Gemini; TabMerger
handles setup on Claude), and the AI requests carry tab titles, URLs and, for naming, suggestions
and Organize, group names; never page content.

**Own-key provider names.** The Google provider is shown as "Gemini" (`AI_PROVIDER_LABELS.google`);
its id stays `'google'` in types, routing and stored keys. The provider list is also written out
by hand in: extension `upgrade.json` `byokOption` (18), web `faq.json` `ai.answerOwnKey` tail (18;
Turkish needs the suffix changed with it, "Gemini'den"), the privacy page's "Your own API key"
paragraph and processor row (legal text keeps the company: "Google (Gemini)", "Google AI (Gemini
API)"), and `CHROMEWEBSTORE.md`. Tests pin the label through `getByRole('radio', { name })` and
`t(..., { provider })`; when grepping for them, don't filter out `name: 'Google'` lines as group
fixtures, because `AiProviderPicker.test.tsx` uses exactly that shape for the radio.

Bulk edits to the 18 message files: `json.dumps(data, ensure_ascii=False, indent=2) + '\n'`
round-trips them byte-for-byte (check that before writing), so a Python script that loads,
inserts keys in order and dumps gives a minimal diff. On a Windows checkout with
`core.autocrlf=true` the working-tree files are CRLF (index LF), so the round-trip check fails
until you normalise `\r\n` to `\n` on read and write the file's own newline style back.
For the FAQ prose, insert the new clause by anchoring on the preceding feature's parenthetical
and assert exactly one hit per variant (`answer`, `answerComingSoon`, `answerOwnKey`): the
count word ("five" to "six") is spelled differently per language ("năm" also means "year" in
Vietnamese, so match "năm tính năng"), and a dry run with these asserts catches a drifted
translation before anything is written.
