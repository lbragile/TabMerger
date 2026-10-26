---
name: ai-route-db-touchpoints
description: Map of which tables the shared /api/ai/* request path touches, so AI-route audits can skip re-tracing lib/ai-route.ts, lib/ai.ts and lib/ai-usage.ts
metadata:
  type: reference
---

The shared AI request path (`authenticateAiRequest` -> `parse*Body` -> `resolveAiContext` -> `runAiTask`) touches only non-content data:

- `subscriptions` (`tier, status, ai_mode, ai_monthly_credits`) via `getAiSubscription` in `lib/ai-usage.ts`
- `ai_credit_purchases` (`credits`) in `lib/ai-usage.ts`
- RPCs `ai_reserve_credits` / `ai_settle_credits` (managed mode only)

The one AI helper that reads a content column is `loadStoredOrganizeGroups` in `lib/ai-organize.ts` (`groups.id, name, windows`), used only by `organize` when no groups are sent; it throws `OrganizeNeedsClientDataError` on any non-array `windows`. So for a new AI route, grep the route file for `ai-organize` imports and `.from(` before tracing further: if neither appears, its DB access is limited to the list above.

Logging on this path goes through `describeErrorForLog` (class, status, error type, request id only) and fixed-string `console.*` calls with `{ model }`; none of them include request data.

Test pattern: the AI route tests assert `mockFrom` was not called with `'groups'` / `'sessions'` (a denylist). An allowlist (every `mockFrom` call is `subscriptions` or `ai_credit_purchases`) also covers `device_sessions` and `shared_bundles`.
