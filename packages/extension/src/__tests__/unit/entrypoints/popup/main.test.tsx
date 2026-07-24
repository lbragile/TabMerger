import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/entrypoints/popup/App', () => ({ App: () => null }))

const mockInit = vi.fn()
vi.mock('@sentry/browser', () => ({ init: (...args: unknown[]) => mockInit(...args) }))

describe('popup main entrypoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('renders the App into #root without initializing Sentry when DSN is unset', async () => {
    await import('@/entrypoints/popup/main')
    expect(mockInit).not.toHaveBeenCalled()
    expect(document.getElementById('root')).not.toBeNull()
  })

  it('initializes Sentry and redacts PII when a DSN is configured', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example.ingest.sentry.io/1')
    await import('@/entrypoints/popup/main')
    expect(mockInit).toHaveBeenCalled()

    const opts = mockInit.mock.calls[0][0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>
    }

    const eventWithRequest = opts.beforeSend({ request: { url: 'https://secret.com/tab' } })
    expect((eventWithRequest.request as { url: string }).url).toBe('[redacted]')

    const eventWithBreadcrumbs = opts.beforeSend({
      breadcrumbs: [{ data: { url: 'https://secret.com', from: 'a', to: 'b' } }],
    })
    const bc = (eventWithBreadcrumbs.breadcrumbs as Array<{ data: Record<string, string> }>)[0]
    expect(bc.data.url).toBe('[redacted]')

    const eventWithNothing = opts.beforeSend({})
    expect(eventWithNothing).toEqual({})
  })
})
