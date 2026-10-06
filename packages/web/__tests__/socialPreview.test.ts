import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'x' }),
  Geist_Mono: () => ({ variable: 'y' }),
}))
vi.mock('@next/third-parties/google', () => ({ GoogleAnalytics: () => null }))
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => null }))
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }))

const appDir = join(__dirname, '..', 'app')

describe('social preview image', () => {
  it('root metadata sets an absolute metadataBase', async () => {
    const { metadata } = await import('@/app/layout')
    expect(metadata.metadataBase).toBeInstanceOf(URL)
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' })
  })

  it.each(['opengraph-image', 'twitter-image'])('%s file convention assets exist', (name) => {
    expect(existsSync(join(appDir, `${name}.png`))).toBe(true)
    expect(existsSync(join(appDir, `${name}.alt.txt`))).toBe(true)
  })

  it('beta page does not override openGraph/twitter, so it inherits the image', async () => {
    const mod = await import('@/app/(marketing)/beta/page')
    expect(mod.metadata.openGraph).toBeUndefined()
    expect(mod.metadata.twitter).toBeUndefined()
  })
})
