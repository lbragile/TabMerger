---
name: atomic-quota-rpc
description: How 022's ai_reserve_credits does check-and-increment in one statement, why function EXECUTE must be revoked from anon/authenticated by name, and how a one-shot data conversion was made re-run safe
metadata:
  type: reference
---

**Single-statement reservation (022 `ai_reserve_credits`).**
```sql
insert into public.ai_usage as u (user_id, month, credits_used)
select p_user, p_month, p_amount where p_amount <= v_cap
on conflict (user_id, month) do update
  set credits_used = u.credits_used + excluded.credits_used
  where u.credits_used::bigint + excluded.credits_used <= v_cap
returning u.credits_used into v_used;   -- FOUND = allowed
```
- On conflict Postgres locks the row and evaluates the DO UPDATE `where` against the latest
  committed version, so a second concurrent call waits and then sees the first one's usage.
  Concurrent first-ever inserts take the conflict path once the first insert commits.
- The `select ... where p_amount <= v_cap` source means a refused first call of a month creates
  no row (an `insert ... do nothing` + `update` pair would leave empty rows behind).
- Cast to bigint inside the comparison so a huge amount can't overflow int before the check.
- In plpgsql `returns table (allowed, remaining, cap)` makes those names variables; qualify every
  column (`u.`, `s.`, `p.`) so nothing resolves to an out parameter.
- The cap is read before the upsert, so a concurrent plan change can affect one in-flight call;
  only the used-vs-cap check is atomic, which is what matters.

**Function privileges on Supabase.** `pg_default_acl` for schema `public` grants EXECUTE on new
functions to `anon`, `authenticated` and `service_role` explicitly (type `f`), so
`revoke ... from public` alone leaves them callable through `/rest/v1/rpc`. Revoke from
`public, anon, authenticated` and assert with `has_function_privilege()` in an end-state `do`
block. Advisors do not flag a definer function that is still executable by `authenticated`.

**Re-run-safe data conversion.** A unit conversion (`update ... set credits = f(credits)`) is not
idempotent. 022 guards it with a marker: convert only while `col_description()` of the column is
not the comment the migration sets, then set the comment (via `execute format(... %L)` inside the
`do` block). A second manual run is then a no-op.

**Testing concurrency for real** (pgTAP runs in one transaction, so it can't): commit a test user,
then in one shell start `docker exec supabase_db_tabmerger psql -c "begin; select * from fn(...);
select pg_sleep(4); commit;" &`, sleep 1, and run the competing call in a second `docker exec`.
The second call should block about 3 s and be refused. Delete the user afterwards (cascades).
See [[local-rls-verification]].
