---
name: missing-icon-assets-ea8b0d5
description: Build broke because commit ea8b0d5 deleted all extension logos; manifest icons + Header logo import had no files, and a blanket *.png gitignore with a wrong un-ignore path hid the fix
metadata:
  type: project
---

`pnpm dev:extension` / `build:extension` failed with `Could not load icon 'icon/16.png' specified in 'icons'`, and after fixing that, a second failure: `Could not load @/assets/logo.png (imported by src/components/Header/index.tsx)`.

**Root cause:** commit `ea8b0d5` deleted every extension logo (`packages/extension/public/images/logo{,-full,16,48,128}.png`). Two consumers were left dangling:
- `wxt.config.ts` manifest declares `icons: { 16: "/icon/16.png", ... 128 }`, resolved from `publicDir: "src/public"` → expects `packages/extension/src/public/icon/{16,32,48,96,128}.png`. Those never existed at that path.
- `src/components/Header/index.tsx` line 13 `import logoUrl from "@/assets/logo.png"` (added in `375aeef`, a *bundled* asset not a public one) → expects `packages/extension/src/assets/logo.png`. Also never existed.

**Fix applied:** regenerated all six PNGs from `packages/web/public/logo.png` (662x662 RGBA product logo) with `sharp` (`fit: contain`, transparent bg, `kernel: lanczos3`). Icons at their five exact sizes under `src/public/icon/`; a single 128x128 `src/assets/logo.png` (Header renders it at `h-5 w-5`).

**.gitignore gotcha:** line 76 is a blanket `*.png`. The un-ignore beneath it was `!packages/extension/public/**/*.png` — wrong dir (that path doesn't exist anymore; nothing tracked there). Changed to `!packages/extension/src/**/*.png` (covers both `src/public/icon` and `src/assets`, future-proof). Until that line is right, `git status` won't show newly created extension PNGs even though they're on disk and the build uses them.

**sharp resolution under pnpm:** `sharp` is NOT hoisted to top-level `node_modules/` — a throwaway `require('sharp')` from a scratch script fails with MODULE_NOT_FOUND. Require it by full path: `node_modules/.pnpm/sharp@<ver>_<hash>/node_modules/sharp`.

**Verify:** `git check-ignore packages/extension/src/public/icon/16.png` exits 1 (not ignored); `git status -uall` lists all 5; build output `.output/chrome-mv3*/icon/` has 5 PNGs and `manifest.json` `icons` still maps all 5 sizes. The `Extension already has 4 registered commands ... WXT's reload command is disabled` line is an expected WARN (Chrome's 4-shortcut cap, see wxt.config.ts comments), not the failure.
