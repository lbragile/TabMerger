import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'))

// Every deployment is made by GitHub Actions (previews in ci.yml, production in the approval-gated
// deploy workflow), built with `vercel build --standalone`. Vercel's own Git integration cannot
// pass that flag: its build fails when it uploads pnpm's symlinked function bundles. It would
// also deploy main and beta the moment they are pushed, with no CI gate and no approval.
describe('vercel.json', () => {
  it('turns off the Git integration for every branch', () => {
    expect(config.git?.deploymentEnabled).toBe(false)
  })

  it('keeps the monorepo install command', () => {
    expect(config.installCommand).toContain('pnpm install --frozen-lockfile')
  })
})
