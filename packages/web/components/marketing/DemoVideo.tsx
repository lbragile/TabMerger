'use client'

import { Loader2 } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type SyntheticEvent,
} from 'react'
import { useTheme } from '@/components/theme-provider'

export const TOUR_VIDEO_LABEL = 'TabMerger feature tour video'
export const TOUR_POSTER_LABEL = 'TabMerger feature tour preview'
export const TOUR_LOADING_LABEL = 'Loading video'
export const TOUR_ERROR_LABEL = 'The video could not be loaded.'

// HTMLMediaElement.HAVE_FUTURE_DATA: enough data to keep playing from the current position.
const HAVE_FUTURE_DATA = 3

// The box is sized by `aspect-video` (16:9, the tour's own ratio) on a full-width block, so
// its height is known before the poster or any video byte arrives: no layout shift.
//
// The poster is this box's CSS background, chosen by the `.dark` class that the inline script
// in app/layout.tsx sets before first paint. The server can't know the visitor's theme (it
// lives in localStorage), so a `poster` attribute in the server HTML would always be the light
// one: a dark-theme visitor would download it and see it flash. A background picked by the
// class is right on the first paint, and the browser only fetches the one that applies.
const BOX_CLASS_NAME =
  'relative mx-auto w-full max-w-[45rem] aspect-video overflow-hidden rounded-xl shadow-2xl ' +
  'bg-muted bg-cover bg-center bg-(image:--tour-poster-light) dark:bg-(image:--tour-poster-dark)'

// What is behind the overlay is a video frame, not the page, so theme tokens say nothing
// about its contrast. The spinner therefore brings its own backdrop: a near-black disc with a
// light edge (visible on the darkest frame) holding a white spinner (visible on the disc
// whatever the frame is).
const OVERLAY_CLASS_NAME = 'pointer-events-none absolute inset-0 flex items-center justify-center p-4'
const BACKDROP_CLASS_NAME = 'bg-black/75 text-white shadow-lg ring-1 ring-white/50'

type LoadState = 'loading' | 'ready' | 'error'

interface DemoVideoProps {
  darkSrc: string | null
  lightSrc: string | null
  darkPoster: string | null
  lightPoster: string | null
}

const subscribeNever = () => () => {}

function cssUrl(url: string | null): string {
  return url ? `url("${url}")` : 'none'
}

export function DemoVideo({ darkSrc, lightSrc, darkPoster, lightPoster }: DemoVideoProps) {
  const { theme } = useTheme()
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastSrcRef = useRef<string | null>(null)
  // Position and play state to restore once a swapped-in source can seek. Kept in a ref so a
  // second theme toggle before the first swap has loaded still restores the original position
  // (the element's own currentTime is 0 while the new source is loading).
  const pendingRef = useRef<{ time: number; paused: boolean } | null>(null)
  // Starts as 'loading' so the server HTML already carries the indicator: the source is only
  // assigned after hydration, and the video cannot show anything until then.
  const [loadState, setLoadState] = useState<LoadState>('loading')

  // ThemeProvider resolves `theme` via useSyncExternalStore. While hydrating, that hook
  // first commits its server snapshot ('light') and effects run on that commit, before the
  // re-render with the visitor's real theme. `hydrated` goes through the same two steps, so
  // the effect below can skip the commit whose theme is not yet real: without that, a
  // dark-theme visitor's browser is handed the light video and poster first.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false)
  const src = theme === 'dark' ? darkSrc : lightSrc
  const poster = theme === 'dark' ? darkPoster : lightPoster

  // `src` is set here, not in the markup, for two reasons. The server HTML would name the
  // light video for everyone, so a dark-theme visitor would start downloading both. And a
  // theme toggle must not remount the element (`key={src}`), which resets currentTime to 0:
  // capture the playback position/paused state before swapping, then restore it once the new
  // source has loaded enough to seek. `muted`/`playbackRate`/`volume` don't need restoring —
  // they're DOM properties on the same (never-unmounted) element, untouched by a bare `src`
  // reassignment.
  useEffect(() => {
    const videoEl = videoRef.current
    if (!hydrated || !videoEl || !src || lastSrcRef.current === src) return

    if (poster) videoEl.poster = poster

    if (lastSrcRef.current === null) {
      // Browsers only autoplay a muted video. React does not reliably carry `muted` through
      // server rendering and hydration, so set the property (and the default the element
      // falls back to) here, before the source that triggers autoplay is assigned.
      videoEl.defaultMuted = true
      videoEl.muted = true
      videoEl.src = src
      lastSrcRef.current = src
      return
    }

    const pending = pendingRef.current ?? { time: videoEl.currentTime, paused: videoEl.paused }
    pendingRef.current = pending

    const handleLoaded = () => {
      pendingRef.current = null
      videoEl.currentTime = pending.time
      if (!pending.paused) videoEl.play().catch(() => {})
    }
    videoEl.addEventListener('loadedmetadata', handleLoaded, { once: true })
    // The `autoplay` attribute applies to every new source, so a video the visitor paused
    // would start again after the swap unless it is turned off for this load.
    videoEl.autoplay = !pending.paused
    videoEl.src = src
    lastSrcRef.current = src

    return () => videoEl.removeEventListener('loadedmetadata', handleLoaded)
  }, [hydrated, src, poster])

  if (!src && !poster) return null

  const posterVars = {
    '--tour-poster-light': cssUrl(lightPoster),
    '--tour-poster-dark': cssUrl(darkPoster),
  } as CSSProperties

  if (!src) {
    return <div role="img" aria-label={TOUR_POSTER_LABEL} className={BOX_CLASS_NAME} style={posterVars} />
  }

  const showLoading = () => setLoadState('loading')
  const showReady = () => setLoadState('ready')
  // `stalled` only says the download paused, which also happens while the browser already
  // holds plenty of data and playback carries on; no `playing` event follows in that case, so
  // an unconditional spinner would stay over a playing video.
  const handleStalled = (e: SyntheticEvent<HTMLVideoElement>) => {
    if (e.currentTarget.readyState < HAVE_FUTURE_DATA) showLoading()
  }
  // Safety net for the same reason: time moving forward with data in hand means it plays.
  const handleTimeUpdate = (e: SyntheticEvent<HTMLVideoElement>) => {
    const videoEl = e.currentTarget
    if (!videoEl.seeking && videoEl.readyState >= HAVE_FUTURE_DATA) showReady()
  }

  return (
    <div className={BOX_CLASS_NAME} style={posterVars}>
      <video
        ref={videoRef}
        aria-label={TOUR_VIDEO_LABEL}
        // Same ratio as the box, so `cover` only hides sub-pixel rounding, never content.
        className="absolute inset-0 h-full w-full object-cover"
        width={1280}
        height={720}
        autoPlay
        loop
        muted
        playsInline
        controls
        onLoadStart={showLoading}
        onWaiting={showLoading}
        onSeeking={showLoading}
        onStalled={handleStalled}
        onCanPlay={showReady}
        onPlaying={showReady}
        onSeeked={showReady}
        onTimeUpdate={handleTimeUpdate}
        onError={() => setLoadState('error')}
      />
      {/* Over the video but never in the way of its native controls (pointer-events-none),
          and absolutely positioned, so showing or hiding it moves nothing. The status region
          itself stays mounted: a live region has to exist before its text changes for the
          change to be announced. */}
      <div role="status" className={OVERLAY_CLASS_NAME}>
        {loadState === 'loading' && (
          // Fades in after a short delay so a quick seek or the loop restart does not flash it.
          <span
            data-testid="tour-video-spinner"
            className={`flex h-14 w-14 items-center justify-center rounded-full animate-in fade-in duration-200 delay-200 fill-mode-both ${BACKDROP_CLASS_NAME}`}
          >
            {/* Under prefers-reduced-motion the ring stays, without the spin. */}
            <Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span className="sr-only">{TOUR_LOADING_LABEL}</span>
          </span>
        )}
        {loadState === 'error' && (
          <span className={`rounded-md px-3 py-2 text-center text-sm ${BACKDROP_CLASS_NAME}`}>
            {TOUR_ERROR_LABEL}
          </span>
        )}
      </div>
    </div>
  )
}
