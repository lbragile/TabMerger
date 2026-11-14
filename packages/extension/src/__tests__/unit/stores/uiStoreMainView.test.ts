import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import { SIDEBAR_SECTION } from '@/lib/sidebarSections'
import type { GroupsState } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn().mockResolvedValue(0),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

const groups = [{ id: 'now' }, { id: 'a' }, { id: 'b' }]

beforeEach(() => {
  useUIStore.setState({ activeGroupIndex: 0, mainView: GROUP_VIEW, mainViewReturnGroupId: null, openSidebarSection: null, undoStack: [], redoStack: [] })
})

describe('uiStore — mainView', () => {
  it('starts on the group view', () => {
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
  })

  it('opening a view keeps activeGroupIndex and remembers the group to return to', () => {
    useUIStore.setState({ activeGroupIndex: 2 })
    useUIStore.getState().openMainView({ kind: 'archived', groupId: 'x' }, 'b')
    const s = useUIStore.getState()
    expect(s.mainView).toEqual({ kind: 'archived', groupId: 'x' })
    expect(s.activeGroupIndex).toBe(2)
    expect(s.mainViewReturnGroupId).toBe('b')
  })

  it('one view replacing another still returns to the group shown before the first', () => {
    useUIStore.getState().openMainView({ kind: 'archived', groupId: 'x' }, 'a')
    useUIStore.getState().openMainView({ kind: 'session', sessionId: 's' }, 'ignored')
    expect(useUIStore.getState().mainView).toEqual({ kind: 'session', sessionId: 's' })
    expect(useUIStore.getState().mainViewReturnGroupId).toBe('a')
  })

  it('selecting a group returns to the group view', () => {
    useUIStore.getState().openMainView({ kind: 'session', sessionId: 's' }, 'a')
    useUIStore.getState().setActiveGroupIndex(1)
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
    expect(useUIStore.getState().mainViewReturnGroupId).toBeNull()
  })

  it('closing finds the group to return to by id, wherever it moved', () => {
    useUIStore.setState({ activeGroupIndex: 2 })
    useUIStore.getState().openMainView({ kind: 'archived', groupId: 'x' }, 'b')
    // a group above "b" was deleted meanwhile: "b" is at 1 now
    useUIStore.getState().closeMainView([{ id: 'now' }, { id: 'b' }])
    expect(useUIStore.getState().activeGroupIndex).toBe(1)
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
  })

  it('closing without groups, or with the group gone, leaves activeGroupIndex alone', () => {
    useUIStore.setState({ activeGroupIndex: 1 })
    useUIStore.getState().openMainView({ kind: 'archived', groupId: 'x' }, 'a')
    useUIStore.getState().closeMainView()
    expect(useUIStore.getState()).toMatchObject({ activeGroupIndex: 1, mainView: { kind: 'group' } })

    useUIStore.getState().openMainView({ kind: 'archived', groupId: 'x' }, 'gone')
    useUIStore.getState().closeMainView(groups)
    expect(useUIStore.getState()).toMatchObject({ activeGroupIndex: 1, mainView: { kind: 'group' }, mainViewReturnGroupId: null })
  })

  it('closing on the group view, or opening the group view, changes nothing else', () => {
    useUIStore.setState({ activeGroupIndex: 2 })
    useUIStore.getState().closeMainView(groups)
    expect(useUIStore.getState().activeGroupIndex).toBe(2)
    useUIStore.getState().openMainView({ kind: 'archived', groupId: 'x' }, 'a')
    useUIStore.getState().openMainView({ kind: 'group' })
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
  })

  it('undo snapshots never hold the view', () => {
    useUIStore.getState().openMainView({ kind: 'archived', groupId: 'x' }, 'a')
    const state: GroupsState = { active: { id: 'now', index: 0 }, available: [] }
    const entry = useUIStore.getState().pushUndo(state)
    expect(entry).not.toHaveProperty('mainView')
    expect(useUIStore.getState().undo(state)).not.toHaveProperty('mainView')
  })
})

describe('uiStore — sidebar section accordion', () => {
  it('starts with every section closed', () => {
    expect(useUIStore.getState().openSidebarSection).toBeNull()
  })

  it('opening one closes the others; toggling the open one closes it', () => {
    const { toggleSidebarSection } = useUIStore.getState()
    toggleSidebarSection(SIDEBAR_SECTION.archived)
    expect(useUIStore.getState().openSidebarSection).toBe('archived')
    toggleSidebarSection(SIDEBAR_SECTION.sessions)
    expect(useUIStore.getState().openSidebarSection).toBe('sessions')
    toggleSidebarSection(SIDEBAR_SECTION.sessions)
    expect(useUIStore.getState().openSidebarSection).toBeNull()
  })
})
