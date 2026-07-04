# Database Reference

## Stack

- **Database:** PostgreSQL (hosted on Supabase)
- **Auth:** Supabase Auth (email + Google OAuth)
- **Realtime:** Supabase Realtime (Postgres changes → extension sync)
- **Local dev:** Supabase CLI (`supabase start`)

---

## Schema

### profiles
Extends `auth.users`. **Auto-created by trigger** — never insert manually.
```sql
id              uuid PRIMARY KEY → auth.users(id)
email           text NOT NULL
stripe_customer_id text UNIQUE
created_at      timestamptz DEFAULT now()
```

### subscriptions
**Auto-created as 'free' by trigger** on signup. Updated by Stripe webhook.
```sql
id              text PRIMARY KEY   -- Stripe subscription ID (or 'free_{user_id}' for free tier)
user_id         uuid → profiles(id)
tier            text CHECK (tier IN ('free', 'pro', 'pro_ai'))
status          text CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete'))
current_period_end timestamptz
created_at      timestamptz
updated_at      timestamptz  -- auto-updated by trigger
```

### groups
Synced from extension. Uses `id` from extension (nanoid), not auto-generated.
```sql
id              text PRIMARY KEY   -- nanoid(10) from extension
user_id         uuid → profiles(id)
name            text NOT NULL
color           text NOT NULL DEFAULT 'rgba(128,128,128,1)'
position        integer NOT NULL DEFAULT 0
windows         jsonb NOT NULL DEFAULT '[]'  -- full window+tab tree
info            text
updated_at      timestamptz  -- auto-updated by trigger; used for sync conflict resolution
created_at      timestamptz
```

### sessions
Saved snapshots of groups (point-in-time).
```sql
id              text PRIMARY KEY   -- nanoid(10)
user_id         uuid → profiles(id)
name            text NOT NULL
description     text
groups          jsonb NOT NULL DEFAULT '[]'  -- snapshot of Group[]
created_at      timestamptz
```

---

## Triggers

### handle_new_user
Fires `AFTER INSERT ON auth.users`. Creates `profiles` row + free `subscriptions` row.
Defined in `supabase/migrations/001_initial_schema.sql`.

### update_updated_at
Fires `BEFORE UPDATE` on `groups` and `subscriptions`. Sets `updated_at = now()`.

---

## Row Level Security

All tables have RLS enabled. All policies use `auth.uid()`:
- `profiles`: `auth.uid() = id`
- All others: `auth.uid() = user_id`

**Service role key** bypasses RLS — use only server-side (webhook handler, AI routes).

---

## Migrations

Files in `supabase/migrations/` — always add new files, never edit existing ones.

```bash
# Create a new migration
supabase migration new add_user_preferences

# Apply all migrations to local DB
supabase db reset

# Check diff between current local DB and migrations
supabase db diff

# Push to remote Supabase project
supabase db push
```

Naming: `NNN_description.sql` where NNN is the next sequential number (001, 002, 003...).

---

## Sync Architecture

Extension uses **optimistic local-first** sync:
1. Write to IndexedDB immediately (offline-first, UI is instant)
2. Mark group as `pendingSync: true` in IndexedDB
3. `syncEngine.ts` (background, triggered on online event + alarm) UPSERTs pending groups to Supabase
4. Realtime subscription receives changes from other devices → merges into IndexedDB
5. Conflict resolution: **last-write-wins** by `updated_at` timestamp

The `windows` column stores the full `ExtWindow[]` structure as JSONB — tabs are not stored in a separate table (denormalized for simplicity and performance).

---

## Common Queries

```typescript
// Get user's subscription tier
const { data } = await supabase
  .from('subscriptions')
  .select('tier, status')
  .eq('user_id', userId)
  .single();

// Upsert groups (sync push)
await supabase.from('groups').upsert(
  groups.map((g, i) => ({
    id: g.id,
    user_id: userId,
    name: g.name,
    color: g.color,
    position: i,
    windows: g.windows,
    info: g.info,
    updated_at: new Date(g.updatedAt).toISOString(),
  })),
  { onConflict: 'id' }
);

// Realtime subscription
const channel = supabase
  .channel('groups')
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'groups',
    filter: `user_id=eq.${userId}`
  }, (payload) => { /* merge into IndexedDB */ })
  .subscribe();
// Cleanup: supabase.removeChannel(channel)
```

---

## Local Development

```bash
# Start local Supabase (Docker required)
supabase start

# Apply migrations + seed data
supabase db reset

# Open local Supabase Studio
open http://localhost:54323

# Local URLs
# API: http://localhost:54321
# Anon key: printed by `supabase start`
```

Set `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321` and the local anon key in `packages/web/.env.local` for local development.
