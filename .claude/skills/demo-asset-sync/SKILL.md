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

2. **Compress the tour videos + posters into the web app** (these are the only demo assets currently committed to git — see `packages/demo/.gitignore`, which excludes `screenshots/` and `promo/` as local-only working-tree output). The landing-page hero (`DemoSection.tsx`) plays `tabmerger-tour-{dark,light}.mp4` by site theme and shows `tour-poster-{dark,light}.jpg` (the video's first frame) until it loads. The renders are 1920x1080 at about 20 MB, so re-encode to 1280x720 (about 3.4 MB) rather than copying; this needs a full `ffmpeg` (`$TM_FFMPEG`, the same one `audio:tour` uses):
   ```bash
   for t in dark light; do
     "$TM_FFMPEG" -y -i packages/demo/out/tour/tabmerger-tour-$t.mp4 -vf scale=1280:-2 -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart packages/web/public/videos/tabmerger-tour-$t.mp4
     "$TM_FFMPEG" -y -i packages/demo/out/tour/tabmerger-tour-$t.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 4 packages/web/public/videos/tour-poster-$t.jpg
   done
   ```

   Then make the WebP renditions the hero's `<picture>` serves (1280px, and 640px for phones: about 10 to 22 KB against the JPEG's 55 KB). They must exist for both themes, or the landing page shows a broken poster (`__tests__/tour-poster-files.test.ts` checks this). Run from `packages/web`:
   ```bash
   node -e 'const s=require("sharp");(async()=>{for(const t of ["light","dark"]){const j="public/videos/tour-poster-"+t+".jpg";await s(j).webp({quality:72,effort:6}).toFile("public/videos/tour-poster-"+t+".webp");await s(j).resize(640).webp({quality:72,effort:6}).toFile("public/videos/tour-poster-"+t+"-640.webp")}})()'
   ```

3. **Screenshots/promo tiles stay local-only by design** (an explicit decision — see `.claude/agent-memory/demo/`) unless you're deliberately changing that: they live in `packages/demo/screenshots/store/*.jpg` and `packages/demo/promo/*.jpg`, git-ignored. `.github/workflows/publish.yml`'s release-asset step already globs these paths and will silently pick them up the moment they're committed — no workflow change needed if you later decide to ship them.

4. **Verify before committing**: `git status` for `packages/web/public/videos/` — confirm file sizes/timestamps actually changed, since a failed render can leave stale output in `packages/demo/out/` that looks present but isn't current.

5. Commit the updated video files with a message describing what changed in the demo (e.g. "fix(demo): correct dark theme rendering, re-record").
