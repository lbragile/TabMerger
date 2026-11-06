---
name: vitest-node-builtin-mocks-and-heredocs
description: Gotchas when mocking node:dns/http(s) in route tests, resetModules vs vi.mock factories, and writing test files from the Bash tool on Windows
metadata:
  type: reference
---

- Mocking `node:dns/promises`, `node:http`, `node:https` needs a `default` export too (`{ lookup, default: { lookup } }`), or Vitest errors "No default export defined" when anything imports the default.
- A `vi.mock` factory is cached across `vi.resetModules()`; to count loads or make an import fail once, register with `vi.doMock` inside a helper and call it again before a retry.
- `URL.hostname` keeps brackets for IPv6 literals; the route's address check must strip them (lib/privateAddress.ts does).
- Writing files through Bash heredocs with Python re-escaping mangled `\b`/`\n` into control characters; use the Write/Edit tools for test files containing regex or escapes.
- Full web coverage runs concurrently with another run share `coverage/.tmp` and produce spurious cold-start 5s timeouts; use `--coverage.reportsDirectory=<scratchpad>` or rerun the failing files alone.
