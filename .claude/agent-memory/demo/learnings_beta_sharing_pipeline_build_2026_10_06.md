---
name: beta-sharing-pipeline-build
description: beta-screenshots-sharing.ts loads a stale .pw-ext-dev copy by default; how to regenerate one beta image safely from a fresh demo build
metadata:
  type: reference
---

- `beta-screenshots-sharing.ts` defaults `TM_DEMO_EXT_DIR` to `packages/demo/.pw-ext-dev`, a stale gitignored copy. For a current UI, run `pnpm --filter @tabmerger/extension build:extension:demo` (writes `.output/chrome-mv3-demo`, built against the local stack via `.env.local`) and set `TM_DEMO_EXT_DIR` to that dir. Never touches `chrome-mv3-dev`.
- Phase `device2` needs phase `ext` first (it recreates the throwaway Pro user and sets up encryption). Running `ext device2` rewrites ~9 beta images; back up `packages/web/public/beta` to temp first and copy back everything except the target image, then compare md5 sums.
- Every capture is CDP webp with `clip.scale: 2` on an 800x600 popup = 1600x1200.
