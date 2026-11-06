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
async function loadBetaPage(vercelEnv: string, deployEnv = '') {
  vi.stubEnv('VERCEL_ENV', vercelEnv)
  vi.stubEnv('DEPLOY_ENV', deployEnv)
  vi.resetModules()
  return import('@/app/[locale]/(marketing)/beta/page')
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
    ['DEPLOY_ENV=production alone', '', 'production'],
    ['DEPLOY_ENV=production over VERCEL_ENV=preview', 'preview', 'production'],
  ])('answers 404 for %s', async (_label, vercelEnv, deployEnv) => {
    const { default: BetaPage } = await loadBetaPage(vercelEnv, deployEnv)
    expect(() => BetaPage()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
  })

  it('renders the guide when DEPLOY_ENV=preview overrides VERCEL_ENV=production', async () => {
    const { default: BetaPage } = await loadBetaPage('production', 'preview')
    render(<BetaPage />)
    expect(notFound).not.toHaveBeenCalled()
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
    const metadata = await (await loadBetaPage('production')).generateMetadata()
    expect(metadata.title).toBeUndefined()
    expect(metadata.description).toBeUndefined()
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it.each(['preview', ''])('keeps its title and description when VERCEL_ENV is "%s"', async (vercelEnv) => {
    const metadata = await (await loadBetaPage(vercelEnv)).generateMetadata()
    expect(metadata.title).toBe('Beta Program')
    expect(metadata.description).toMatch(/join the tabmerger beta/i)
    expect(metadata.robots).toBeUndefined()
  })
})
