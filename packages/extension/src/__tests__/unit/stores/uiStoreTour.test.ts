import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUIStore } from '@/stores/uiStore'

vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn().mockResolvedValue(0),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  useUIStore.setState({ tourActive: false, tourStepId: null, modal: { type: null } })
})

describe('uiStore — guided tour', () => {
  it('starts inactive with no remembered step', () => {
    const s = useUIStore.getState()
    expect(s.tourActive).toBe(false)
    expect(s.tourStepId).toBeNull()
  })

  it('startTour() starts at the first step', () => {
    useUIStore.getState().startTour()
    expect(useUIStore.getState()).toMatchObject({ tourActive: true, tourStepId: null })
  })

  it('startTour(stepId) resumes at that step', () => {
    useUIStore.getState().startTour('groups')
    expect(useUIStore.getState()).toMatchObject({ tourActive: true, tourStepId: 'groups' })
  })

  it('startTour restarts from the top when called again without a step', () => {
    useUIStore.getState().startTour('groups')
    useUIStore.getState().startTour()
    expect(useUIStore.getState().tourStepId).toBeNull()
  })

  it('setTourStepId moves to a step', () => {
    useUIStore.getState().startTour()
    useUIStore.getState().setTourStepId('search')
    expect(useUIStore.getState().tourStepId).toBe('search')
  })

  it('endTour deactivates and forgets the step', () => {
    useUIStore.getState().startTour('search')
    useUIStore.getState().endTour()
    expect(useUIStore.getState()).toMatchObject({ tourActive: false, tourStepId: null })
  })

  it('does not touch the modal state', () => {
    useUIStore.getState().openModal('settings')
    useUIStore.getState().startTour()
    expect(useUIStore.getState().modal.type).toBe('settings')
  })
})
