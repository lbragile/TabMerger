-- resetEncryption() (packages/extension/src/lib/encryptionKey.ts) deletes the
-- caller's own encryption_keys row, but 015_encryption_keys.sql only defined
-- select/insert/update policies -- with RLS on and no matching delete policy,
-- Postgres silently filters the delete to zero rows instead of erroring, so
-- resetEncryption() appeared to succeed but never actually deleted the row.
create policy "encryption_keys_delete_owner"
  on public.encryption_keys for delete
  using (auth.uid() = user_id);

-- Rollback: drop policy "encryption_keys_delete_owner" on public.encryption_keys;
