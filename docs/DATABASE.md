# Database Guide

This is the practical guide: stack, local development, migrations, sync and common queries. For every table's columns, RLS, indexes and encrypted columns, see **[database-schema.md](database-schema.md)**. The migrations in `supabase/migrations/` are the source of truth.

## Stack

- **Database:** PostgreSQL on Supabase. There are two hosted projects, preview (`xmofzeq…`) and production (`jzgz…`); see [ARCHITECTURE.md § Environments](ARCHITECTURE.md#environments).
- **Auth:** Supabase Auth, with email and Google OAuth (`[auth.external.google]` in `supabase/config.toml`).
- **Realtime:** `postgres_changes` on `public.groups` only (migration 011).
- **Local:** the Supabase CLI stack, configured in `supabase/config.toml`.

## Tables at a glance

| Table | Written by | Notes |
|---|---|---|
| `profiles` | `handle_new_user()` trigger | Never insert from app code |
| `subscriptions` | trigger (free row) and Stripe webhook (service role) | One row per user (`UNIQUE(user_id)`) |
| `groups` | extension `syncEngine.ts` | Content is E2E-encrypted |
| `sessions` | extension `useSessions.ts` | Content is E2E-encrypted |
| `device_sessions` | extension `deviceSessions.ts` | Now Open snapshot is E2E-encrypted |
| `shared_bundles` | extension `sharing.ts`, web `POST /api/share-bundle` | Public read. Encrypted with a per-share key carried in the URL `#key=` |
| `encryption_keys` | extension `encryptionKey.ts` | Wrapped data key only |
| `organize_runs` | `POST /api/ai/organize` | Links a run to its owner |
| `ai_usage`, `ai_credit_purchases` | AI routes / Stripe webhook (service role) | Credit metering |

## E2E encryption

For signed-in Pro users, `groups.windows` (holding `name`/`windows`/`note`/`info`), `sessions.groups` (holding `name`/`groups`/`description`), `device_sessions.now_open_snapshot` and `shared_bundles.groups_snapshot` are stored as `{v:1, iv, ct}` ciphertext. The plaintext `name`/`note`/`info`/`description` columns are blanked when the row is written. **The server never holds the key.**

Consequences:

- A server-side `.select()` of those columns returns ciphertext for every real account. Routes that need the content take it client-decrypted in the request body (`organize`, `share-bundle`).
- Stats the server needs come from the plaintext `groups.window_count`/`tab_count` (migration 016). The client computes them before encrypting.
- Run the `encrypted-column-auditor` agent before merging any API route that touches these tables.

Details are in [database-schema.md § E2E-encrypted columns](database-schema.md#e2e-encrypted-columns).

## Triggers and functions

- `handle_new_user()` runs `AFTER INSERT ON auth.users` (`security definer`). It inserts the `profiles` row and a `subscriptions` row with `id = 'free_' || user_id`, `tier = 'free'`, `status = 'active'`.
- `update_updated_at()` runs `BEFORE UPDATE` on `groups` and `subscriptions` and sets `updated_at = now()`.
- `increment_group_view_count(slug_param)` is `security definer` and is currently unused by the app.

## Row Level Security

RLS is enabled on every table.

- Owner-only (`auth.uid() = user_id`, or `= id` for `profiles`): `profiles` (select/update), `groups`, `sessions`, `device_sessions` and `encryption_keys` (full CRUD), and `organize_runs` (`for all`).
- Read-only for the owner, with writes through the service role: `subscriptions`, `ai_usage`, `ai_credit_purchases`.
- `shared_bundles`: **public select** (`using (true)`), insert for `authenticated` users where `user_id = auth.uid()`, owner delete, and no update.

The **service role key** bypasses RLS. Use it only on the server: in the Stripe webhook and for AI usage metering. Never use it on the client.

## Migrations

Always add a new file and never edit an applied one; a hook (`.claude/hooks/protect-migrations.py`) blocks such edits. Name files `NNN_description.sql` with the next number (currently `019`). Before applying, run the `migration-reviewer` agent, and consider the `/new-migration` skill.

```bash
supabase migration new <description>   # then rename to NNN_<description>.sql
supabase db reset                      # rebuild local DB from all migrations + seed.sql
supabase db diff                       # local DB vs migrations
supabase migration list --linked       # what the linked hosted project has applied
supabase db push                       # apply pending migrations to the linked project
```

The preview and production projects are separate. Push to each one and check `migration list --linked` against each.

## Sync architecture (extension ↔ `groups`)

1. Every edit writes IndexedDB first and marks the group `pendingSync: true`.
2. `performSync` (`packages/extension/src/lib/syncEngine.ts`) pushes pending groups. It encrypts when a key is present, and skips the push, leaving it pending, while the key is locked. It never falls back to plaintext. The permanent Now Open group is never pushed.
3. It then pulls all remote rows for the user and merges them **last-write-wins on `updatedAt`**. A synced local group that is missing remotely is treated as deleted remotely. Ids in the `pendingDeleteGroupIds` setting are ignored so an in-flight delete isn't brought back.
4. The popup triggers a sync on mount, on `online`, and every 30 s. It also saves Realtime `groups` changes straight to IndexedDB. The web dashboard can trigger a sync through the extension's `SYNC_NOW` message.
5. Deletes are hard deletes (`deleteRemoteGroups`), tried once.

`windows` stores the whole `ExtWindow[]` tree as JSONB, or as one encrypted blob. Tabs have no table of their own.

Known open race bugs (sync reverting edits, delete resurrection, popup vs. background write race) are listed in [TODO.md](../TODO.md). Have the `sync-conflict-auditor` agent review any change to `syncEngine.ts` or `localDb.ts`.

## Common queries

```typescript
// Subscription tier — one row per user, so .maybeSingle() (as useEntitlements does)
const { data } = await supabase
  .from('subscriptions')
  .select('tier, status, cancel_at_period_end, current_period_end, stripe_price_id')
  .eq('user_id', userId)
  .maybeSingle();

// Webhook-side subscription write: conflict on user_id, NOT id — the trigger already
// created a row for this user, so an insert on a new id hits 23505.
await supabaseAdmin.from('subscriptions').upsert(row, { onConflict: 'user_id' });

// Group push (encrypted shape) — see pushGroup in syncEngine.ts for the real code
await supabase.from('groups').upsert({
  id, user_id, color, starred, archived,
  updated_at: new Date(updatedAt).toISOString(),
  windows: { v: 1, iv, ct },          // encrypts {name, windows, note, info}
  name: '', note: null, info: '',
  window_count, tab_count,            // plaintext, computed before encrypting
});

// Realtime — remember to supabase.removeChannel(channel) on cleanup
const channel = supabase
  .channel(`groups:${userId}`)
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'groups', filter: `user_id=eq.${userId}` },
    (payload) => { /* decrypt if isEncryptedBlob(payload.new.windows), then save to IDB */ })
  .subscribe();
```

## Local development

```bash
supabase start          # Docker required
supabase db reset       # apply migrations + seed.sql
```

| Service | URL |
|---|---|
| API | `http://127.0.0.1:54321` |
| DB | port `54322` |
| Studio | `http://127.0.0.1:54323` |
| Mail catcher (Inbucket/Mailpit) | `http://127.0.0.1:54324` |

The extension's `.env.local` already points at `http://127.0.0.1:54321`. For the web app, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `packages/web/.env.local`. `supabase start` prints the local keys.

> **Known issue:** `supabase db reset` applies every migration, but then `seed.sql` fails with `23505` on `subscriptions_user_id_key`. Its subscriptions insert uses `on conflict (id)`, while the trigger has already created each user's row. The seeded test users therefore don't get their subscriptions. Until that's fixed, sign up through the app and confirm the email in the local mail catcher. It is tracked in [TODO.md](../TODO.md).
