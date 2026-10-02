---
name: learnings-dragimage-canvas-vs-img
description: setDragImage(detached canvas) silently falls back to Chrome's native drag image (the grip snapshot) instead of hiding it; must be a preloaded decoded <img>. CDP screenshots structurally cannot detect this class of bug.
metadata:
  type: project
---

# `setDragImage()` needs a decoded `<img>`, not a detached `<canvas>` — and CDP can't see the difference

Supersedes the canvas-based `transparentDragImage()` in [[learnings-mv3-popup-native-html5-dnd]]
("1×1 canvas transparent drag image") — that approach shipped, was CDP-"verified"
across 8+ rounds, and was still wrong. Real fix: `packages/extension/src/lib/dndHtml5Sensor.ts`.

## The bug
User reported "a small grey dotted box" during every drag instead of the custom
ghost card. That box is Chrome's own **default native drag image** — a
same-frame snapshot of the `draggable` element itself. All three grips
(`Tab.tsx`/`Window.tsx`/`GroupItem.tsx`) are a bare `opacity-30` 12×12px
`GripVertical` icon — snapshot that and you get exactly "a small grey dotted
box."

## Why the canvas approach failed silently
For any `setDragImage()` argument that is NOT an `HTMLImageElement`, Blink
builds the drag image by **painting the argument's layout tree**. A detached
`<canvas>` (never appended to the document — the old code's explicit design,
on the theory that spec doesn't require attachment) has no layout object, so
there's nothing to paint, and Chrome **silently falls back** to its default
drag image. `setDragImage()` does not throw in this failure mode. A debug log
that only recorded `calledSetDragImage: true` looks perfectly healthy while
doing nothing — this is why it survived 8+ "fixed and verified" rounds.

`<img>` elements are the one type Blink special-cases: it takes the **decoded
bitmap** directly, bypassing the layout-paint path, so a detached `<img>`
still works for `setDragImage()` — but only once its image data has actually
decoded (`complete && naturalWidth > 0`).

## Why CDP verification cannot catch this class of bug at all
The native drag image is composited by the **OS/window manager**, not the
page's render surface. `Page.captureScreenshot` cannot capture it, ever, by
design — regardless of whether the fix is correct. Every prior round's
screenshot showed the custom ghost card rendering correctly and was
simultaneously and structurally incapable of revealing that Chrome was ALSO
drawing its own native drag image over/near it. **Do not treat a
screenshot-based DnD-visual check as proof that the native drag image is
absent** — it can only prove the custom ghost renders; it says nothing about
the native fallback.

## The fix
- Module-scope singleton `HTMLImageElement`, `src` = 1×1 transparent GIF data
  URI, created + `.decode()`-kicked-off at module load (popup boot) — same
  "create once, way ahead of any real drag" pattern as the old canvas.
- Belt-and-braces: also kept attached inside `#tm-dnd-aux-host` (a permanent
  `<body>` sibling of `#root`, never a grip ancestor) so it additionally has a
  layout object, covering both Blink code paths. Re-checks `isConnected` and
  re-appends on every use (cheap), not just once at creation — matters because
  in tests (and defensively, in case a real DOM reset ever happens) the aux
  host can get torn down and recreated between drags.
- Debug log upgraded from `{calledSetDragImage, hasImg, hasFn}` (proved
  nothing) to `{tagName, complete, naturalWidth, isConnected}` — the actual
  Blink preconditions for the decoded-bitmap fast path. `tagName === 'CANVAS'`
  or `complete === false` in a real browser (not jsdom) IS the signature of
  this bug class going forward.

## Test-layer gotchas
- **jsdom does not implement image decoding at all** for data: URIs by
  default: `HTMLImageElement.prototype.decode` is `undefined`, no `load`
  event ever fires, `complete` stays `false` and `naturalWidth` stays `0`
  forever, even after `await img.decode().catch()`. Confirmed by direct
  experiment. A unit test can only assert `tagName === 'IMG'` (not `CANVAS`)
  and `isConnected === true` — NOT `complete`/`naturalWidth`, unless you stub
  them with `Object.defineProperty` (shadowing the prototype getter with an
  own data property works fine, but only tests that the log-reading code
  works, not that real decoding happened).
- The **real popup CDP harness** (`e2e/repro/popupRealDnd.repro.ts`, RawCdp
  against the live toolbar-popup target — see
  [[learnings-mv3-popup-native-html5-dnd]]) DOES decode real data-URI images
  normally (it's real Chrome, not jsdom), so `complete: true, naturalWidth: 1`
  reads back correctly there within ~0ms of `dragstart` (image was decoded at
  popup boot, long before any drag). This is the strongest verification
  available — it proves the `setDragImage` argument is now valid — but even
  this **cannot prove the grey box is visually gone**, only that the
  precondition for it being gone is now met. State that limitation explicitly
  in any report; only the user's own eyes confirm the visual.
- Before trusting ANY verification against `.output/chrome-mv3-dev`: check
  `netstat -ano | grep 3001` for a stray `wxt` dev-server process. Hit this
  again in this exact round — a `node .../wxt/bin/wxt.mjs` process was still
  listening on 3001 from earlier in the session and would have silently
  overwritten the standalone dev build back to the HMR-relative one on its
  next watch cycle. Killed it, `rm -rf .output/chrome-mv3-dev`, fresh
  `build:dev`, verified `grep -c localhost popup.html` → 0 and the fix strings
  (`html5:dragimage`, the GIF base64 literal) present in the bundled chunk
  BEFORE running the repro suite against it.
