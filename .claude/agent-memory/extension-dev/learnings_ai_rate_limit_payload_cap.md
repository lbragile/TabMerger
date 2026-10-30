---
name: learnings-ai-rate-limit-payload-cap
description: AI 429 rate_limited vs out-of-credits, waits via Intl.RelativeTimeFormat, trimmed AI payloads (lib/aiPayload.ts) with a contract test against the web parsers, and the useAiUsage cap rule (allowance_spent, revoked packs)
metadata:
  type: reference
---

**Two different 429s.** `/api/ai/*` answers 429 for out of credits (`ai_quota_exceeded`) and for `rate_limited` (rate limit or 4 requests already running, with `retryAfterSeconds` in the body and a `Retry-After` header). `aiPost` only builds a `QuotaExceededError` for `ai_quota_exceeded`; `rate_limited` is an `AiRequestError` carrying `retryAfterSeconds`, so the buy-credits prompt never shows for it.

**A 429 with no code is the platform, not our routes.** Every 429 the AI routes send names its code; a codeless one (plain text, HTML, empty) comes from the hosting platform's firewall / DDoS mitigation in front of them. `aiPost` maps it to `rate_limited` (wait from the `Retry-After` header when parseable, else the "try again in a minute" copy) and never puts the raw body (possibly a whole HTML page) in the message. Test mocks of `fetch` often omit `headers`; `res.headers?.get?.(...)` keeps those working.

**Naming a wait without plural catalogs.** `errors.ai.rateLimitedRetry` is "... Try again {{when}}." with `when` from `Intl.RelativeTimeFormat(activeLocale(), { numeric: 'always' })` (seconds < 60, minutes < 3600, else hours, rounded up), in `formatRetryAfter` in `lib/aiErrors.ts`. Intl handles the plural forms, so no `_one/_few/...` keys are needed in 18 catalogs. Translators place `{{when}}` (Turkish, Japanese, Korean, Persian and Hindi put it first). CLDR Hebrew renders 1 as "בעוד שעה (1)"; that is the CLDR form, not a bug.

**AI payloads carry only what each route reads.** The routes' zod schemas read `title`/`url` per tab (plus `id` for group-tabs), `groupName` (describe), `id`/`name` per group (plus `permanent` for organize), and `model`. Before this, `useAI` sent whole `Tab` objects, `favIconUrl` data: URLs included, which could push a body past the 64 KB / 1 MB / 2 MB caps. `lib/aiPayload.ts` builds the trimmed shapes using the shared `AI_MAX_TITLE_LENGTH`/`AI_MAX_URL_LENGTH`/`AI_MAX_GROUP_NAME_LENGTH`. `cutUrl` drops the `#fragment` first and drops a query parameter that the cut lands inside. The server strips secrets by parameter name and JWT-shaped values (two dots), so half a JWT cut client-side would otherwise slip past it. Group-list tabs (suggest-sessions, organize) without a string URL are sent without `url`, so the tolerant server parser still drops them.

**Contract test that loads the web parsers.** `src/__tests__/unit/hooks/useAI.payload.test.ts` imports `packages/web/lib/ai-validation.ts` at run time and checks that each payload parses to the same result as the untrimmed body. Three gotchas came up:
- `vi.mock` can't stand in for an import that won't resolve: Vite's import-analysis fails first. The fix is a regex alias entry `/^@\/lib\/ai-prompt-safety$/` placed BEFORE `@` in `vitest.config.ts` (the alias is an array now).
- A relative path in a dynamic `import()` isn't resolved against the test file, and `import.meta.url` isn't a `file:` URL under jsdom. Use `path.resolve(__dirname, ...)`.
- A non-literal `import()` path keeps the extension `tsc` from type-checking the web file through its `@/` imports.

**useAiUsage cap = the server's.** cap = max(allowance, `ai_usage.allowance_spent`) + the month's `ai_credit_purchases` rows with `.is('revoked_at', null)`. allowance = `ai_monthly_credits` only when tier is `pro_ai`, status is `active` and `ai_mode` is managed (unset or unknown reads as managed). The web source is `getEffectiveCap` in `packages/web/lib/ai-usage.ts`; the SQL is migration 027. Supabase query mocks in the hook test need `.is` on the builder.
