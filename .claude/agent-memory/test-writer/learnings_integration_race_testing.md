---
name: learnings-integration-race-testing
description: Technique for reproducing async races in extension integration tests - fake Supabase with one-shot gates on globalThis, resetModules for a second JS context or worker restart
metadata:
  type: reference
---

- Fake only the network edge: `vi.mock('@/lib/supabase', async () => ({ supabase: (await import('./fakeSupabase')).fakeSupabase }))` and mock `@/lib/encryptionKey`. localDb stays real (fake-indexeddb).
- `integration/fakeSupabase.ts` exposes `fakeRemote.hold('upsert' | 'select')`: a one-shot gate returning `{entered, release}`. `await gate.entered`, do the local write, then `release()`. The select snapshot is taken after the gate, like a late server answer.
- Keep fake remote state on `globalThis` so it survives `vi.resetModules()`. Two `resetModules()` + dynamic `import('@/lib/localDb')` calls give two independent write queues (popup vs service worker) on one IndexedDB; a re-imported syncEngine simulates a restart.
- fake-indexeddb with truly simultaneous cross-context writes can interleave the orphan-prune key reads and mask a lost write; sequence the two writes (both read first) to make it deterministic.
