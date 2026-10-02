---
name: encryption-ciphertext-at-rest-test
description: Added the missing integration test proving Supabase stores ciphertext (not just that decrypt(encrypt(x))==x); local Supabase stack must be running to actually execute it
metadata:
  type: project
---

Added `packages/extension/src/__tests__/integration/encryption.integration.test.ts` — proves the
real security property (raw Supabase row for `groups.windows` is the `{v:1,iv,ct}` shape and
`JSON.stringify(row)` never contains plaintext marker content), distinct from the unit-level
round-trip coverage already in `packages/shared/src/__tests__/crypto.test.ts`. Follows the exact
pattern of `syncEngine.integration.test.ts`: `describe.skipIf(!hasTestBranch)`, sign in via
`TEST_USER_EMAIL`/`TEST_USER_PASSWORD` from `.env.test`, `createdGroupIds` cleanup array.

**Gotcha found:** `Group['windows'][number]` (the `Window` shared type) requires `incognito` and
`focused` fields, not just `id`/`starred`/`tabs` — a hand-built test fixture without them fails
`tsc --noEmit` with TS2739. Always build test window objects with all four fields.

**Why this couldn't be run to green in this session:** the integration test harness here targets
a *local* Supabase stack (`http://127.0.0.1:54321`, via `.env.test` + `supabase start` + Docker),
not a hosted branch — despite the file header comment in `syncEngine.integration.test.ts` saying
"real Supabase branch." Docker Desktop wasn't running in this environment (`docker ps` →
`ECONNREFUSED`/pipe not found), so BOTH the pre-existing `syncEngine.integration.test.ts` and the
new `encryption.integration.test.ts` fail identically with `ECONNREFUSED 127.0.0.1:54321` — this
is an environment prerequisite gap, not a bug in either test file. To actually execute: start
Docker Desktop, run `supabase start` from repo root, then `pnpm --filter @tabmerger/extension
test:integration`.

**How to apply:** before claiming integration tests "pass against real Supabase," verify Docker +
`supabase start` are actually up — `docker ps` and check port 54321 — don't assume `.env.test`
presence means the stack is running.
