---
name: refund-after-paid-call-review-method
description: How to audit a "give the credits back" path after a metered AI call (organize refund), plus Workflow DevKit endpoint exposure facts (Vercel vs local world, webhook route vs createHook)
metadata:
  type: reference
---

Questions to ask of any refund that runs after a successful metered model call:

1. **Is the number of refunds bounded?** The monthly credit cap is the only throttle on managed
   AI spend (no per-user request rate limit on `/api/ai/*`). A refund puts that call's provider
   cost outside the cap. Any refund that keeps firing during an outage, a quota pause, or a
   deterministic misconfiguration makes spend unbounded for a scripted entitled account. Look for a
   per-user budget, a breaker, or failing before the paid call (do the fallible server work, such as
   `start()`, first).
2. **What exactly is "charged"?** After `settle` the row holds +actual; after a failed settle it
   holds +reserved. An ambiguous failure (committed, then the response was lost) looks like a failed
   settle, so refunding `reserved` gives back more than was charged. `min(actual, reserved)` keeps
   the module's "over-charge, never under-charge" direction.
3. **Idempotency.** The once-flag must be set synchronously before the first `await`; the closure is
   per request, so a replayed request is a new paid call, not a second refund.
4. **No answer delivered on a refund path.** Check every path that refunds also withholds the result
   (organize: no runId/token returned, run cancelled when unrecorded, GET needs the
   `organize_runs` row).
5. **Same RPC as settlement.** Refund via `ai_settle_credits` with a negative delta: service-role
   only (EXECUTE revoked from public/anon/authenticated in 022), clamped at 0, month fixed per request.

Workflow DevKit endpoint facts (workflow 4.6, read from node_modules):
- On Vercel, `/.well-known/workflow/v1/flow` and `/step` are queue consumers (`experimentalTriggers`)
  and not publicly invokable (bundled docs, `docs/how-it-works/framework-integrations.mdx` "Security").
- Local world (`@workflow/world-local`, any non-Vercel host incl. `next start` in CI) has **no auth**:
  it trusts `x-vqs-queue-name` / `x-vqs-message-id` / `x-vqs-message-attempt` headers. Step inputs
  come from the stored event log (`step.input`), not the message, so a forged message needs a real
  runId + stepId; `attempt > 48` makes the handler mark that step failed.
- `/.well-known/workflow/v1/webhook/[token]` is public everywhere but `resumeWebhook` refuses hooks
  made with `createHook()` (`isWebhook === false`), so an approval hook can't be resumed there.
- `?__health` on flow/step answers without auth (version info, CORS `*`).
- Proxy matcher tests that compile `config.matcher[0]` as a plain regex are fine for a single
  regex-group source; path traversal is collapsed by URL parsing before matching.

Related: [[webhook-retry-review-method]], [[worker-paid-action-review-method]]
