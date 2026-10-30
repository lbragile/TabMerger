---
name: ai-abuse-limits
description: Shared /api/ai/* runner (handleAiRoute) order of checks, rate-limit buckets, concurrency slots (migration 028), the credit pre-check rule, body caps, maxDuration + deadlines, and the test stubs every AI route test now needs
metadata:
  type: project
---

Every model route under `packages/web/app/api/ai/` calls `handleAiRoute` (`lib/ai-route.ts`); `byok/verify` runs the same steps by hand with its own bucket. Limits live in `lib/ai-request-limits.ts`.

Order: kill switch -> per-IP limit (`ai-ip`, before auth) -> auth -> per-user limit (`ai-user`) -> plan + option gate (`requireAiOption`) -> body read with a byte cap (413) -> parse (400) -> `aiCallContext` (key, model, meter, deadline) -> managed only: `ai_credits_exhausted` pre-check (429 `ai_quota_exceeded`, `remaining: 0`) -> `ai_slot_acquire` -> own key only, inside the slot's `try`: key-failure gate (`rate_limit_peek` on `ai-byok-key-failure`; its refusal returns through `finally`, which releases the slot) -> route work / `runAiTask` (an own-key `byok_key_invalid`/`byok_billing` takes one hit in `ai-byok-key-failure`) -> `ai_slot_release` in `finally`.
Decision: the plan check now runs before the body is read, so a free account's body is never buffered or parsed.
Decision: the key-failure peek runs after the slot is held, not before. Peeking first let anything between peek and acquire pass a full bucket; with the slot held, at most the user's other slot-holders (3) can be past the peek before a failure is counted (inherent to peek-then-count).

Buckets (all `onError: 'deny'` -> 503 `ai_overloaded`): `ai-ip` 120/min, 1500/h; `ai-user` 30/min, 300/h, 1500/day; `ai-byok-verify` 5/min, 20/h, 50/day; `ai-byok-key-failure` 5/h, 10/day, shared by verify and every own-key model request, peeked before the provider call and counted only on a rejected or unfunded key (so an account can't sort stolen keys at the general rate). Concurrency: 4 per user, lease = maxDuration + 30 s. Over a limit or out of slots -> 429 `rate_limited` with `Retry-After` (code from `lib/rateLimit.ts`, not in `AI_ERROR_CODES`).

Client IP: stored as `ip:` + HMAC-SHA256(normalised key) keyed with `SUPABASE_SERVICE_ROLE_KEY` (no raw IPs in `rate_limit_counters`; rotating the secret only resets counters; no secret -> no IP limit). Only trusted when `VERCEL=1` (`x-vercel-forwarded-for`, then `x-real-ip`, then first `x-forwarded-for` hop); elsewhere the per-IP limit is skipped. IPv6 keys by /64, IPv4-mapped IPv6 keys as IPv4.

Credit pre-check rule: it must never be stricter than `ai_reserve_credits` (the authority). `ai_credits_exhausted` (028) says true only with NO `ai_credit_purchases` row for the month (revoked ones included) and `credits_used >= ` the 022-style allowance. Proven against 027's reserve in `supabase/tests/028_ai_request_slots.test.sql` (past_due with `allowance_spent`, revoked pack, `allowance_spent > allowance`, BYOK, free). A failed pre-check lets the request go on. When the reservation's cap rule changes (bucket key, new grants), re-run that pgTAP and keep the implication.

Timeouts: routes export literal `maxDuration` (300 for group-tabs/suggest-sessions/organize, 120 for name/describe/summary, 45 for verify; Hobby with fluid compute allows 300). The model-call deadline is `start + maxDuration - 20 s` (`aiDeadline`), passed as `ctx.deadline`; `deadlineOptions` gives the SDK `timeout` + an abort `signal` covering retries, and own-key fetches get `prompt.timeoutMs`. Abort/timeout errors map to 503 `ai_overloaded`. Charging rule: a call never sent, or answered with an HTTP status (`providerAnswered`), releases the reservation; a call cut off after it was sent (abort, timeout, dropped connection, any status-less error) keeps it, because Anthropic's docs don't say an abandoned request is unbilled. Otherwise the deadline would be a free-Opus path. Clients default to 60 s / 1 retry, but the metered managed `messages.create` passes `maxRetries: 0`: an SDK retry after a dropped (possibly billed) first attempt would let the retry's HTTP status release the reservation, or its success settle only the retry's usage. `countTokens` (free) and own-key calls (not metered) keep the retry.

Body caps (`AI_MAX_BODY_BYTES_*` in `lib/ai-validation.ts`): 64 KB one tab, 1 MB tab list, 2 MB groups, 4 KB small. `readJsonBodyWithin` rejects on `content-length` and also while streaming, so a missing or understated header can't bypass it, and gives up after `AI_BODY_READ_TIMEOUT_MS` (10 s, reader cancelled). 413 / 408 use `ai_invalid_request`.

`getEffectiveCap` (display) mirrors the reservation's cap: greatest(allowance if status is `active` else 0, `ai_usage.allowance_spent`) + packs with `revoked_at is null`. Trialing and past_due get no allowance, only what it already paid for and their packs. `getEffectiveCap` throws on a failed subscription/usage/pack read (`.single()` PGRST116 = no row is fine; `getAiSubscription` itself still answers null on a failed read so the routes fail closed with 403) so the page shows its error state, never 0. `ai_credits_exhausted` counts the allowance for `active` only, like 027; safe because allowance_spent <= credits_used is 027's CHECK (028's end-state check requires it). The 028 pgTAP grid (2160 combinations, each reservation rolled back in a subtransaction) fails if the two drift.

Test gotchas:
- Any route test whose Supabase stub has `rpc` must answer the limit RPCs: use `aiLimitRpc(fn)` from `__tests__/helpers/aiLimits.ts` first, and `meterRpcCalls(mockRpc)` instead of `expect(mockRpc).not.toHaveBeenCalled()` for "unmetered". A stub without the limit answers turns every request into a 503 (fail closed), which looks like 51 unrelated failures in one file.
- Page tests that render the dashboard/account usage card need `is` on their query-builder stubs (`getEffectiveCap` calls `.is('revoked_at', null)`).
- pgTAP grid pattern: `begin ... raise exception using errcode = 'Z9028'; exception when sqlstate 'Z9028' then null; end` rolls each combination back while plpgsql variables keep the answers.
- Re-applying an edited, not-yet-remote migration locally: run its rollback, then `docker exec -i <db> psql -U postgres -v ON_ERROR_STOP=1 -1 < file` (`-1` so `set local` applies); never `db reset`.
- `vi.spyOn(Date, 'now')` drives the deadline in tests; making `countTokens` advance it past the deadline proves create is never sent and the reservation is released.

Related: [[ai-metering-flow]], [[ai-request-validation]], [[ai-kill-switch]]
