/**
 * scripts/generate-changelog.mjs: copies the repo-root CHANGELOG.md into the git-ignored
 * `generated/changelog.ts` module at build time, so /changelog reads no file at runtime.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHANGELOG_MODULE,
  CHANGELOG_SOURCE,
  generateChangelogModule,
  renderChangelogModule,
} from '@/scripts/generate-changelog.mjs'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-changelog-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Evaluates a generated module's source and returns its exported markdown. */
function exportedMarkdown(source: string): string {
  const js = source.replace('export const CHANGELOG_MARKDOWN: string =', 'return')
  return new Function(js)() as string
}

describe('renderChangelogModule', () => {
  it('exports the markdown unchanged, whatever characters it holds', () => {
    const markdown = '# [1.0.0](x) (2026-01-01)\r\n\n### Features\n\n* "quotes", `ticks`, ${braces}, \ and </script>\n'
    const source = renderChangelogModule(markdown)
    expect(source).toContain('export const CHANGELOG_MARKDOWN: string =')
    expect(source).not.toContain('</script>')
    expect(exportedMarkdown(source)).toBe(markdown)
  })
})

describe('generateChangelogModule', () => {
  it('writes the module from the changelog, creating the folder', () => {
    const source = path.join(dir, 'CHANGELOG.md')
    const out = path.join(dir, 'generated', 'changelog.ts')
    fs.writeFileSync(source, '# [1.0.0](x) (2026-01-01)\n')
    expect(generateChangelogModule({ source, out })).toBe(true)
    expect(exportedMarkdown(fs.readFileSync(out, 'utf8'))).toBe('# [1.0.0](x) (2026-01-01)\n')
  })

  it('leaves an up-to-date module alone (no rewrite for next dev to recompile)', () => {
    const source = path.join(dir, 'CHANGELOG.md')
    const out = path.join(dir, 'changelog.ts')
    fs.writeFileSync(source, 'v1')
    expect(generateChangelogModule({ source, out })).toBe(true)
    expect(generateChangelogModule({ source, out })).toBe(false)
    fs.writeFileSync(source, 'v2')
    expect(generateChangelogModule({ source, out })).toBe(true)
    expect(exportedMarkdown(fs.readFileSync(out, 'utf8'))).toBe('v2')
  })

  it('fails loudly when CHANGELOG.md is missing, and writes nothing', () => {
    const out = path.join(dir, 'changelog.ts')
    expect(() => generateChangelogModule({ source: path.join(dir, 'missing.md'), out })).toThrow(/cannot read .*missing\.md/)
    expect(fs.existsSync(out)).toBe(false)
  })

  it('defaults to the repo-root CHANGELOG.md and packages/web/generated/changelog.ts', () => {
    expect(path.relative(path.resolve(__dirname, '..', '..', '..'), CHANGELOG_SOURCE)).toBe('CHANGELOG.md')
    expect(path.relative(path.resolve(__dirname, '..'), CHANGELOG_MODULE)).toBe(path.join('generated', 'changelog.ts'))
  })
})
