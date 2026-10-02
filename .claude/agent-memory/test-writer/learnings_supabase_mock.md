---
name: feedback-supabase-mock
description: How to mock Supabase client chains in Vitest — thenable proxy pattern with client/builder separation
metadata:
  type: feedback
---

When mocking the Supabase query builder chain in Vitest unit tests, keep two objects separate:

1. **`client`** (returned by `createServiceRoleClient`) — must NOT be thenable. If it has a `.then` property, `Promise.resolve(client)` (used by `mockResolvedValue`) will unwrap it as a Promise, and `await createServiceRoleClient()` resolves to the unwrapped value instead of the client object.

2. **`builder`** (returned by `client.from()`) — IS thenable. Define `then` as a getter that consumes the next queued response each time the chain is awaited.

```typescript
const builder: Record<string, unknown> = {}
builder.from    = vi.fn().mockReturnValue(builder)  // same-object chain
builder.select  = vi.fn().mockReturnValue(builder)
builder.update  = vi.fn().mockReturnValue(builder)
builder.delete  = vi.fn().mockReturnValue(builder)
builder.eq      = vi.fn().mockReturnValue(builder)

let idx = 0
Object.defineProperty(builder, 'then', {
  get() {
    const r = responses[idx++] ?? { data: null, error: null }
    return (resolve: Function) => Promise.resolve(r).then(resolve)
  },
  configurable: true,
  enumerable: false,
})

const client = { from: vi.fn().mockReturnValue(builder) }
vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)
```

**Why:** `Promise.resolve(thenable)` unwraps thenables — putting `then` on the top-level client mock causes `supabase` to become `{ data: [...], error: null }`, then `supabase.from` is `undefined`.

**How to apply:** Whenever mocking `createServiceRoleClient` in web unit tests. Always expose `builder` from the helper so tests can assert `.update.mock.calls` etc.
