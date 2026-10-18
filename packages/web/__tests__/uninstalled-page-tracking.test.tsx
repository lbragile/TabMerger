/**
 * /uninstalled page: mounts the uninstall tracker only when the URL allows analytics, and passes
 * it parsed values only, never the raw query.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import UninstalledPage from '@/app/[locale]/(marketing)/uninstalled/page'

const recordUninstall = vi.hoisted(() => vi.fn())
vi.mock('@/app/[locale]/(marketing)/uninstalled/actions', () => ({ recordUninstall }))

type Query = Record<string, string | string[] | undefined>

async function renderPage(query: Query) {
  render(await UninstalledPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  recordUninstall.mockReset()
  recordUninstall.mockResolvedValue(undefined)
  sessionStorage.clear()
})

describe('/uninstalled page uninstall tracking', () => {
  it('records once with the parsed values when the URL allows analytics', async () => {
    await renderPage({ v: '3.3.3', b: 'firefox', c: 'beta', a: '1' })
    expect(recordUninstall).toHaveBeenCalledTimes(1)
    expect(recordUninstall).toHaveBeenCalledWith({ version: '3.3.3', browser: 'firefox', channel: 'beta', analytics: '1' })
  })

  it('records a Chrome uninstall from an older build that sent no flag', async () => {
    await renderPage({ v: '3.3.3', b: 'chrome', c: 'stable' })
    expect(recordUninstall).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a=0', { v: '3.3.3', b: 'chrome', a: '0' }],
    ['Firefox without a flag', { v: '3.3.3', b: 'firefox' }],
    ['no browser', { v: '3.3.3' }],
  ])('does not record for %s', async (_label, query) => {
    await renderPage(query)
    expect(recordUninstall).not.toHaveBeenCalled()
  })

  it('never passes unchecked values through', async () => {
    await renderPage({ v: '<b>x</b>', b: 'chrome', c: 'nightly', a: '1', extra: 'leak' })
    expect(recordUninstall).toHaveBeenCalledWith({ version: undefined, browser: 'chrome', channel: undefined, analytics: '1' })
  })
})
