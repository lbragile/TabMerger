---
name: token-gated-definer-rpc
description: Pattern for an RPC that anon may call but only a holder of a single-purpose token may use (035 sync_blog_posts) - hash in a non-exposed schema, built-in sha256, check order, one generic refusal, owner sets the hash from a locally computed digest
metadata:
  type: reference
---

Used for `sync_blog_posts(p_slugs, p_token)` (035), which a CI deploy job calls with only the
public anon key.

- **Store only the SHA-256, in a schema the API doesn't expose** (`private`), with `revoke all on
  schema private from public, anon, authenticated, service_role` and the same on the table, RLS on
  with no policies. Pin both in the end-state check with `has_schema_privilege(role, 'private',
  'USAGE')` (the `public` pseudo-role works there too) and `has_table_privilege`. A plain table
  beats Vault for a hash: Vault is for secrets the database must read back in clear.
- **Single-row settings table:** `id boolean primary key default true, check (id)`; nullable hash
  with `check (hash is null or octet_length(hash) = 32)`. No row or null hash = fail closed.
- **Use `pg_catalog.sha256(convert_to(p_token, 'UTF8'))`** (built in since PG 11) rather than
  pgcrypto's `extensions.digest()`: same bytes, nothing to resolve under `search_path = ''`, no
  dependency on where pgcrypto lives. Compare with `is distinct from` so a null token is refused,
  not skipped (`null <> hash` is null, and an `if` on null does not fire).
- **Order: token first, then input validation**, and every token failure (no row, null hash,
  null/over-long/wrong token) raises the same `not authorized` with errcode 42501. A caller
  without the token then learns nothing, not even the input rules, and never reaches any lock.
  Cap the token length before hashing.
- **Set the hash without sending the token to the database:** compute
  `printf %s "$TOKEN" | sha256sum` locally (printf, not echo: a trailing newline changes the
  hash) and store `decode('<hex>', 'hex')`. Hashing inside the SQL editor puts the token in query
  logs. Verified: the shell digest equals `sha256(convert_to(token, 'UTF8'))`.
- **Volatile RPC over PostgREST needs POST**: GET runs in a read-only transaction.
- **Deploy-driven "unlisted" marking needs a grace period** (missing_since + delete after N days),
  because preview deploys from older branches and partial lists would otherwise delete rows and
  cascade away user data. Clear listed rows before the delete in the same call.
- `rollback to savepoint` inside a pgTAP file also rolls back the recorded results; put a test
  that changes a lot of state (e.g. the 1000-entry accept case) at the end instead.

Dry-running without Docker: [[scratch-pg-pgtap-shim]]. Related: [[public-aggregate-rpc]],
[[signed-in-vote-table-pattern]], [[server-managed-table-pattern]].
