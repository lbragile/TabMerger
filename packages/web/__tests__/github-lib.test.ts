import { describe, it, expect } from 'vitest'
import {
  GITHUB_REPO,
  GITHUB_REPO_URL,
  GITHUB_ISSUES_URL,
  GITHUB_DISCUSSIONS_URL,
  githubReleaseUrl,
  githubPullRequestUrl,
} from '@/lib/github'

describe('githubPullRequestUrl', () => {
  it('builds the pull request URL from a PR number', () => {
    expect(githubPullRequestUrl(83)).toBe('https://github.com/lbragile/TabMerger/pull/83')
  })

  it.each([0, -1, 1.5, NaN, Infinity, 1e21])('returns undefined for %s', (n) => {
    expect(githubPullRequestUrl(n)).toBeUndefined()
  })
})

describe('GitHub URL constants', () => {
  it('derive every URL from the one repo slug', () => {
    expect(GITHUB_REPO).toBe('lbragile/TabMerger')
    expect(GITHUB_REPO_URL).toBe('https://github.com/lbragile/TabMerger')
    expect(GITHUB_ISSUES_URL).toBe('https://github.com/lbragile/TabMerger/issues')
    expect(GITHUB_DISCUSSIONS_URL).toBe('https://github.com/lbragile/TabMerger/discussions')
  })
})

describe('githubReleaseUrl', () => {
  it('builds the release tag URL from a v-prefixed version', () => {
    expect(githubReleaseUrl('v3.1.2')).toBe('https://github.com/lbragile/TabMerger/releases/tag/v3.1.2')
  })

  it('adds the v for a bare version', () => {
    expect(githubReleaseUrl('3.1.2')).toBe('https://github.com/lbragile/TabMerger/releases/tag/v3.1.2')
  })

  it('percent-encodes the tag', () => {
    expect(githubReleaseUrl('v1/../x y')).toBe(
      'https://github.com/lbragile/TabMerger/releases/tag/v1%2F..%2Fx%20y',
    )
  })
})

// The star count's format and the link's accessible name: __tests__/i18n-infrastructure.test.tsx.
