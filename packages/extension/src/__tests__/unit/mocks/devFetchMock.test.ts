/**
 * Regression test for the dev-mode AI mock: group-tabs must echo back real
 * submitted tab ids (not a hardcoded [1, 2]), or Auto-group silently matches
 * nothing against live Now Open tabs in dev mode.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installDevFetchMock } from '@/mocks/devFetchMock'

describe('installDevFetchMock — /api/ai/group-tabs', () => {
  let realFetch: typeof window.fetch

  beforeEach(() => {
    realFetch = window.fetch
    installDevFetchMock()
  })

  afterEach(() => {
    window.fetch = realFetch
  })

  it('echoes back real tab ids from the request body instead of a hardcoded fixture', async () => {
    const res = await window.fetch('https://example.com/api/ai/group-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: [{ id: 42, url: 'https://a.com' }, { id: 43, url: 'https://b.com' }] }),
    })
    const data = await res.json()

    expect(data.groups[0].tabIds).toEqual([42, 43])
  })

  it('returns no groups when no tabs are submitted', async () => {
    const res = await window.fetch('https://example.com/api/ai/group-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: [] }),
    })
    const data = await res.json()

    expect(data.groups).toEqual([])
  })
})
