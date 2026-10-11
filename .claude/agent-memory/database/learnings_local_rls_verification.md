---
name: local-rls-verification
description: Practical ways to verify a policy or grant change on the local Supabase stack - dry runs before writing the one-shot migration file, pgTAP runner limits, and an HTTP check that needs no API key
metadata:
  type: reference
---

- **A migration file is write-once.** The protect-migrations hook blocks any Write/Edit to a
  `supabase/migrations/*.sql` path that already exists, including a file created minutes ago.
  Draft the SQL in the scratchpad, `docker cp` it into `supabase_db_tabmerger`, and run it with
  `\i` inside `begin; ... rollback;` (twice, for idempotency) before writing the real file.
- **Apply without wiping data:** `pnpm exec supabase migration up --local`. In
  `migration list --local` the "remote" column is the local database, not a hosted project.
- **pgTAP runner is `postgres`**, which locally is not a superuser. It can `set local role` to
  `anon`, `authenticated` and `service_role`, but not `supabase_auth_admin`, and
  `psql -U supabase_admin` asks for a password. Signup-path tests therefore insert into
  `auth.users` as the runner and assert `is_definer()` on the trigger function.
- **pgTAP details:** a data-modifying CTE must be top level, so write
  `with x as (update ... returning 1) select is((select count(*)::int from x), 0, '...')`.
  `policies_are('public', '<table>', array[...])` pins the exact policy set. A `grant` inside
  the test transaction is a clean way to test the policy layer separately from the privilege
  layer.
- **HTTP-level check without any API key:** the db container has `curl` and sits on the same
  docker network as the other services. `http://supabase_auth_tabmerger:9999/signup` creates a
  real user (the reply carries a session), and `http://supabase_rest_tabmerger:3000/<table>`
  is PostgREST without the gateway, which only needs `Authorization: Bearer <that session>`.
  Keep the token in a shell variable, never print it, and delete the throwaway user from
  `auth.users` in an exit trap. The auth container only has BusyBox `wget` (GET/POST only).
- **Windows shell:** a Bash heredoc containing an unbalanced apostrophe fails to parse in this
  harness even when the delimiter is quoted; write SQL scratch files with the Write tool. Use
  `MSYS_NO_PATHCONV=1` for container paths and `cygpath -w` for the host side of `docker cp`.
- **Advisors run locally:** `pnpm exec supabase db advisors --local --type all --level info`
  (JSON after the first line) and `pnpm exec supabase db lint --local`.
