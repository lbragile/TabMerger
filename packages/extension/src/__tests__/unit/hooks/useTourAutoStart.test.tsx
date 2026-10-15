import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn().mockResolvedValue(0),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

import { useTourAutoStart } from '@/hooks/useTourAutoStart'
import { useUIStore } from '@/stores/uiStore'
import { TOUR_STORAGE_KEY } from '@/lib/tour'

const put = (record: unknown) => chrome.storage.local.set({ [TOUR_STORAGE_KEY]: record })
const settle = () => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  mockTrackEvent.mockClear()
  useUIStore.setState({ tourActive: false, tourStepId: null, modal: { type: null } })
})
afterEach(() => vi.unstubAllEnvs())

describe('useTourAutoStart', () => {
  it('starts the tour at step 1 for a pending record and counts it once', async () => {
    await put({ status: 'pending' })
    renderHook(() => useTourAutoStart())
    await waitFor(() => expect(useUIStore.getState().tourActive).toBe(true))
    expect(useUIStore.getState().tourStepId).toBeNull()
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_started', { source: 'auto' })
  })

  it('resumes at the stored step without firing tour_started again', async () => {
    await put({ status: 'pending', stepId: 'groups' })
    renderHook(() => useTourAutoStart())
    await waitFor(() => expect(useUIStore.getState().tourActive).toBe(true))
    expect(useUIStore.getState().tourStepId).toBe('groups')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('does not start when the tour is done', async () => {
    await put({ status: 'done' })
    renderHook(() => useTourAutoStart())
    await settle()
    expect(useUIStore.getState().tourActive).toBe(false)
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('does not start when there is no record (existing user after an update)', async () => {
    renderHook(() => useTourAutoStart())
    await settle()
    expect(useUIStore.getState().tourActive).toBe(false)
  })

  it('does not start from a corrupt record', async () => {
    await put({ status: 'maybe' })
    renderHook(() => useTourAutoStart())
    await settle()
    expect(useUIStore.getState().tourActive).toBe(false)
  })

  it('does not start in a demo build', async () => {
    vi.stubEnv('VITE_DEMO_BUILD', 'true')
    await put({ status: 'pending' })
    renderHook(() => useTourAutoStart())
    await settle()
    expect(useUIStore.getState().tourActive).toBe(false)
  })

  it('leaves a tour that was already started by hand alone', async () => {
    await put({ status: 'pending', stepId: 'groups' })
    useUIStore.setState({ tourActive: true, tourStepId: 'search' })
    renderHook(() => useTourAutoStart())
    await settle()
    expect(useUIStore.getState().tourStepId).toBe('search')
  })

  it('does nothing if unmounted before the read returns', async () => {
    await put({ status: 'pending' })
    const { unmount } = renderHook(() => useTourAutoStart())
    unmount()
    await settle()
    expect(useUIStore.getState().tourActive).toBe(false)
  })
})
