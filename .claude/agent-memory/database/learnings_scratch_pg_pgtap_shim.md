---
name: scratch-pg-pgtap-shim
description: Dry-running a migration and its pgTAP file when Docker/local Supabase is down - throwaway initdb cluster on its own port, Supabase role/auth stand-ins, a minimal pgTAP shim, and the gotchas (oidvector bounds, set-op precedence) plus what it cannot prove
metadata:
  type: reference
---

When the local Supabase stack isn't running (don't start Docker uninvited), a standalone
Postgres install (`C:\Program Files\PostgreSQL\<ver>\bin`) can still prove a migration's logic.

- **Never use an existing server.** Roles are cluster-wide, so creating `anon`/`authenticated`
  on a shared server changes it. Instead: `initdb -D <scratchpad>/pgNNN -U postgres -A trust -E
  UTF8 --no-locale`, `pg_ctl -o "-p 55435 -c listen_addresses=localhost" start`, a uniquely named
  database, and afterwards `drop database`, `pg_ctl stop -m fast`, delete the directory.
- **Stand-ins:** roles `anon`, `authenticated` (nologin), `service_role` (bypassrls), granted to
  postgres; schemas `auth` and `extensions`; `auth.users(id uuid pk, email)`; `auth.uid()`
  reading `request.jwt.claim.sub` then `request.jwt.claims->>'sub'`; `auth.jwt()`; and
  `alter default privileges in schema public grant all on tables/functions to anon,
  authenticated, service_role` so revokes are tested against Supabase-like defaults.
- **pgTAP shim** in `extensions` (database `search_path` includes it): `plan`, `ok`,
  `is(anyelement, anyelement, text)`, `throws_ok(text, char(5), text, text)` (exception block,
  compare `sqlstate`/`sqlerrm`), `lives_ok`, `is_empty`, `is_definer`/`isnt_definer`, `finish`.
  Keep the counter in a GUC via `set_config` so it survives `set local role`. Run the real test
  file with `psql -X -q -t -f`. Negative controls: `begin;` + a mutation + `\i test.sql` (the
  test's own `rollback` undoes the mutation).
- **Gotcha: `proargtypes::regtype[]` is 0-based** (`[0:1]={text[],text}`), so `=` against a
  1-based array literal is false. Compare `array_to_string(..., ',')`, as real pgTAP does.
- **Gotcha: `A except B union all C except D`** is `((A except B) union all C) except D`; a
  symmetric "nothing changed" diff needs parentheses around each `except`.
- **What it cannot prove:** Supabase's real grants and default ACLs, PostgREST behaviour (HTTP
  status, GET vs POST, anon via the gateway), the `extensions`/pgcrypto layout, the real pgTAP
  functions (`policies_are`, `policy_cmd_is` aren't in the shim), the Postgres major the stack
  runs, and the CLI migration batch ([[cli-batch-needs-begin-commit]]). Say so in the report and
  still run `supabase migration up --local` + `supabase test db` when the stack is up.

See [[local-rls-verification]].
