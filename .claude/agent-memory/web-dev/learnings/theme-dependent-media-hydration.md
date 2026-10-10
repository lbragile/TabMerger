---
name: theme-dependent-media-hydration
description: Theme-dependent posters/videos with the hand-rolled ThemeProvider — the hydration commit runs effects with the server theme ('light'), class-driven CSS poster, video autoplay/paused/muted rules on src swap, spinner event rules
metadata:
  type: reference
---

Hero tour video (`components/marketing/DemoVideo.tsx`, fed by `DemoSection.tsx`).

**Effects run once with the server theme while hydrating.** `useTheme()` is backed by
`useSyncExternalStore`; during hydration React commits the server snapshot (`'light'`), runs
effects on that commit, and only then re-renders with the real theme. Anything an effect does
with `theme` on that first commit happens for the wrong theme: a dark-theme visitor was handed
the light video `src`, and `ThemeProvider`'s own effect stripped the `dark` class for an instant,
which was enough for the browser to fetch the light-only CSS background image.
Fix pattern, used in both files: `const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false)`
and `if (!hydrated) return` at the top of the effect. It flips in the same re-render as the theme.
How to see it: log requests in Playwright with `localStorage.theme = 'dark'` seeded by
`addInitScript`; the light asset shows up in the request list without any toggle.

**Poster that is right on first paint.** The server cannot know the theme, so a `poster`
attribute in server HTML is always the light one. Put both poster URLs in CSS custom properties
on the wrapper (`style`), and pick with `bg-(image:--x) dark:bg-(image:--y)`: the inline script
in `app/layout.tsx` sets `.dark` before paint, and a `url()` inside a custom property is only
fetched when it is actually used. These URLs can carry the `?v=mtime` cache-buster (it is
`next/image` that rejects query strings on local images, not CSS).

**Swapping `src` on a live `<video>`.**
- The `autoplay` attribute applies to every new source: a video the visitor paused starts again
  after the swap unless `videoEl.autoplay = false` is set before assigning `src`.
- `muted`, `volume`, `playbackRate` survive a bare `src` reassignment; `currentTime` does not
  (restore it on `loadedmetadata`).
- A second swap before the first has loaded reads `currentTime === 0`; keep the position to
  restore in a ref until a `loadedmetadata` actually consumes it.
- Set `defaultMuted`/`muted` imperatively before the first `src` so muted autoplay never depends
  on how React serialises `muted`.

**Buffering indicator from media events.** Show on `loadstart`/`waiting`/`seeking`, hide on
`canplay`/`playing`/`seeked`. `stalled` also fires while playback continues from the buffer and
no `playing` follows, so only show on it when `readyState < 3`, and hide on `timeupdate` when
`readyState >= 3 && !seeking` as a safety net. `loadstart` gives the "new source" signal without
a setState inside the effect. Delay the fade-in (~200ms) or the loop restart flashes it.
The backdrop must not rely on theme tokens: a video frame is behind it, not the page.

**Checking it headlessly.** Delay the video with `page.route('**/videos/*.mp4*', ...)` (sleep,
then `route.continue()`); `route.abort()` gives the error state. Unmuting from script pauses an
autoplaying video unless the page has had a real click first.

**Dev server port.** A Remotion render (`packages/demo`) serves its bundle on port 3000 while it
runs; a 200 from `localhost:3000` is not proof the web app is there. Check the page content, and
start `next dev -p <other>` if needed.
