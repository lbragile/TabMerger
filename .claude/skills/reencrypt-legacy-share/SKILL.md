---
name: reencrypt-legacy-share
description: Walk a user through replacing an old plaintext public share link with a new E2E-encrypted one, for shared_bundles rows created before encryption support existed.
disable-model-invocation: true
---

# Re-encrypt a legacy share

A public share link (`shared_bundles`) embeds its decryption key only in the URL
fragment (`#key=...`). A link created before that scheme existed has no key and can
never be silently upgraded — the row's `groups_snapshot` will sit as plaintext forever
unless the same groups are re-shared, producing a brand-new slug and link.

This is explicit, user-driven — never invalidate or delete the old link without asking.

## Steps

1. Identify the plaintext row: `select slug, user_id, created_at from shared_bundles
   where jsonb_typeof(groups_snapshot) = 'array' order by created_at;` against project
   `xmofzeqcuyenmxgxjtrv`. Confirm with the user which row(s) they want upgraded — don't
   assume "all of them."
2. Explain plainly that the OLD link (`/share/<old-slug>`) will keep working as plaintext
   unless they also delete that row — ask whether they want it deleted after the new one
   is created, or left alone (e.g. if it's already been shared externally and breaking it
   would be worse than leaving it plaintext).
3. The actual re-share must happen from the client that holds the groups' real content —
   either the web dashboard's "Share" action on `GroupGrid.tsx` (for an already-decrypted,
   signed-in session) or the extension's `SelectionActionBar` → share flow. This skill
   cannot perform the share itself (it requires the user's live browser session and, for
   an encrypted account, their unlocked data key) — walk the user through triggering it
   themselves rather than attempting a server-side workaround.
4. Once they confirm the new link is created, verify it: `select slug, created_at,
   groups_snapshot->>'v' from shared_bundles where slug = '<new-slug>';` — should show
   `v = '1'`.
5. If they opted to delete the old row: `delete from shared_bundles where slug =
   '<old-slug>';` — only after explicit confirmation, this is destructive and the old
   link stops working immediately.
