---
name: new-migration
description: Scaffold a new Supabase migration file with the numbering and RLS structure this repo already follows.
disable-model-invocation: true
---

# New migration

TabMerger migrations live in `supabase/migrations/`, numbered sequentially (`001_initial_schema.sql`
… `010_grant_table_privileges.sql`) — always a new file, never an edit to an existing one (enforced
by the `protect-migrations.py` hook).

## Steps

1. List `supabase/migrations/` to find the highest number in use; the new file is `N+1`, zero-padded to 3 digits.
2. Ask the user for a short snake_case description if not given (e.g. `add_tab_notes_column`).
3. Create `supabase/migrations/<NNN>_<description>.sql`. If the migration adds a table, include:
   - `create table ...`
   - `alter table ... enable row level security;`
   - explicit `create policy` statements for each access pattern (select/insert/update/delete) — never leave RLS enabled with no policies, and never disable RLS
   - an index on any new foreign-key column
4. For real schema work, delegate to the `database` agent instead of writing SQL directly here — this skill only sets up the file/numbering so the agent doesn't have to re-derive the convention.
5. Before applying, suggest running the `migration-reviewer` agent.
