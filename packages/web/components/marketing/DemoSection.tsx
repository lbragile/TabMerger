import fs from 'node:fs'
import path from 'node:path'
import { DemoVideo } from './DemoVideo'

// ponytail: cache-bust via the file's own mtime instead of a bundler asset
// pipeline (Turbopack has no built-in loader for .mp4) — a re-rendered tour
// video on release changes mtime, which busts the cache with zero config.
// The posters are plain CSS backgrounds / `poster` values (not next/image, which
// rejects query strings on local images), so they take the same cache-buster.
function assetUrl(relPath: string): string | null {
  const full = path.join(process.cwd(), 'public', relPath)
  if (!fs.existsSync(full)) return null
  return `/${relPath}?v=${fs.statSync(full).mtimeMs}`
}

/** The hero's feature-tour video: one render and one first-frame poster per site theme. */
export function DemoSection() {
  return (
    <DemoVideo
      darkSrc={assetUrl('videos/tabmerger-tour-dark.mp4')}
      lightSrc={assetUrl('videos/tabmerger-tour-light.mp4')}
      darkPoster={assetUrl('videos/tour-poster-dark.jpg')}
      lightPoster={assetUrl('videos/tour-poster-light.jpg')}
    />
  )
}
