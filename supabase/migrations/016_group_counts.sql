-- Denormalized plaintext window/tab counts on groups.
-- Once groups.windows becomes E2EE ciphertext, the server can no longer
-- derive these by reducing over plaintext tabs. The client (extension/web,
-- which hold the decryption key) maintains these columns on every write so
-- SSR stat tiles keep working without the server needing the key.
alter table public.groups
  add column window_count integer not null default 0,
  add column tab_count integer not null default 0;

-- One-time backfill from existing plaintext windows jsonb (rows created
-- before encryption shipped still have real, readable window/tab arrays).
update public.groups
set
  window_count = jsonb_array_length(coalesce(windows, '[]'::jsonb)),
  tab_count = (
    select coalesce(sum(jsonb_array_length(coalesce(w->'tabs', '[]'::jsonb))), 0)
    from jsonb_array_elements(coalesce(windows, '[]'::jsonb)) as w
  );
