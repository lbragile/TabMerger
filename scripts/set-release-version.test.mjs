// Run with: node --test scripts/set-release-version.test.mjs
// Plain node:test — this script has no bundler/vitest context of its own (it runs
// standalone, before `pnpm install` even matters, as a semantic-release exec hook),
// so it deliberately doesn't pull in the extension/web vitest setups.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isStableReleaseBranch, writePackageVersion, run } from './set-release-version.mjs'

test('isStableReleaseBranch: bare string branch entry matches by name', () => {
  assert.equal(isStableReleaseBranch(['agentic-revamp'], 'agentic-revamp'), true)
  assert.equal(isStableReleaseBranch(['agentic-revamp'], 'beta'), false)
})

test('isStableReleaseBranch: object entry without `prerelease` is stable', () => {
  assert.equal(isStableReleaseBranch([{ name: 'main' }], 'main'), true)
})

test('isStableReleaseBranch: object entry with `prerelease` is NOT stable', () => {
  assert.equal(isStableReleaseBranch([{ name: 'beta', prerelease: true }], 'beta'), false)
  assert.equal(
    isStableReleaseBranch([{ name: 'beta', prerelease: 'beta' }], 'beta'),
    false,
  )
})

test('isStableReleaseBranch: unknown branch name is not stable', () => {
  assert.equal(
    isStableReleaseBranch(['agentic-revamp', { name: 'beta', prerelease: true }], 'some-other-branch'),
    false,
  )
})

test('isStableReleaseBranch: non-array branches is not stable', () => {
  assert.equal(isStableReleaseBranch(undefined, 'agentic-revamp'), false)
  assert.equal(isStableReleaseBranch(null, 'agentic-revamp'), false)
})

test('writePackageVersion: rewrites only the version field, preserving 2-space indent + trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'set-release-version-'))
  const pkgPath = join(dir, 'package.json')
  writeFileSync(pkgPath, '{\n  "name": "demo",\n  "version": "1.0.0",\n  "private": true\n}\n')

  writePackageVersion(pkgPath, '1.2.3')

  const after = readFileSync(pkgPath, 'utf8')
  assert.equal(
    after,
    '{\n  "name": "demo",\n  "version": "1.2.3",\n  "private": true\n}\n',
  )

  rmSync(dir, { recursive: true, force: true })
})

test('writePackageVersion: no trailing newline in source is preserved (no newline added)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'set-release-version-'))
  const pkgPath = join(dir, 'package.json')
  writeFileSync(pkgPath, '{\n  "name": "demo",\n  "version": "1.0.0"\n}')

  writePackageVersion(pkgPath, '2.0.0')

  const after = readFileSync(pkgPath, 'utf8')
  assert.equal(after.endsWith('\n'), false)
  assert.match(after, /"version": "2\.0\.0"/)
})

function setupFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'set-release-version-repo-'))
  mkdirSync(join(dir, 'packages', 'extension'), { recursive: true })

  const releasercPath = join(dir, 'releaserc.json')
  const rootPkgPath = join(dir, 'package.json')
  const extensionPkgPath = join(dir, 'packages', 'extension', 'package.json')

  writeFileSync(rootPkgPath, '{\n  "name": "root",\n  "version": "3.0.0"\n}\n')
  writeFileSync(
    extensionPkgPath,
    '{\n  "name": "@tabmerger/extension",\n  "version": "3.0.0"\n}\n',
  )
  writeFileSync(
    releasercPath,
    JSON.stringify(
      {
        branches: ['agentic-revamp', { name: 'beta', prerelease: true }],
      },
      null,
      2,
    ) + '\n',
  )
  return { dir, releasercPath, rootPkgPath, extensionPkgPath }
}

test('run: throws on missing args', () => {
  assert.throws(() => run(undefined, 'agentic-revamp'), /usage:/)
  assert.throws(() => run('1.0.0', undefined), /usage:/)
})

test('run: throws when the releaserc file does not exist', () => {
  assert.throws(
    () =>
      run('1.0.0', 'agentic-revamp', {
        releasercPath: join(tmpdir(), 'does-not-exist-releaserc.json'),
      }),
    /no \.releaserc\.json found/,
  )
})

test('run: beta (prerelease) branch is a no-op — package.json files untouched', () => {
  const { dir, releasercPath, rootPkgPath, extensionPkgPath } = setupFixtureRepo()

  const result = run('3.1.0-beta.1', 'beta', { releasercPath, rootPkgPath, extensionPkgPath })

  assert.deepEqual(result, { wrote: false, reason: 'prerelease-branch' })
  assert.match(readFileSync(rootPkgPath, 'utf8'), /"version": "3\.0\.0"/)
  assert.match(readFileSync(extensionPkgPath, 'utf8'), /"version": "3\.0\.0"/)
  rmSync(dir, { recursive: true, force: true })
})

test('run: stable branch writes the version into both root and extension package.json', () => {
  const { dir, releasercPath, rootPkgPath, extensionPkgPath } = setupFixtureRepo()

  const result = run('3.1.0', 'agentic-revamp', { releasercPath, rootPkgPath, extensionPkgPath })

  assert.deepEqual(result, { wrote: true })
  assert.match(readFileSync(rootPkgPath, 'utf8'), /"version": "3\.1\.0"/)
  assert.match(readFileSync(extensionPkgPath, 'utf8'), /"version": "3\.1\.0"/)
  rmSync(dir, { recursive: true, force: true })
})

test('run: unrecognized branch name (not in .releaserc.json at all) is also a no-op', () => {
  const { dir, releasercPath, rootPkgPath, extensionPkgPath } = setupFixtureRepo()

  const result = run('9.9.9', 'some-random-branch', {
    releasercPath,
    rootPkgPath,
    extensionPkgPath,
  })

  assert.deepEqual(result, { wrote: false, reason: 'prerelease-branch' })
  rmSync(dir, { recursive: true, force: true })
})
