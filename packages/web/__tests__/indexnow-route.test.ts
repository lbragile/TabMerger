import { describe, expect, it } from 'vitest'
import { GET } from '@/app/indexnow.txt/route'
import { INDEXNOW_KEY, INDEXNOW_KEY_PATH } from '@/lib/indexNow'
import { isLocalizedPath } from '@/proxy'

describe('IndexNow key file', () => {
  it('serves exactly the key, as plain text', async () => {
    const res = GET()
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await res.text()).toBe(INDEXNOW_KEY)
  })

  it('uses a key in the IndexNow format (8-128 of a-z, A-Z, 0-9, dash)', () => {
    expect(INDEXNOW_KEY).toMatch(/^[a-zA-Z0-9-]{8,128}$/)
  })

  it('sits at the site root, outside the locale handler, so it covers every URL on the host', () => {
    expect(INDEXNOW_KEY_PATH).toBe('/indexnow.txt')
    expect(isLocalizedPath(INDEXNOW_KEY_PATH)).toBe(false)
  })
})
