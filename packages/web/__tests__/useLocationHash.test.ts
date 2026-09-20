import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { useLocationHash } from '@/lib/hooks/useLocationHash'

function setHash(hash: string) {
  window.location.hash = hash
}

describe('useLocationHash', () => {
  afterEach(() => {
    setHash('')
  })

  it('returns the current location hash on initial render', () => {
    setHash('#key=abc123')
    const { result } = renderHook(() => useLocationHash())
    expect(result.current).toBe('#key=abc123')
  })

  it('returns an empty string when there is no hash', () => {
    const { result } = renderHook(() => useLocationHash())
    expect(result.current).toBe('')
  })

  it('updates when the hash changes via a hashchange event', () => {
    const { result } = renderHook(() => useLocationHash())
    expect(result.current).toBe('')

    act(() => {
      setHash('#key=new-value')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(result.current).toBe('#key=new-value')
  })
})
