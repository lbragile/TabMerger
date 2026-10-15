import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The hero's <picture> points at WebP renditions that are made from the JPEG poster by hand
// (see the demo-asset-sync skill). A missing one is a broken image on the landing page, and
// the browser does not fall back to the JPEG when a <source> it chose answers 404.
describe('tour poster files', () => {
  for (const theme of ['light', 'dark']) {
    for (const name of [`tour-poster-${theme}.jpg`, `tour-poster-${theme}.webp`, `tour-poster-${theme}-640.webp`]) {
      it(`${name} exists`, () => {
        expect(fs.existsSync(path.join(process.cwd(), 'public', 'videos', name))).toBe(true)
      })
    }
  }
})
