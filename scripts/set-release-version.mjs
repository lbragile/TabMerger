#!/usr/bin/env node
// Writes the just-computed semantic-release version into package.json files, on
// STABLE release branches only. Wired into .releaserc.json as an
// @semantic-release/exec `prepareCmd`, listed BEFORE @semantic-release/git so the
// bump lands inside the same release commit that plugin creates.
//
// This repo intentionally does NOT use @semantic-release/npm — `npm version` bumps
// the package.json version but also touches lockfile-adjacent state in a way that
// conflicts with pnpm's `workspace:*` protocol deps, so a small exec script does
// the one thing we actually need (write two JSON fields) instead.
//
// "Stable" is derived from .releaserc.json's `branches` config, never hard-coded:
// a `branches` entry that is a bare string (e.g. "agentic-revamp"), or an object
// entry with no `prerelease` key, is a stable release branch. Anything else
// (an object with `prerelease: true/"channel"`) is a prerelease branch — beta,
// currently — and this script must be a no-op there. package.json's version is
// otherwise meaningless: publish.yml already treats the git TAG, not package.json,
// as the sole source of truth for what a browser store build ships.
//
// Usage: node scripts/set-release-version.mjs <version> <branchName> [releasercPath]

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

/**
 * @param {unknown} branches `.releaserc.json`'s `branches` field.
 * @param {string} branchName The branch semantic-release is currently running on.
 * @returns {boolean} true if `branchName` is configured as a STABLE (non-prerelease) branch.
 */
export function isStableReleaseBranch(branches, branchName) {
  if (!Array.isArray(branches)) return false

  return branches.some((entry) => {
    if (typeof entry === 'string') return entry === branchName
    if (entry && typeof entry === 'object') {
      return entry.name === branchName && !entry.prerelease
    }
    return false
  })
}

/**
 * Rewrites only the top-level `"version"` field of a package.json file in place,
 * preserving 2-space indentation and a trailing newline — matching this repo's
 * existing package.json formatting (see the read of `package.json` at the top of
 * this file's own repo for the convention).
 *
 * @param {string} filePath Absolute path to a package.json file.
 * @param {string} version The new version string to write.
 */
export function writePackageVersion(filePath, version) {
  const raw = readFileSync(filePath, 'utf8')
  const pkg = JSON.parse(raw)
  pkg.version = version
  const hadTrailingNewline = raw.endsWith('\n')
  const next = JSON.stringify(pkg, null, 2) + (hadTrailingNewline ? '\n' : '')
  writeFileSync(filePath, next)
}

/**
 * @param {string} version
 * @param {string} branchName
 * @param {object} [options]
 * @param {string} [options.releasercPath] Defaults to the repo root's `.releaserc.json`.
 * @param {string} [options.rootPkgPath] Defaults to the repo root's `package.json`.
 * @param {string} [options.extensionPkgPath] Defaults to `packages/extension/package.json`.
 * @returns {{ wrote: boolean, reason?: string }}
 */
export function run(
  version,
  branchName,
  {
    releasercPath = join(REPO_ROOT, '.releaserc.json'),
    rootPkgPath = join(REPO_ROOT, 'package.json'),
    extensionPkgPath = join(REPO_ROOT, 'packages', 'extension', 'package.json'),
  } = {},
) {
  if (!version || !branchName) {
    throw new Error(
      'set-release-version: usage: node scripts/set-release-version.mjs <version> <branchName>',
    )
  }

  if (!existsSync(releasercPath)) {
    throw new Error(`set-release-version: no .releaserc.json found at ${releasercPath}`)
  }

  const releaserc = JSON.parse(readFileSync(releasercPath, 'utf8'))

  if (!isStableReleaseBranch(releaserc.branches, branchName)) {
    console.log(
      `set-release-version: "${branchName}" is not a stable release branch per .releaserc.json — no-op (package.json versions are only written on stable releases; tags remain the source of truth for prereleases).`,
    )
    return { wrote: false, reason: 'prerelease-branch' }
  }

  writePackageVersion(rootPkgPath, version)
  writePackageVersion(extensionPkgPath, version)

  console.log(
    `set-release-version: wrote version ${version} to package.json and packages/extension/package.json (stable branch "${branchName}").`,
  )
  return { wrote: true }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [, , version, branchName] = process.argv
  try {
    run(version, branchName)
  } catch (err) {
    console.error(`::error::${err.message}`)
    process.exit(1)
  }
}
