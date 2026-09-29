import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const toasterProps = vi.fn()
vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => {
    toasterProps(props)
    return null
  },
}))
vi.mock('@/components/theme-provider', () => ({ useTheme: () => ({ theme: 'dark' }) }))

describe('AppToaster', () => {
  it("follows the app's theme and draws toasts with the app's tokens", async () => {
    const { AppToaster } = await import('@/components/AppToaster')
    render(<AppToaster />)

    const props = toasterProps.mock.lastCall![0] as { theme: string; closeButton: boolean; style: Record<string, string> }
    expect(props.theme).toBe('dark')
    expect(props.closeButton).toBe(true)
    // Same tokens as the in-page notices, not sonner's own palette and 8px corners.
    expect(props.style['--success-bg']).toBe('hsl(var(--ok-soft))')
    expect(props.style['--success-text']).toBe('hsl(var(--ok))')
    expect(props.style['--border-radius']).toBe('var(--radius)')
  })
})
