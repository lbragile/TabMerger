---
name: real-supabase-local-suites
description: How to run the real-network integration suites (syncEngine, encryption, syncCas.real) against the LOCAL Supabase stack, and the harness gotchas
metadata:
  type: reference
---

Setup (local stack only, never a remote project):
- Docker Desktop must be running (`docker ps`); then `pnpm exec supabase status -o env` gives API_URL, PUBLISHABLE_KEY (or ANON_KEY), SERVICE_ROLE_KEY. Export them in the same shell command; never write them to a file.
- Create users with `POST $API_URL/auth/v1/admin/users` (service-role key, `email_confirm: true`). `handle_new_user()` pre-creates a free `subscriptions` row; make a user Pro with `docker exec supabase_db_<project> psql -U postgres -c "update public.subscriptions set tier='pro', status='active' where user_id=(select id from auth.users where email='...')"` (has_cloud_sync wants tier in pro/pro_ai and status in active/trialing/past_due). Keep a second user at free for RLS checks.
- Env for the suites: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` (+ `TEST_FREE_USER_EMAIL`/`TEST_FREE_USER_PASSWORD` for the free-user RLS tests in `syncCas.real.integration.test.ts`).
- Run: `pnpm --filter @tabmerger/extension exec vitest run --config vitest.integration.config.ts --no-file-parallelism [file filter]`.

Gotchas:
- Run with `--no-file-parallelism`: the real suites share one test user. `auth.signOut()` defaults to global scope and revokes the other file's session; `syncCas.real` wipes the user's groups; encryption sets a key. Parallel runs fail randomly. Use `signOut({ scope: 'local' })` in new suites.
- A conflict resolved by `performSync` creates the "(conflict copy)" group AFTER that cycle's push, so it is pending until the NEXT `performSync`; assert both states.
- Realtime under the jsdom environment: Node's undici WebSocket throws "event argument must be an instance of Event". Pass the `ws` package as `realtime.transport` (resolved from the pnpm store), and call `client.realtime.setAuth(accessToken)` explicitly for a `persistSession: false` second client, otherwise RLS silently drops every event.
- `syncConflicts.integration` (fake Supabase) failed once in 11 full runs (timing, "edit in flight" test); passes alone 3/3.
