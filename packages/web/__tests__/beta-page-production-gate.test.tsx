import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { notFound } = vi.hoisted(() => ({
  // The real notFound() throws to stop rendering; mirror that so a gated page cannot render on.
  notFound: vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404')
  }),
}))

vi.mock('next/navigation', () => ({ notFound }))

/** Loads the page fresh so its module-scope metadata is evaluated under the stubbed env. */
async function loadBetaPage(vercelEnv: string) {
  vi.stubEnv('VERCEL_ENV', vercelEnv)
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', vercelEnv)
  vi.resetModules()
  return import('@/app/(marketing)/beta/page')
}

describe('BetaPage production gate', () => {
  beforeEach(() => {
    notFound.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('answers 404 on the production deployment', async () => {
    const { default: BetaPage } = await loadBetaPage('production')
    expect(() => BetaPage()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the preview deployment', 'preview'],
    ['local development (no Vercel environment)', ''],
  ])('renders the guide on %s', async (_label, vercelEnv) => {
    const { default: BetaPage } = await loadBetaPage(vercelEnv)
    render(<BetaPage />)
    expect(screen.getByRole('heading', { name: /help us test tabmerger/i })).toBeInTheDocument()
    expect(notFound).not.toHaveBeenCalled()
  })

  it('is rendered per request, so the gate reads the running deployment, not the build machine', async () => {
    const mod = await loadBetaPage('preview')
    expect(mod.dynamic).toBe('force-dynamic')
  })

  it('advertises nothing and asks not to be indexed on production', async () => {
    const { metadata } = await loadBetaPage('production')
    expect(metadata.title).toBeUndefined()
    expect(metadata.description).toBeUndefined()
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it.each(['preview', ''])('keeps its title and description when VERCEL_ENV is "%s"', async (vercelEnv) => {
    const { metadata } = await loadBetaPage(vercelEnv)
    expect(metadata.title).toBe('Beta Program')
    expect(metadata.description).toMatch(/join the tabmerger beta/i)
    expect(metadata.robots).toBeUndefined()
  })
})
