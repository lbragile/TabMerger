import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEV_EXTENSION_ID as DEV_ID } from '@tabmerger/shared'

async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules()
  const originalEnv = { ...process.env }
  Object.assign(process.env, env)
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete (process.env as Record<string, string | undefined>)[key]
  }
  const mod = await import('@/lib/extensionId')
  process.env = originalEnv
  return mod
}

describe('EXTENSION_IDS', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('includes only the dev ID when nothing is configured and NODE_ENV is development', async () => {
    const { EXTENSION_IDS } = await loadWith({
      NODE_ENV: 'development',
      NEXT_PUBLIC_CHROME_EXTENSION_ID: undefined,
      NEXT_PUBLIC_EDGE_EXTENSION_ID: undefined,
    })
    expect(EXTENSION_IDS).toEqual([DEV_ID])
  })

  it('includes the dev ID outside of production too (e.g. NODE_ENV=test)', async () => {
    const { EXTENSION_IDS } = await loadWith({
      NODE_ENV: 'test',
      NEXT_PUBLIC_CHROME_EXTENSION_ID: undefined,
      NEXT_PUBLIC_EDGE_EXTENSION_ID: undefined,
    })
    expect(EXTENSION_IDS).toEqual([DEV_ID])
  })

  it('excludes the dev ID in production', async () => {
    const { EXTENSION_IDS } = await loadWith({
      NODE_ENV: 'production',
      NEXT_PUBLIC_CHROME_EXTENSION_ID: undefined,
      NEXT_PUBLIC_EDGE_EXTENSION_ID: undefined,
    })
    expect(EXTENSION_IDS).toEqual([])
  })

  it('orders Chrome before Edge, then dev, in development', async () => {
    const { EXTENSION_IDS } = await loadWith({
      NODE_ENV: 'development',
      NEXT_PUBLIC_CHROME_EXTENSION_ID: 'chrome-id',
      NEXT_PUBLIC_EDGE_EXTENSION_ID: 'edge-id',
    })
    expect(EXTENSION_IDS).toEqual(['chrome-id', 'edge-id', DEV_ID])
  })

  it('skips unset/empty values', async () => {
    const { EXTENSION_IDS } = await loadWith({
      NODE_ENV: 'production',
      NEXT_PUBLIC_CHROME_EXTENSION_ID: 'chrome-id',
      NEXT_PUBLIC_EDGE_EXTENSION_ID: '',
    })
    expect(EXTENSION_IDS).toEqual(['chrome-id'])
  })

  it('de-duplicates identical configured IDs', async () => {
    const { EXTENSION_IDS } = await loadWith({
      NODE_ENV: 'production',
      NEXT_PUBLIC_CHROME_EXTENSION_ID: 'same-id',
      NEXT_PUBLIC_EDGE_EXTENSION_ID: 'same-id',
    })
    expect(EXTENSION_IDS).toEqual(['same-id'])
  })
})
