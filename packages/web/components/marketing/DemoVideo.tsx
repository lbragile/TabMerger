'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/components/theme-provider'

const CLASS_NAME =
  'mx-auto md:mx-0 md:mr-auto rounded-xl shadow-2xl w-full md:w-[585px] max-w-full aspect-[4/3] object-contain bg-black'

interface DemoVideoProps {
  darkSrc: string | null
  lightSrc: string | null
  previewSrc: string | null
}

export function DemoVideo({ darkSrc, lightSrc, previewSrc }: DemoVideoProps) {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastSrcRef = useRef<string | null>(null)

  useEffect(() => setMounted(true), [])

  // ponytail: before hydration we don't know the resolved theme yet — default
  // to ThemeProvider's initial 'light' state so the src doesn't flash/swap.
  const resolvedTheme = mounted ? theme : 'light'
  const src = resolvedTheme === 'dark' ? darkSrc : lightSrc

  // Swap `src` imperatively instead of `key={src}` remounting the element —
  // a remount resets currentTime to 0 on every theme toggle. Capture the
  // in-flight playback position/paused state before swapping, then restore
  // it once the new source has loaded enough to seek. `muted`/`playbackRate`
  // don't need restoring — they're DOM properties on the same (never-
  // unmounted) element, untouched by a bare `src` reassignment.
  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl || !src || lastSrcRef.current === src) return

    if (lastSrcRef.current === null) {
      videoEl.src = src
      lastSrcRef.current = src
      return
    }

    const resumeTime = videoEl.currentTime
    const wasPaused = videoEl.paused

    const handleLoaded = () => {
      videoEl.currentTime = resumeTime
      if (!wasPaused) videoEl.play().catch(() => {})
      videoEl.removeEventListener('loadedmetadata', handleLoaded)
    }
    videoEl.addEventListener('loadedmetadata', handleLoaded)
    videoEl.src = src
    lastSrcRef.current = src
  }, [src])

  if (!src) {
    if (!previewSrc) return null
    return (
      <Image
        src={previewSrc}
        alt="TabMerger demo preview"
        width={585}
        height={450}
        className={CLASS_NAME}
      />
    )
  }

  return (
    <video
      ref={videoRef}
      className={CLASS_NAME}
      autoPlay
      loop
      muted
      playsInline
      controls
    />
  )
}
