---
name: learnings-tour-rebuild-2026-11-08
description: Re-recording the tour on a new popup build - demo build env rejects http localhost, shared .pw-user-data collisions, search pick no longer clears the query
metadata:
  type: project
---

- `wxt build -m demo` now throws if `VITE_EXTRA_WEB_APP_URLS` (set to `http://localhost:3000` in `.env.local`) is not https; only `--mode development` allows localhost http. Build with a shell override: `VITE_EXTRA_WEB_APP_URLS=https://example.com pnpm build:extension:demo` (an empty value is ignored, it falls back to the file). Supabase URL and the AI flag still come from `.env.local`.
- `launchDemoContext` wipes and uses the shared `packages/demo/.pw-user-data` by default. Two concurrent recorders collide (a launch hangs 180 s then times out). Always set `TM_DEMO_USER_DATA_DIR` to a private directory when more than one agent records.
- Picking a search result no longer clears the query (Header/index.tsx: "Picking a result never clears the query"). After the pick the sidebar stays filtered ("Now Open 0 found, Work 2 found") and the header shows the picked group's counts, which looks like Q4 Launch vanished. Any recorder or replay that searches must click the header's "Clear search" button afterwards. A tab pick also calls `revealTab`.
- A popup restyle (Auto-saved section, footer counts) did not move the scene 2 card rects; `tourPopupLayout.json` cards stayed identical, only `startMs` changed. Scene 3 grew from 321 to 352 frames because the drag/rename footage got longer (407 dark / 425 light capture frames).
