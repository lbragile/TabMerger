---
name: learnings-feature-tour-scene1
description: Feature tour scaffolding (drawn Chrome windows, scene registry, per-scene render) and the capture gotchas for the chaos tabs
metadata:
  type: project
---

- Tour lives in `remotion/tour/` (BrowserWindow, registry, TourVideo, scenes/). Every registry scene gets its own composition `TourScene-<id>-<theme>`, so `render-tour-scene.ts` is just a wrapper that names the output file and shells out to `pnpm exec remotion render|still`. Quote output paths there: `shell: true` re-splits on spaces (the repo path has one).
- Chaos tab URLs moved to `lib/chaosWindows.ts` (shared by `actions.ts` and Remotion). The module exposes `getChaosWindows()` as a function so `actions.ts` can import the URL lists even before `lib/chaosTabs.json` is populated.
- Headless capture limits: x.com returns an empty `<title>` and a blank page; Super User sits behind a Cloudflare bot wall that sometimes serves unstyled HTML (title flips between "Super User" and "Just a moment..."). Both are kept title-only (no screenshot) and never made the active tab. Capture retries/reloads until the title is real.
- Heredocs containing an apostrophe in a Bash tool call failed outright here (nothing written); use the Write tool for multi-file creation.
- `packages/demo` has no tsconfig/ESLint; to type-check, use a throwaway tsconfig in the scratchpad that maps `react` to the extension's `node_modules/@types`. Without that, every `key` prop errors.
- A scene's first frame is the empty desktop by design (windows arrive from frame 0); the cross-fade in `TourVideo` starts the scene TRANSITION_FRAMES early, so its local frame 0 is slightly before the cut.
