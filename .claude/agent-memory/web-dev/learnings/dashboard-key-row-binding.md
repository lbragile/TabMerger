---
name: dashboard-key-row-binding
description: How the web dashboard's cached data key is tied to its encryption_keys row, how readers report rows they cannot decrypt, how locked items behave, and the test patterns for all of it
metadata:
  type: reference
---

# Dashboard data key: bound to its key row

`lib/encryption/context.tsx` (`EncryptionKeyProvider`) follows the extension's rule: a cached data key is only valid for the `encryption_keys` row it was unwrapped from. The fingerprint is `salt + '.' + wrap_iv`.

## Behaviour
- The sessionStorage entry (`tabmerger:dataKey:<userId>`) is JSON `{ key, fingerprint }`. A bare base64 string (the earlier format) is read as a key with no fingerprint.
- On load the cached key is used at once (no passphrase prompt flash on refresh) and the key row (`user_id, salt, wrap_iv`) is read alongside. Verdicts: `current` (keep, `keyVerified = true`), `replaced` (different row or no fingerprint: drop, status `locked`), `removed` (server answered no row: drop, `no-key`), `unknown` (lookup failed: keep, claim nothing). A key is never dropped on missing information.
- Readers (`GroupGrid`, `SessionList`, `DevicesSection`) pass the rows they could not decrypt to `recheck(rows)`, using `unreadableRowKey(table, id, blob)` (includes the blob IV, so a row uploaded again counts as new).
- Loop guards inside the provider: one lookup in flight (later callers join it, including the load check); rows already examined under the current key start nothing; rows that fail within `VERIFIED_KEY_GRACE_MS` of a successful check are attributed to the row, not the key. Rows are marked examined only when a lookup answered `current`, so a failed lookup is retried on the next pass.
- A reader's effect must not depend on `keyVerified`: it would re-run the decrypt pass every time a check flips it.

## Locked items
- A row that fails to decrypt becomes a placeholder with `locked: true` and the name "(locked)". The reason is shown inside the item by `LockedItemNote` (lock icon and visible text), not as a list-level banner. It only says "earlier passphrase" when `keyVerified` is true; otherwise it says the item can't be read right now.
- Nothing that needs the content acts on a locked item: group Share is refused, a locked group cannot be selected and is filtered out of a bundle even if the selection holds its id, session Restore is refused. Session Delete stays available (it needs only the id). Counts are hidden because the placeholder's empty content is not the real content.
- Controls that must explain why they are unavailable use `aria-disabled` + `aria-describedby` (the note's `useId`) instead of `disabled`: a natively disabled button is not focusable, so a Radix tooltip on it is unreachable by keyboard. The click handler then has to refuse by itself.

## Test patterns (`__tests__/encryption-key-binding.test.tsx`, `locked-items.test.tsx`)
- Stub crypto with strings: a data key is its name, a blob carries `__key`, `decryptBlob` throws on mismatch, and `importKeyFromBase64` rejects anything that is not `b64(...)` so a wrong storage format fails loudly.
- Count key row lookups by the `select()` column list (`'*'` is `unlock()`); pass the columns through the Supabase mock to tell them apart.
- Step past the grace window with `vi.spyOn(Date, 'now')` returning real time plus an offset; RTL's `waitFor` keeps working because timers stay real.
- jest-dom's `toBeDisabled()` ignores `aria-disabled`; assert the attribute and that the click does nothing.
- A regex text query is case sensitive: a sentence-initial capital silently turns `findByText` into a timeout.
