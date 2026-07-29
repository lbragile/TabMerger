import fs from 'node:fs'
import path from 'node:path'

// ponytail: cache-bust via the file's own mtime instead of a bundler asset
// pipeline (Turbopack has no built-in loader for .mp4) — a re-rendered demo
// video on release changes mtime, which busts the cache with zero config.
const videoVersion = fs.statSync(
  path.join(process.cwd(), 'public/videos/tabmerger-demo.mp4')
).mtimeMs

export function DemoSection() {
  return (
    <video
      className="mx-auto md:mx-0 md:mr-auto rounded-xl shadow-2xl w-full md:w-[585px] max-w-full h-[350px] md:h-[450px] object-cover"
      src={`/videos/tabmerger-demo.mp4?v=${videoVersion}`}
      autoPlay
      loop
      muted
      playsInline
    />
  )
}
