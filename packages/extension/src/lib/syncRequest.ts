/**
 * Upper bound for ONE network request made during a sync cycle. A cycle runs under the
 * cross-context sync lock (see `syncLock.ts`); without a bound, a request the network never
 * answers would hold that lock (and skip every later cycle) until the browser gave up on it.
 * PostgREST's own GET retries (1 s + 2 s + 4 s backoff after a network error) share the same
 * signal, so the bound covers a request together with its retries.
 */
export const SYNC_REQUEST_TIMEOUT_MS = 25_000;

/** A fresh signal per request: pass it to `.abortSignal(...)` on every sync-cycle query. */
export const syncRequestSignal = (): AbortSignal => AbortSignal.timeout(SYNC_REQUEST_TIMEOUT_MS);
