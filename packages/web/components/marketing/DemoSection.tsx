import fs from 'node:fs'
import path from 'node:path'
import { DemoVideo } from './DemoVideo'

// ponytail: cache-bust via the file's own mtime instead of a bundler asset
// pipeline (Turbopack has no built-in loader for .mp4) — a re-rendered demo
// video on release changes mtime, which busts the cache with zero config.
function assetUrl(relPath: string): string | null {
  const full = path.join(process.cwd(), 'public', relPath)
  if (!fs.existsSync(full)) return null
  return `/${relPath}?v=${fs.statSync(full).mtimeMs}`
}

export function DemoSection() {
  const previewPath = path.join(process.cwd(), 'public/videos/demo-preview.jpg')

  return (
    <DemoVideo
      darkSrc={assetUrl('videos/tabmerger-demo-dark.mp4')}
      lightSrc={assetUrl('videos/tabmerger-demo-light.mp4')}
      // ponytail: no `?v=` cache-buster here — next/image rejects query strings
      // on local images (images.localPatterns) and static poster art changes
      // far less often than the video, so content-hash caching from next/image
      // is enough.
      previewSrc={fs.existsSync(previewPath) ? '/videos/demo-preview.jpg' : null}
    />
  )
}
