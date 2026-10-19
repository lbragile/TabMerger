/**
 * Vercel Web Analytics and Speed Insights must never report a share link's `#key=…` fragment.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

type Hook = (event: { type?: string; url: string }) => { url: string } | null
const hooks: Record<string, Hook> = {}

vi.mock('@vercel/analytics/next', () => ({
  Analytics: ({ beforeSend }: { beforeSend: Hook }) => {
    hooks.analytics = beforeSend
    return null
  },
}))
vi.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: ({ beforeSend }: { beforeSend: Hook }) => {
    hooks.speed = beforeSend
    return null
  },
}))

import { VercelInsights, vercelBeforeSend } from '@/components/VercelInsights'

const KEYED = 'https://tabmerger.com/share/abc#key=secret'

describe('VercelInsights', () => {
  it('passes a fragment-stripping beforeSend to both Analytics and Speed Insights', () => {
    render(<VercelInsights />)
    expect(hooks.analytics({ type: 'pageview', url: KEYED })).toEqual({ type: 'pageview', url: 'https://tabmerger.com/share/abc' })
    expect(hooks.speed({ type: 'vital', url: KEYED })?.url).toBe('https://tabmerger.com/share/abc')
  })

  it('leaves URLs without a fragment unchanged', () => {
    expect(vercelBeforeSend({ url: 'https://tabmerger.com/pricing?x=1' }).url).toBe('https://tabmerger.com/pricing?x=1')
  })
})
