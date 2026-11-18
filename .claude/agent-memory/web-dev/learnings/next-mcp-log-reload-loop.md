---
name: next-mcp-log-reload-loop
description: Next 16's dev MCP server log file inside a monorepo-root turbopack.root causes an endless "Compiled in 2ms" / GET / reload loop
metadata:
  type: learning
---

**Symptom:** `next dev` prints `✓ Compiled in 2ms` then `GET / 200` every ~1.5–2.5s forever, and the open page keeps reloading, even when nobody is editing anything.

**Cause:** Next 16's built-in MCP server (`experimental.mcpServer`, default `true`) turns on a FileLogger (`next/dist/server/dev/browser-logs/file-logger.js`) that appends every server and browser log line to `<distDir>/logs/next-development.log`, i.e. `packages/web/.next/dev/logs/`. `next.config.ts` sets `turbopack.root` to the monorepo root, so Turbopack's watcher covers that file. Each log write counts as a change, Turbopack recompiles and logs "Compiled", that write triggers the next change, and the loop feeds itself. Any change elsewhere in the repo (another session editing the extension, for example) can start it.

**Fix (in place):** `experimental: { mcpServer: false }` in `next.config.ts`. Nothing in the repo uses Next's MCP endpoint. If that endpoint is ever needed, the log has to move out of the watched tree first.

**How to diagnose this kind of loop:** use a `System.IO.FileSystemWatcher` (PowerShell) on the repo root for ~10s and count changes per path. A file that keeps changing with no editor behind it is the loop's medium. A `LastWriteTime` scan that skips `.next` misses it.
