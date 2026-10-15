import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTourSearchShowsDemo } from '@/hooks/useTourSearchShowsDemo'
import { setTourSearchShowsDemo } from '@/lib/tourSandbox'

afterEach(() => setTourSearchShowsDemo(false))

describe('useTourSearchShowsDemo', () => {
  it('is false by default', () => {
    expect(renderHook(() => useTourSearchShowsDemo()).result.current).toBe(false)
  })

  it('re-renders with the new value when the tour enters and leaves a search step', () => {
    const { result } = renderHook(() => useTourSearchShowsDemo())
    act(() => setTourSearchShowsDemo(true))
    expect(result.current).toBe(true)
    act(() => setTourSearchShowsDemo(false))
    expect(result.current).toBe(false)
  })
})

describe('useTourSearchShowsDemo subscription and server snapshot', () => {
  it('unsubscribes on unmount so later changes reach no listener', () => {
    const { unmount, result } = renderHook(() => useTourSearchShowsDemo())
    unmount()
    act(() => setTourSearchShowsDemo(true))
    expect(result.current).toBe(false)
  })

  it('renders false on the server whatever the store holds', async () => {
    const { renderToString } = await import('react-dom/server')
    const React = await import('react')
    setTourSearchShowsDemo(true)
    function Probe() {
      return React.createElement('span', null, String(useTourSearchShowsDemo()))
    }
    expect(renderToString(React.createElement(Probe))).toContain('false')
  })
})
