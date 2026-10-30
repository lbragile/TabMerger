-- pgTAP test for 024_drop_organize_runs.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves: the organize_runs table, and with it its policy, is gone, and no function
-- outside the system schemas still names it.

begin;
select plan(3);

select hasnt_table('public', 'organize_runs', 'organize_runs is dropped');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'organize_runs'),
  0,
  'no policy remains for organize_runs'
);

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and p.prosrc ~* '\morganize_runs\M'),
  0,
  'no function names organize_runs'
);

select * from finish();
rollback;
