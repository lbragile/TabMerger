-- Client-side E2E encryption: envelope-encryption key storage.
-- The AES-256 data key that actually encrypts groups/sessions is wrapped
-- (encrypted) with a key derived from the user's passphrase via PBKDF2, and
-- only the wrapped form is stored here -- the server never sees the
-- passphrase or the unwrapped data key.
create table public.encryption_keys (
  user_id       uuid        primary key references auth.users(id) on delete cascade,
  wrapped_key   text        not null, -- AES-256 data key, wrapped with a passphrase-derived key
  salt          text        not null, -- PBKDF2 salt used to derive the wrapping key
  kdf_iterations integer    not null, -- PBKDF2 iteration count (bumpable for new users without affecting old ones)
  wrap_iv       text        not null, -- IV used for the AES-GCM wrap operation
  created_at    timestamptz not null default now()
);

alter table public.encryption_keys enable row level security;

create policy "encryption_keys_select_owner"
  on public.encryption_keys for select
  using (auth.uid() = user_id);

create policy "encryption_keys_insert_owner"
  on public.encryption_keys for insert
  with check (auth.uid() = user_id);

create policy "encryption_keys_update_owner"
  on public.encryption_keys for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
