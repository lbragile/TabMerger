import { describe, it, expect, beforeEach } from 'vitest'
import { clearAllLocalData, getSetting, setSetting, saveGroupsState, getGroupsState } from '@/lib/localDb'
import { markTourDone, markTourPendingOnInstall, readTourRecord, saveTourProgress, TOUR_STORAGE_KEY } from '@/lib/tour'
import { resolveTourStartIndex } from '@/lib/tour'
import { TOUR_STEPS } from '@/lib/tourSteps'
import { activeTourTask, findPracticeGroup } from '@/lib/tourTasks'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import { clearDb } from './dbTestUtils'

// The tour record lives in chrome.storage.local, deliberately outside the IndexedDB that
// "Clear all data" wipes: a user who clears their tabs must not be shown the first-run tour again.

beforeEach(async () => {
  await clearDb()
  await chrome.storage.local.remove(TOUR_STORAGE_KEY)
})

describe('guided tour record vs "Clear all data"', () => {
  async function seedIdb() {
    const nowOpen = createNowOpenGroup()
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, createGroup('g1', 'Work')] })
    await setSetting('theme', 'dark')
  }

  it('keeps a finished tour finished, while the IndexedDB data is gone', async () => {
    await seedIdb()
    await markTourDone()
    await clearAllLocalData()
    expect(await readTourRecord()).toEqual({ status: 'done' })
    expect(await getSetting('theme', 'unset')).toBe('unset')
    expect((await getGroupsState())?.available.some((g) => g.name === 'Work') ?? false).toBe(false)
  })

  it('keeps a tour in progress at its step', async () => {
    await seedIdb()
    await saveTourProgress('groups')
    await clearAllLocalData()
    expect(await readTourRecord()).toEqual({ status: 'pending', stepId: 'groups' })
  })

  it('does not bring the tour back after the wipe for a user who never had it (no record stays no record)', async () => {
    await seedIdb()
    await clearAllLocalData()
    expect(await readTourRecord()).toBeNull()
  })

  it('install marks pending in the real storage area, and an update afterwards leaves it alone', async () => {
    expect(await markTourPendingOnInstall('install')).toBe(true)
    expect(await readTourRecord()).toEqual({ status: 'pending' })
    await markTourDone()
    expect(await markTourPendingOnInstall('install')).toBe(false)
    expect(await markTourPendingOnInstall('update')).toBe(false)
    expect(await readTourRecord()).toEqual({ status: 'done' })
  })
})

describe('guided tour resume with a practice group (real IndexedDB + storage)', () => {
  async function seedPractice() {
    const nowOpen = createNowOpenGroup()
    const practice = createGroup('p1', 'Practice')
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, practice] })
    return practice
  }
  const ctxFor = (groups: Awaited<ReturnType<typeof getGroupsState>>, practiceGroupId: string | null) => ({
    groups: groups?.available ?? [],
    practiceGroupId,
    maxGroups: 5,
    renamingGroupIndex: null,
    searchFilter: '',
    theme: 'system',
    modalType: null,
    previewColor: null
  })

  it('restores the step and the practice group after the popup closes and opens again', async () => {
    const practice = await seedPractice()
    await saveTourProgress('group-colour', practice.id)

    // a fresh start: nothing in memory, only what the stores hold
    const record = await readTourRecord()
    expect(record).toEqual({ status: 'pending', stepId: 'group-colour', practiceGroupId: practice.id })
    const steps = TOUR_STEPS.filter((x) => x.when !== 'ai')
    expect(steps[resolveTourStartIndex(steps, record?.stepId)].id).toBe('group-colour')

    const groups = await getGroupsState()
    expect(findPracticeGroup(ctxFor(groups, record?.practiceGroupId ?? null))?.name).toBe('Practice')
    // the colour step can be offered because the practice group really is in the database
    const step = TOUR_STEPS.find((x) => x.id === 'group-colour')!
    expect(activeTourTask(step, ctxFor(groups, record?.practiceGroupId ?? null))).not.toBeNull()
  })

  it('a finished tour keeps the practice group id for a replay, and markTourDone(null) forgets it', async () => {
    const practice = await seedPractice()
    await markTourDone(practice.id)
    expect(await readTourRecord()).toEqual({ status: 'done', practiceGroupId: practice.id })
    await markTourDone(null)
    expect(await readTourRecord()).toEqual({ status: 'done' })
  })

  it('after "Clear all data" the stored id points at nothing: the group steps fall back to read-only', async () => {
    const practice = await seedPractice()
    await saveTourProgress('group-pin', practice.id)
    await clearAllLocalData()
    const record = await readTourRecord()
    expect(record).toEqual({ status: 'pending', stepId: 'group-pin', practiceGroupId: practice.id })
    const groups = await getGroupsState()
    const ctx = ctxFor(groups, record?.practiceGroupId ?? null)
    expect(findPracticeGroup(ctx)).toBeNull()
    expect(activeTourTask(TOUR_STEPS.find((x) => x.id === 'group-pin')!, ctx)).toBeNull()
  })

  it('progress saved without a practice group does not invent one', async () => {
    await saveTourProgress('search', null)
    expect(await readTourRecord()).toEqual({ status: 'pending', stepId: 'search' })
  })
})
