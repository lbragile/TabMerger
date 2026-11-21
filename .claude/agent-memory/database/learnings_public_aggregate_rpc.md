---
name: public-aggregate-rpc
description: Pattern for a no-argument public "all counts" RPC next to an existing per-key security definer count (032 blog_helpful_counts) - invoker outer function, share the counting rule, pin the result shape, runtime-refusal test role (and the grant-to-current_user segfault), verify over PostgREST as anon
metadata:
  type: reference
---

Used for `blog_helpful_counts()` (032) next to 031's `blog_helpful_count(slug)`.

- **Share the rule by calling the per-key function per row**
  (`select p.slug, public.blog_helpful_count(p.slug) from public.blog_posts p`) instead of
  re-writing the count as a `left join ... group by`. The two can't drift, and a post with no
  votes is still listed (an inner join or a `group by` over the votes table drops it). Cost is
  one PK-prefix count per row, fine for a small, migration-managed key table.
- **Keep the outer function `security invoker`** (still `set search_path = ''`) when the
  callers can already read the key table and execute the inner function. Only the inner
  function needs to be a definer (it reads rows RLS hides). The outer one then honours any
  later policy on the key table (drafts, say) and stays off the advisor's definer list.
  End-state check: `not prosecdef and provolatile = 's'`; test with `isnt_definer`.
- **A string body records no pg_depend edge** to the inner function, so dropping the inner one
  is not refused (see [[drop-table-dependency-check]]). Say so in the migration header and the
  schema doc. `begin atomic` bodies would record it; they are untested with this project's CLI
  migration path, so the migrations keep string bodies.
- **Pin the result shape in the end-state check and the test** with
  `format('%s|%s|%s', pronargs, array_to_string(proargnames, ','), array_to_string(proallargtypes::regtype[], ','))`
  = `'0|slug,helpful|text,bigint'`, and pin what PostgREST will serialise with
  `select array_agg(distinct k order by k) from f() r, jsonb_object_keys(to_jsonb(r)) k`.
- **Equality test across all keys:** `is_empty` over
  `blog_posts p full join f() c on c.slug = p.slug where p.slug is null or c.slug is null or c.helpful is distinct from inner(p.slug)`
  catches wrong counts, missing and extra rows in one assert. Run it as `anon` and as
  `authenticated` (who sees only their own vote rows). Negative control: swap in a
  `group by` over the votes table; the 0-count, missing-row and equality asserts must fail.
- **Runtime refusal for a role without the grant** (not only `has_function_privilege`):
  `create role pgtap_nobody nologin; grant pgtap_nobody to postgres; grant usage on schema extensions to pgtap_nobody; set local role pgtap_nobody;`
  then `throws_ok(..., '42501', 'permission denied for function <fn>')`, all inside the
  rolled-back test transaction. Without the `extensions` usage, pgTAP's own `throws_ok` is
  not found (42883). **Never write `grant <role> to current_user`** on the local Supabase
  image (PG 15.8): the backend segfaults (signal 11) and the whole server restarts through crash
  recovery, dropping every connection. Name the role (`to postgres`).
- **HTTP check as anon:** after `migration up --local`, run `notify pgrst, 'reload schema'`, then
  from the db container `curl http://supabase_rest_tabmerger:3000/rpc/<fn>` with no
  Authorization header (PostgREST uses its anon role). GET and POST `{}` both work for a stable
  no-argument function. `bigint` comes back as a JSON number. See [[local-rls-verification]].
