-- Add columns that exist on the Group type but were missing from the schema,
-- causing sync failures ("Could not find the 'permanent' column").

alter table public.groups
  add column if not exists permanent  boolean     not null default false,
  add column if not exists starred    boolean     not null default false,
  add column if not exists archived   boolean     not null default false,
  add column if not exists note       text;
