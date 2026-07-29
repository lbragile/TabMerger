---
name: api-doc
description: Generate or update reference documentation for a TabMerger API route under packages/web/app/api/.
---

# API doc

Documents one or more Next.js route handlers in `packages/web/app/api/`.

## Known routes

```
ai/group-tabs/route.ts
ai/name-group/route.ts
ai/organize/route.ts
ai/organize/approve/route.ts
ai/suggest-sessions/route.ts
ai/tab-summary/route.ts
auth/callback/route.ts
auth/sign-out/route.ts
billing-portal/route.ts
checkout/route.ts
groups/[id]/publish/route.ts
portal/route.ts
sessions/[id]/route.ts
webhooks/stripe/route.ts
```

## Steps

1. Read the target route file(s). Note: for each exported handler (`GET`/`POST`/etc.) capture method, path (including dynamic segments), auth requirement (Bearer JWT / cookie session / none — webhook routes use Stripe signature instead), request body shape, response shape, and error responses.
2. Cross-reference `packages/shared/src/types/index.ts` for the request/response types already defined there — reuse those names instead of re-describing the shape inline.
3. Write output as a Markdown table or per-route block: `Method Path`, `Auth`, `Request`, `Response`, `Errors`, one-line purpose.
4. Flag anything security-relevant while reading (missing auth check, service-role client used outside webhook/AI routes, `req.json()` used where raw body is required) — don't fix it, just note it and point to the right agent (`web-dev`, `ai-features`, or `payments-security-reviewer`).
5. Ask the user where output should go before writing a new file (e.g. `docs/api-reference.md`) — don't assume a location; this repo's `docs/` already holds architecture/integration docs, so check there first for an existing file to update instead of creating a duplicate.
