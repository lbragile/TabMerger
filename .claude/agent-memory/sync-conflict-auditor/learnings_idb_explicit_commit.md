---
name: learnings-idb-explicit-commit
description: IndexedDB facts to check any change to transaction commit timing against - explicit tx.commit(), not awaiting a read-only transaction, what survives a destroyed page, and what fake-indexeddb does and does not model
metadata:
  type: reference
---

Facts about transaction commit timing in `localDb.ts` (idb 8 wrapper, fake-indexeddb 6 in unit tests):

- **`tx.commit()` keeps the transaction atomic.** Requests already issued are still processed; a request that fails afterwards aborts the whole transaction (even if `preventDefault` were called); new requests are refused. It must be called while the transaction is active, i.e. in the same synchronous run as the last request (or the same microtask run as a success callback). `tx.done` still rejects on abort, so `await Promise.all([...requests, tx.done])` after `commit()` surfaces every failure.
- **A synchronous throw while issuing requests does not abort a transaction.** `put` throws `DataError` (no key path value) or `DataCloneError` (value cannot be cloned) synchronously; requests issued before it auto-commit unless `tx.abort()` is called. Explicit `commit()` does not change this: it is simply never reached.
- **A read-only transaction's `done` does not need to be awaited.** Results arrive with the success events; the snapshot is fixed by creation order, not by when `done` resolves. idb's shortcut reads (`db.get`, `db.getAll`) never await it either. Attach a `catch` to `done` so a later abort is not an unhandled rejection.
- **Creating the readwrite transaction before the read-only one finished is safe.** IndexedDB orders overlapping-scope transactions by creation, across connections and contexts. This is also why a Web Lock released by a dying context before its commit completed is harmless: any transaction created later waits for it.
- **A write that lands after its page died runs no post-commit code** (change notification, cache update, follow-up settings writes). Anything that follows a groups write must be re-doable on the next run.
- **fake-indexeddb's `commit()` only flips the state to `committing`.** It models "must be active" and "refuses new requests", not timing or page teardown: with or without `commit()` the fake completes the transaction the same way. Unit tests can therefore pin the CALL ORDER (commit in the same tick as the last request) and nothing else; durability on teardown needs a real-browser test that destroys the page synchronously (removing an iframe; a reload or `page.close()` lets the old document run long enough to hide the bug).
- **Dropping a `complete` listener in a test** (mocking `IDBTransaction.prototype.addEventListener`) is a valid way to prove code does not wait for a transaction: fake-indexeddb only uses its internal `complete` hook for versionchange transactions.

**How to apply:** when a writer's commit or await order changes, check (1) no await between the last request and `commit()`, (2) the lock and queue are still released only after `tx.done`, (3) every step after the write is re-doable, (4) the unit test asserts ordering and an e2e asserts durability. Related: [[learnings-groups-write-queue-constraints]].
