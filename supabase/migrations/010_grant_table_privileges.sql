-- Local Supabase CLI stacks don't get the schema-level grants that Supabase
-- Cloud provisions implicitly for anon/authenticated, so tables created by
-- prior migrations were missing SELECT/INSERT/UPDATE/DELETE entirely (RLS
-- never even gets evaluated without the base grant). This restores parity
-- with hosted Cloud projects. RLS policies remain the actual access gate.

grant select, insert, update, delete on all tables in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
