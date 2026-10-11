import { describe, it, expect } from 'vitest'
import {
  GITHUB_REPO,
  GITHUB_REPO_URL,
  GITHUB_ISSUES_URL,
  GITHUB_DISCUSSIONS_URL,
  githubReleaseUrl,
  formatStarCount,
  githubRepoLabel,
} from '@/lib/github'

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

describe('formatStarCount', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [187, '187'],
    [1234, '1.2K'],
    [12_500, '12.5K'],
  ])('formats %i as %s', (count, text) => {
    expect(formatStarCount(count)).toBe(text)
  })
})

describe('githubRepoLabel', () => {
  it('states the exact count, plural', () => {
    expect(githubRepoLabel(187)).toBe('TabMerger on GitHub, 187 stars')
    expect(githubRepoLabel(0)).toBe('TabMerger on GitHub, 0 stars')
  })

  it('uses the singular for exactly one star', () => {
    expect(githubRepoLabel(1)).toBe('TabMerger on GitHub, 1 star')
  })

  it('writes the full number with a separator, not the compact form', () => {
    expect(githubRepoLabel(1234)).toBe('TabMerger on GitHub, 1,234 stars')
  })

  it('names only the destination when there is no count', () => {
    expect(githubRepoLabel(null)).toBe('TabMerger on GitHub')
    expect(githubRepoLabel(undefined)).toBe('TabMerger on GitHub')
    expect(githubRepoLabel()).toBe('TabMerger on GitHub')
  })
})
