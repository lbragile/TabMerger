---
name: fallback-acceptance-set
description: How to audit a route that takes client-decrypted content but falls back to a stored-rows read when the payload is missing or invalid
metadata:
  type: reference
---

A route can look clean (it only touches non-content tables itself) while the content read lives in a helper it calls: for `/api/ai/organize` the `.select(... windows)` is in `packages/web/lib/workflows/tabOrganizer.ts` (`fetchUserData`, `applyChanges`), not in the route file. Grepping `app/api/` for `.from(` is not enough; follow what the route passes on.

When such a route treats an invalid client payload as "no payload" and falls back to the stored-rows read, the payload validator decides which requests reach ciphertext. So for any change to that validator:

- Write out the set of bodies accepted before and after. Every body that moved from "accepted" to "treated as absent" is a new way onto the stored-rows path.
- Check nested fields, not only the top-level shape. A per-item rule (for example each tab needing a string `title` and `url`) rejects the whole payload if one item fails.
- Check where the client's data can be unnormalised (imports that cast parsed JSON without validating each tab are the usual source).
- Tests named "falls back to the DB path for ..." document the fallback; compare the list with the same test at HEAD to see which cases are new.

Rejecting with a 400 is the safe outcome for a payload that was present but invalid; falling back is only correct when no payload was sent at all.
