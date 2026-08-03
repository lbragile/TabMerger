---
name: demo-asset-sync
description: Copy freshly rendered demo videos/screenshots/promo tiles from packages/demo/ output dirs into packages/web/public/videos/ after a record+render pass. User-invoked only.
disable-model-invocation: true
---

# Demo asset sync

`packages/demo/`'s Remotion+Playwright pipeline renders into its own `out/`, `screenshots/store/`, and `promo/` directories — nothing copies that output into the web app automatically. Run this after any `record:*`/`render:*`/`screenshots`/`store-assets` pass whose output should ship on the marketing site.

1. **Verify fresh output exists** before copying — don't copy stale files from a previous run:
   ```bash
   ls -la packages/demo/out/ packages/demo/screenshots/store/ packages/demo/promo/
   ```

2. **Copy the demo videos + preview image** (these are the only demo assets currently committed to git — see `packages/demo/.gitignore`, which excludes `screenshots/` and `promo/` as local-only working-tree output):
   ```bash
   cp packages/demo/out/tabmerger-demo-dark.mp4 packages/web/public/videos/tabmerger-demo-dark.mp4
   cp packages/demo/out/tabmerger-demo-light.mp4 packages/web/public/videos/tabmerger-demo-light.mp4
   ```
   Update `packages/web/public/videos/demo-preview.jpg` too if a better static fallback was generated (`packages/demo/screenshots.ts` output) — only used when a themed video file is missing.

3. **Screenshots/promo tiles stay local-only by design** (an explicit decision — see `.claude/agent-memory/demo/`) unless you're deliberately changing that: they live in `packages/demo/screenshots/store/*.jpg` and `packages/demo/promo/*.jpg`, git-ignored. `.github/workflows/publish.yml`'s release-asset step already globs these paths and will silently pick them up the moment they're committed — no workflow change needed if you later decide to ship them.

4. **Verify before committing**: `git status` for `packages/web/public/videos/` — confirm file sizes/timestamps actually changed, since a failed render can leave stale output in `packages/demo/out/` that looks present but isn't current.

5. Commit the updated video files with a message describing what changed in the demo (e.g. "fix(demo): correct dark theme rendering, re-record").
