---
name: name-group-suggestions
description: POST /api/ai/name-group answers { names, name } (1-3 distinct suggestions + legacy alias); why the schema has no item count, how cleanGroupNames dedupes, mock names, estimate
metadata:
  type: project
---

`POST /api/ai/name-group` answers `{ names: string[], name: string }` (shared `AINameGroupResponse`). `names` holds 1 to `AI_NAME_GROUP_SUGGESTIONS` (3, in `@tabmerger/shared`) distinct names, best first; `name` is always `names[0]`, kept for extension builds that read only `name`. The route builds the body; the task (`nameGroupTask` in `lib/ai.ts`) returns `string[]`.

- **Schema has no item count.** Claude structured outputs accept `minItems` of 0 or 1 only and reject `maxItems` (400), and one schema serves all three providers. The "exactly 3" lives in the system prompt and the array's `description`; the parser enforces at most 3.
- **`cleanGroupNames`** (exported): per entry `unquote` + `cleanModelText` + cap at `AI_MAX_RENAME_LENGTH`, like the old single name. Non-strings and empties are dropped. The dedupe key is lowercased with runs of whitespace collapsed, because `cleanModelText` keeps internal double spaces ("Dev  Tools" would otherwise survive as a second name). Only kept names count toward the 3, so a duplicate doesn't crowd out a later name.
- **None left** -> parser throws `AiRouteError(502, ai_failed)`, charged like describe-group's empty answer (see [[describe-group-route]]).
- **Prompt** asks for 3 names differing in angle (topic, purpose, site) and stays a constant string, so the system-block cache breakpoint still applies ([[prompt-caching]]). `answerTokens` 100 -> 150.
- **Estimate:** `estimatedOutputTokens('nameGroup')` 15 -> 40 (3 names of ~8 tokens + JSON). Haiku at 10 tabs still rounds to 1 credit.
- **Mock** (`mockNameGroup`): site + top word ("GitHub Pull"), the two top title words without the site ("Pull Tabmerger"), "<Site> Research" (or "<Top Word> Research" with no half-majority site), then fillers "Reading List" / "Saved Tabs" / "Mixed Tabs" so there are always 3 distinct names. See [[ai-dev-mock]].
- The extension has its own client-side cleaner for the answer (`lib/aiGroupName.ts`) that also reads `AI_NAME_GROUP_SUGGESTIONS`.

Related: [[model-request-settings]], [[ai-metering-flow]]
