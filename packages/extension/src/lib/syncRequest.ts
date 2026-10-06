/**
 * Upper bound for ONE network request made during a sync cycle. A cycle runs under the
 * cross-context sync lock (see `syncLock.ts`); without a bound, a request the network never
 * answers would hold that lock (and skip every later cycle) until the browser gave up on it.
 * PostgREST's own GET retries (1 s + 2 s + 4 s backoff after a network error) share the same
 * signal, so the bound covers a request together with its retries.
 */
export const SYNC_REQUEST_TIMEOUT_MS = 25_000;

/**
 * Budget for ONE PHASE of a sync cycle. The per-request timeout alone lets N pending groups hold
 * the sync lock for N x 25 s on a network that swallows requests; once a phase's budget is used up
 * it starts no further request (what was not sent stays pending for the next cycle).
 *
 * A cycle has two phases, each with its own budget: SENDING (the push and the delete flush share
 * one) and then the paged PULL (a fresh one, so a push backlog can never use up the pull's time).
 * A phase ends at most one request timeout after its deadline (the request in flight when it
 * passed), so the worst case for a whole cycle is 2 x (60 s + 25 s) = 170 s, not 85 s. One
 * exception adds a further 25 s: the last group of the first sync after the base-stamp upgrade is
 * a lookup plus a write.
 */
export const SYNC_CYCLE_BUDGET_MS = 60_000;

/** The deadline of a cycle that starts now. */
export const cycleDeadline = (): number => Date.now() + SYNC_CYCLE_BUDGET_MS;

/** A fresh signal per request: pass it to `.abortSignal(...)` on every sync-cycle query. */
export const syncRequestSignal = (): AbortSignal => AbortSignal.timeout(SYNC_REQUEST_TIMEOUT_MS);
