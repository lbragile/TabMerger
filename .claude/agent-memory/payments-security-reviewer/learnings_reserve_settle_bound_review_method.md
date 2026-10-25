---
name: reserve-settle-bound-review-method
description: How to check that a managed AI reservation (count_tokens + max_tokens) really bounds the settled cost once usage is split into base/cache-write/cache-read, tiers and multipliers
metadata:
  type: reference
---

Questions to ask whenever the reserve or settle pricing of managed AI changes:

1. **Same total, different split.** If settle only splits the reserved token total (base, writes, reads),
   the reservation must price every input token at the dearest rate the request can incur. Check which
   multipliers the request can actually trigger (cache TTLs actually sent, data-residency
   `inference_geo`, `service_tier`, fast mode); usage fields such as `usage.inference_geo` show them.
2. **Different total.** `count_tokens` is documented as an estimate, so settle can see more input than
   was reserved. A per-token buffer (for example the cache-write multiplier) absorbs small drift, but a
   **tier switch** (a long-context threshold chosen from total input) is a step change of several times.
   Check: can a client reach the threshold within the request size limits in `lib/ai-validation.ts`?
   Is the reservation priced at the higher tier near the threshold?
3. **What a positive settle delta does.** `ai_settle_credits` (022) adds any delta and clamps only at 0
   and int max, with no cap check. Any settle > reservation spends past the cap, once per concurrent call.
4. **Non-finite numbers.** `Math.max(0, NaN)` is NaN, so NaN usage passes through credit maths.
   supabase-js JSON-serialises NaN/Infinity as `null`, and the SQL functions raise on a null amount or
   delta. The route then keeps the reservation, which is safe, but only because of serialisation plus the
   SQL check, which mocked-RPC unit tests never exercise. Prefer an explicit `Number.isFinite` guard in TS.
5. **Inconsistent split totals** (`cache_creation` 5m + 1h vs `cache_creation_input_tokens`): decide
   which field is authoritative. Taking the max protects cost and can over-charge, so say which way it errs.
6. **Bound tests.** A sweep over splits with total == counted proves (1) only. Ask for cases for drift
   across a tier threshold, for each multiplier the code prices but the request shouldn't trigger, and
   for NaN through `usageCredits` → settle.

Related: [[refund-after-paid-call-review-method]], [[mocked-gate-return-values]]
