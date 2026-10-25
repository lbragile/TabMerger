-- 024_drop_organize_runs.sql
--
-- Drops public.organize_runs, created by 004. It linked a Vercel Workflow run id to the user
-- who started the run, so the old asynchronous organize flow could check that a status request
-- came from the run's owner. Organize no longer runs as a workflow: POST /api/ai/organize
-- returns the suggested actions in its response and the extension applies them. Nothing in
-- the web app, the extension or any migration reads or writes the table any more.
--
-- What this does:
--   1. Refuses to run if a function outside the system schemas still names organize_runs.
--      Postgres records no dependency for a table named inside a function body, so the drop
--      would succeed and the function would only fail when it is next called. Views and
--      foreign keys that depend on the table need no check: they make the plain drop below
--      fail (it uses the default RESTRICT, never CASCADE).
--   2. Drops the table. Its RLS policy ("users see own runs"), primary key index, foreign key
--      to auth.users and table grants go with it.
--   3. Checks the end state.
--
-- Data: each row only mapped an old workflow run id to its owner, so the rows are disposable.
--
-- Re-running: `if exists` makes the drop a no-op once the table is gone.
--
-- Deploy order: apply this only after the web app that no longer uses the table is live (or
-- while AI is off there). Older builds insert into the table on every organize request.
--
-- Rollback: a new migration (this file's history row stays) that re-runs the create table and
-- enable row level security of 004_create_organize_runs.sql, with a select-only owner policy
-- in place of 004's `for all` one. The anon/authenticated table grants come back through the
-- schema's default privileges (010 sets them on local stacks; hosted projects have them by
-- default).

-- The table's foreign key to auth.users has internal triggers on auth.users, so the drop takes
-- an ACCESS EXCLUSIVE lock on auth.users for an instant. Fail fast instead of queueing every
-- auth lookup behind it.
set local lock_timeout = '5s';

-- 1. No function may still use the table ------------------------------------------------------
do $$
declare
  fn text;
begin
  select string_agg(format('%I.%I', n.nspname, p.proname), ', ')
    into fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc ~* '\morganize_runs\M';

  if fn is not null then
    raise exception 'organize_runs is still named by function(s): %', fn;
  end if;
end $$;

-- 2. Drop -------------------------------------------------------------------------------------
drop table if exists public.organize_runs;

-- 3. End-state check --------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.organize_runs') is not null then
    raise exception 'public.organize_runs still exists';
  end if;
end $$;
