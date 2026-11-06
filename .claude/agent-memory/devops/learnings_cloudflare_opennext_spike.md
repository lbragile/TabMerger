---
name: cloudflare-opennext-spike
description: Findings from a spike running packages/web on Cloudflare Workers via @opennextjs/cloudflare
metadata:
  type: reference
---

- OpenNext Cloudflare 1.20 + Next 16.4: `next build` and middleware bundling work on Windows, but the final esbuild server bundle fails with "Access is denied" on pnpm symlinks inside `.open-next`. Build inside a Linux container instead (copy the repo to a container-local dir, `pnpm install --filter @tabmerger/web...`, then build). Output (`.open-next/worker.js`) runs under Windows `wrangler dev`.
- Next 16 `proxy.ts` is Node-only and unsupported; a `middleware.ts` (edge) exporting `middleware` is bundled fine. Tests importing `@/proxy` need a tsconfig path alias or the type-check inside the build fails.
- `pnpm add wrangler` needs `workerd: true` under `allowBuilds` in pnpm-workspace.yaml (pnpm 11 writes a placeholder otherwise and exits non-zero).
- `fs.readFileSync` of CHANGELOG.md does not work on Workers: /changelog silently falls back to legacy entries only.
- Gzipped worker is ~5.2 MiB (25.7 MB raw): over the 3 MiB free limit, under the 10 MiB paid limit.
- Docker Desktop may be stopped; start it with Start-Process of Docker Desktop.exe (there is no `docker desktop` subcommand in older CLIs).
