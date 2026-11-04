---
name: ai-abuse-limit-review-method
description: How to audit rate limits, concurrency slots, body caps and model-call deadlines on metered AI routes - refund direction on abort, sibling-route oracles, unbounded pre-slot work, IP key handling
metadata:
  type: reference
---

Questions that find real issues when reviewing abuse limits on the `/api/ai/*` routes (shared runner
`handleAiRoute`, limits in `lib/ai-request-limits.ts`, deadlines in `lib/ai.ts`):

1. **Which way does a deadline abort settle?** Adding client-side timeouts changes who pays for a
   slow call. Without them, the platform kills the function and the reservation stays (over-charge,
   safe). With them, a catch-all "no usage came back, release everything" refunds a call the
   provider may still bill (request sent, connection then dropped or aborted). Separate three
   cases: deadline passed before sending (release), provider answered with an HTTP error status
   (release), and no status: abort, timeout or connection drop after sending (keep the reservation,
   or charge the input part). Check the tests don't lock in the refund.
2. **Is a tight per-purpose bucket undone by a sibling route?** A strict limit on a key-check route
   means little if every model route also accepts a key header and returns a distinguishable
   key-invalid or billing code under a much looser bucket. Look for the same oracle on every route
   that takes the input, and suggest a failure-counting bucket shared by all of them.
3. **What runs between auth and the concurrency slot, and is it time-bounded?** Body reads,
   database loads and pre-checks that sit before the slot aren't covered by the per-user
   concurrency cap. A streamed body read with a byte cap but no time limit can keep many functions
   open, limited only by the per-minute rate.
4. **Never-stricter pre-checks:** a cheap "certainly exhausted" read in front of the authoritative
   reservation is safe when its allowance set is a superset of the reservation's and any credit-pack
   row makes it defer. When the reservation's status list narrows, the pre-check can narrow in the
   same migration and stay safe. There's a pgTAP file per migration under `supabase/tests/`; check
   that it compares the pre-check against the real reservation function.
5. **IP keys:** check that headers are trusted only where the platform overwrites them (`VERCEL=1`),
   and that IPv6 is grouped (/64). Then ask what gets stored: a raw IP as a counter key is personal
   data and should be on the privacy page, or be hashed with a server secret.
6. **Peek-then-count buckets** (checked without counting before a call, counted after it fails):
   the overshoot is the number of calls that can already be past the peek when the bucket fills.
   Peeking after the concurrency slot is taken bounds that to slots minus 1. Peeking before the
   slot also lets in requests sitting between the peek and the acquire. Check that the failure
   is recorded before the slot is released (catch before finally). Note that a counting take
   that refuses when full doesn't count the overshoot in longer windows either.
7. **SDK retries vs "the provider answered":** a status check on the final error only describes
   the last attempt. With `maxRetries > 0`, an earlier attempt that was dropped after it was sent
   can be followed by a retry that gets a status (full release) or succeeds (settles only the
   retry). On metered calls, ask for `maxRetries: 0` or have the comment admit the gap.
8. **Display caps vs the database rule:** the TypeScript `getEffectiveCap` and the SQL
   `ai_reserve_credits` must change together; if one is ahead, say which way the display is off.

Related: [[reserve-settle-bound]], [[refund-after-paid-call]], [[analytics-privacy-crosscheck]].
