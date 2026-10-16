import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { WEB_APP_ACCESS_PAGE_PATH } from '@/lib/webAppHostAccess'

/**
 * The site-access page (`entrypoints/site-access/index.html`) must be in the Firefox build only:
 * WXT reads `<meta name="manifest.include">` from an HTML entrypoint and skips the entrypoint for
 * every browser not listed. A pure file check; the build itself is not run here.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(testDir, '../../../../')
const html = readFileSync(path.join(extensionRoot, 'src', 'entrypoints', 'site-access', 'index.html'), 'utf-8')

describe('site-access entrypoint', () => {
  it('is included in the Firefox build only', () => {
    const meta = html.match(/<meta\s+name="manifest\.include"\s+content="([^"]*)"\s*\/?>/)
    expect(meta, 'manifest.include meta tag').not.toBeNull()
    // WXT parses the content with JSON5; single quotes are valid there.
    expect(meta![1].replace(/'/g, '"')).toBe('["firefox"]')
    expect(html).not.toMatch(/manifest\.exclude/)
  })

  it('builds to the path the popup banner opens', () => {
    // WXT names an unlisted page `<dir>.html` after its `entrypoints/<dir>/index.html` folder.
    expect(WEB_APP_ACCESS_PAGE_PATH).toBe('/site-access.html')
  })

  it('applies the saved theme like the popup and lets the page scroll', () => {
    expect(html).toContain('<script src="/theme-init.js"></script>')
    expect(html).toMatch(/overflow:\s*auto/)
  })
})
