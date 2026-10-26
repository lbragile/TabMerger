---
name: describe-group-route
description: POST /api/ai/describe-group (Pro AI "Describe group" into a group's note) - contract, parse-time errors in runAiTask, word-boundary cap, and what adding an AiAction touches across packages
metadata:
  type: project
---

`POST /api/ai/describe-group` takes `{ groupName, tabs: {title,url}[], model? }` (shared `AIDescribeGroupRequest`) and answers `{ description }` (`AIDescribeGroupResponse`), at most `AI_MAX_GROUP_DESCRIPTION_LENGTH` (300, in `@tabmerger/shared`). The group content comes client-decrypted in the body; the route never reads `groups`.

- Validation: `parseDescribeGroupBody` in `lib/ai-validation.ts`. `groupName` is required as a string (`''` allowed, unnamed groups exist), cleaned with `cleanUntrustedText` to 100. Tabs are strict like name-group (string title and url, 1..1000). Every schema failure is one message: `groupName string and tabs array required`; over the ceiling is `too many tabs`.
- Task: `describeGroupTask` in `lib/ai.ts`, data `{ group: { name, tabs } }`, `answerTokens` 256, auto model = the cheapest per provider (same as nameGroup). Neither task says anything about the answer language. Decision: describe-group copies nameGroup here.
- Empty answer: the task's `parse` throws `AiRouteError(502, ai_failed)`. `runAiTask` wraps `task.parse` in a try/catch: it sets `remaining` on an `AiRouteError` and maps any other error to 502 `ai_failed`. Settle runs before parse, so the empty answer is still charged and the balance header is still sent. This is the first parser that can throw. Other parsers return an empty value instead.
- Length cap: `fitGroupDescription` cleans to max+1. If the text is longer than max, it cuts at the last space when that space is in the second half, then drops trailing `,;:`. It keeps the cut as is when the cut already falls between words (char at max or max-1 is a space). Without that check, a text of exactly-fitting words lost its last word.
- Mock: `[Mock description] Mostly GitHub tabs about pull and tabmerger, plus 1 other site.`, built from the dominant site, `topTitleWords` and the site count.

Adding an `AiAction` touches more than the web routes:
- `AUTO_AI_MODELS` for all three providers and the `estimatedOutputTokens` switch, which is exhaustive, so tsc catches a missing case.
- The extension's `AiModelPicker` builds an i18n key `settings.ai.estimate.action.<action>`. Extension tsc fails until that key exists, even when the action isn't added to `AI_ESTIMATE_EXAMPLES`.

Test gotchas: a `​` or `‹` written through Edit/Write or a Bash heredoc lands as the raw character. Use `String.fromCharCode` in tests. In Git Bash, a quoted heredoc still mangled `\\n` and `\'` inside a `python - <<'EOF'` script. Write the edit script to the scratchpad with the Write tool and run it with python.

Related: [[ai-request-validation]], [[ai-metering-flow]], [[ai-dev-mock]], [[prompt-caching]]
