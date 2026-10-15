import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { mockTrackEvent, mockDeleteGroup, mockToast, app } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockToast: Object.assign(vi.fn(), { dismiss: vi.fn() }),
  // What the mocked hooks return: a test changes it and re-renders
  app: { groups: [] as unknown[], theme: 'system', maxGroups: 5 },
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/lib/toast', () => ({ toast: mockToast }))
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: false }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: { available: app.groups } }),
  useDeleteGroup: () => ({ mutate: mockDeleteGroup }),
  GROUPS_QUERY_KEY: ['groups'],
}))
// The practice groups live in IndexedDB: not under test here (see tourDemo.test.ts)
vi.mock('@/lib/tourDemo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tourDemo')>()),
  ensureTourDemoGroups: vi.fn().mockResolvedValue({ state: { available: [] }, changed: false }),
  resetTourDemoGroups: vi.fn().mockResolvedValue({ state: { available: [] }, changed: false }),
  removeTourDemoGroups: vi.fn().mockResolvedValue({ state: { available: [] }, changed: false }),
}))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: { theme: app.theme } }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ maxGroups: app.maxGroups }) }))
vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn().mockResolvedValue(0),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

import { Tour } from '@/components/Tour/Tour'
import { useUIStore } from '@/stores/uiStore'
import { TOUR_STORAGE_KEY } from '@/lib/tour'
import { TOUR_ANCHORS, TOUR_STEPS } from '@/lib/tourSteps'

/** The tour reads and writes the groups query cache (the practice groups), so it needs a client. */
const renderTour = () => {
  const client = new QueryClient()
  const tree = () => (
    <QueryClientProvider client={client}>
      <Tour />
    </QueryClientProvider>
  )
  const view = render(tree())
  return { ...view, rerenderTour: () => view.rerender(tree()) }
}

const ANCHORS = Object.values(TOUR_ANCHORS)
/** The steps a build without the AI features shows. */
const STEPS = TOUR_STEPS.filter((s) => s.when !== 'ai')
const NOW_OPEN = { id: 'now', name: 'Now Open', color: 'rgba(1,1,1,1)', updatedAt: 0, windows: [], permanent: true }
const savedGroup = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, color: 'rgba(1,1,1,1)', updatedAt: 0, windows: [], ...extra })

/** The app: `#root` with a control for every anchor (except `omit`), plus a launcher button. */
function mountApp(omit: string[] = []) {
  const root = document.createElement('div')
  root.id = 'root'
  root.innerHTML =
    `<button id="launcher">Launcher</button>` +
    ANCHORS.filter((a) => !omit.includes(a))
      .map((a) => `<button data-tour="${a}">${a}</button>`)
      .join('')
  document.body.appendChild(root)
  return root
}

const stored = async () => (await chrome.storage.local.get(TOUR_STORAGE_KEY))[TOUR_STORAGE_KEY]
const start = (stepId?: string) => act(() => useUIStore.getState().startTour(stepId))
const card = () => screen.getByRole('dialog')
/** How many of the app root's children are locked (`inert`). The tour locks the children, not the root itself. */
const lockedCount = (root: HTMLElement) => Array.from(root.children).filter((c) => c.hasAttribute('inert')).length
/** The card's constant name is "TabMerger tour": the step is identified by its heading. */
const expectStep = (title: string) => waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent(title))
const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^(Next|Done|Skip this step)$/ }))

beforeEach(() => {
  document.body.innerHTML = ''
  mockTrackEvent.mockClear()
  mockDeleteGroup.mockClear()
  mockToast.mockClear()
  app.groups = [NOW_OPEN]
  app.theme = 'system'
  app.maxGroups = 5
  useUIStore.setState({ tourActive: false, tourStepId: null, tourPracticeGroupId: null, modal: { type: null }, searchFilter: '', renameTarget: null })
})

describe('Tour', () => {
  it('draws nothing while no tour is running', async () => {
    mountApp()
    renderTour()
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens at the first step with the app locked underneath', async () => {
    const root = mountApp()
    renderTour()
    start()
    await expectStep('Welcome to TabMerger')
    expect(screen.getByText(`Step 1 of ${STEPS.length}`)).toBeInTheDocument()
    expect(screen.getByText('Chapter 1 of 7')).toBeInTheDocument()
    expect(lockedCount(root)).toBe(root.children.length)
  })

  it('moves focus into the card', async () => {
    mountApp()
    renderTour()
    start()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toHaveFocus())
  })

  it('starts by itself from a pending stored record and resumes at the stored step', async () => {
    mountApp()
    await chrome.storage.local.set({ [TOUR_STORAGE_KEY]: { status: 'pending', stepId: 'group-menu' } })
    renderTour()
    await expectStep('More for each group')
    expect(mockTrackEvent).not.toHaveBeenCalledWith('tour_started', expect.anything())
  })

  it('falls back to the first step when the stored step no longer exists', async () => {
    mountApp()
    renderTour()
    start('removed-step')
    await expectStep('Welcome to TabMerger')
  })

  it('drops steps whose anchor is missing and recounts "Step X of N"', async () => {
    mountApp([TOUR_ANCHORS.sessions])
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    const total = STEPS.length - 1
    expect(screen.getByText(`Step 1 of ${total}`)).toBeInTheDocument()
    // walk every step: the sessions step never appears
    const titles: string[] = []
    for (let i = 0; i < total; i++) {
      // wait for the real condition (this step is up), not a fixed delay: the walk is long and a loaded machine is slow
      await waitFor(() => expect(screen.getByText(`Step ${i + 1} of ${total}`)).toBeInTheDocument())
      titles.push(screen.getByRole('heading').textContent ?? '')
      if (i < total - 1) await next(user)
    }
    expect(titles).not.toContain('Save everything at once')
    expect(titles).toHaveLength(total)
  }, 6000)

  it('Next and Back move between steps, Back is absent on step 1', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    await next(user)
    await expectStep('Now Open')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await expectStep('Welcome to TabMerger')
  })

  it('keeps focus inside the card after each step change, also when the focused button goes away', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start('now-open')
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    // Back is gone on the first step: focus must not drop to the body
    await expectStep('Welcome to TabMerger')
    await waitFor(() => expect(card().contains(document.activeElement)).toBe(true))
    await next(user)
    expect(card().contains(document.activeElement)).toBe(true)
  })

  it('saves the current step on every step', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    await waitFor(async () => expect(await stored()).toEqual({ status: 'pending', stepId: 'welcome' }))
    await next(user)
    await waitFor(async () => expect(await stored()).toEqual({ status: 'pending', stepId: 'now-open' }))
  })

  it('Left/Right arrows move and stop at the first step; Right never finishes on the last', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    await user.keyboard('{ArrowLeft}')
    await expectStep('Welcome to TabMerger')
    await user.keyboard('{ArrowRight}')
    await expectStep('Now Open')
    // from the first step after the last interactive one, to the end and beyond
    start('settings-more')
    await expectStep('More in Settings')
    for (let i = 0; i < STEPS.length; i++) await user.keyboard('{ArrowRight}')
    await expectStep('You are all set')
    expect(useUIStore.getState().tourActive).toBe(true)
    expect(await stored()).not.toEqual({ status: 'done' })
  })

  it('Done on the last step completes the tour, records it and reports the count', async () => {
    const root = mountApp()
    const user = userEvent.setup()
    renderTour()
    start(TOUR_STEPS[TOUR_STEPS.length - 1].id)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(useUIStore.getState().tourActive).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_completed', { steps: STEPS.length })
    expect(mockTrackEvent).not.toHaveBeenCalledWith('tour_skipped', expect.anything())
    await waitFor(async () => expect(await stored()).toEqual({ status: 'done' }))
    expect(lockedCount(root)).toBe(0)
  })

  it('Enter on the card walks forward and completes on the last step', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start(STEPS[STEPS.length - 2].id)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toHaveFocus())
    await user.keyboard('{Enter}')
    await expectStep('You are all set')
    await user.keyboard('{Enter}')
    expect(useUIStore.getState().tourActive).toBe(false)
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_completed', expect.anything())
  })

  it('Escape on the last step counts as finishing, not skipping', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start(TOUR_STEPS[TOUR_STEPS.length - 1].id)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(useUIStore.getState().tourActive).toBe(false)
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_completed', { steps: STEPS.length })
    expect(mockTrackEvent).not.toHaveBeenCalledWith('tour_skipped', expect.anything())
    await waitFor(async () => expect(await stored()).toEqual({ status: 'done' }))
  })

  it('leaves the toast region usable while the app underneath is locked', async () => {
    const root = mountApp()
    const toasts = document.createElement('section')
    toasts.setAttribute('aria-live', 'polite')
    root.appendChild(toasts)
    renderTour()
    start()
    await screen.findByRole('dialog')
    expect(toasts).not.toHaveAttribute('inert')
    expect(root.querySelector('button')).toHaveAttribute('inert')
  })

  it('Skip tour ends it, records done and reports which step', async () => {
    const root = mountApp()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    await next(user)
    await user.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(useUIStore.getState().tourActive).toBe(false)
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_skipped', { step: 2, step_id: 'now-open' })
    expect(mockTrackEvent).not.toHaveBeenCalledWith('tour_completed', expect.anything())
    await waitFor(async () => expect(await stored()).toEqual({ status: 'done' }))
    expect(lockedCount(root)).toBe(0)
  })

  it('Escape skips', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(useUIStore.getState().tourActive).toBe(false)
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_skipped', { step: 1, step_id: 'welcome' })
  })

  it('returns focus to the control that launched the tour', async () => {
    mountApp()
    const launcher = document.getElementById('launcher') as HTMLButtonElement
    launcher.focus()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(launcher).toHaveFocus()
  })

  it('returns focus to the "?" button when nothing launched the tour', async () => {
    mountApp()
    ;(document.activeElement as HTMLElement | null)?.blur()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(document.querySelector(`[data-tour="${TOUR_ANCHORS.help}"]`)).toHaveFocus()
  })

  it('steps aside while a modal is open and comes back when it closes, on the same step', async () => {
    const root = mountApp()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    await next(user)
    act(() => useUIStore.getState().openModal('settings'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lockedCount(root)).toBe(0)
    expect(useUIStore.getState().tourActive).toBe(true)
    act(() => useUIStore.getState().closeModal())
    await expectStep('Now Open')
    expect(lockedCount(root)).toBe(root.children.length)
  })

  it('does not appear when a modal is already open at start', async () => {
    mountApp()
    useUIStore.setState({ modal: { type: 'settings' } })
    renderTour()
    start()
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('removes the lock when it unmounts mid-tour', async () => {
    const root = mountApp()
    const { unmount } = renderTour()
    start()
    await screen.findByRole('dialog')
    expect(lockedCount(root)).toBe(root.children.length)
    unmount()
    expect(lockedCount(root)).toBe(0)
  })

  it('does not count a tour_started event itself (the launcher does)', async () => {
    mountApp()
    renderTour()
    start()
    await screen.findByRole('dialog')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('spotlights the step anchor and leaves the centered welcome step without one', async () => {
    mountApp()
    // jsdom lays nothing out: give the popup frame and every element a size
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 600 })
    const rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 100, top: 100, right: 200, bottom: 130, width: 100, height: 30, x: 100, y: 100, toJSON: () => ({}) })
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    expect(document.querySelector('[data-tour-spotlight]')).toBeNull()
    await next(user)
    await waitFor(() => expect(document.querySelector('[data-tour-spotlight]')).not.toBeNull())
    expect(document.querySelector('[data-tour-pulse]')).not.toBeNull()
    rect.mockRestore()
  })

  // ── Interactive steps ──────────────────────────────────────────────────────────────────

  it('an interactive step waits: no Next, and neither Right nor Enter moves on', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start('make-group')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-tour-task', 'todo')
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    await waitFor(() => expect(dialog).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{Enter}')
    await expectStep('Make a group')
  })

  it('unlocks only the control the step asks for', async () => {
    const root = mountApp()
    renderTour()
    start('make-group')
    await screen.findByRole('dialog')
    const allowed = root.querySelector(`[data-tour="${TOUR_ANCHORS.addGroup}"]`)
    expect(allowed).not.toHaveAttribute('inert')
    expect(lockedCount(root)).toBe(root.children.length - 1)
  })

  it('"Skip this step" moves on and reports the step', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start('make-group')
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Skip this step' }))
    await expectStep('Give it a color')
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_step_skipped', { step_id: 'make-group' })
  })

  it('completes "make a group" from real state: a new group with a name of its own', async () => {
    mountApp()
    const user = userEvent.setup()
    const view = renderTour()
    start('make-group')
    const dialog = await screen.findByRole('dialog')
    // the group appears, still carrying its placeholder name and being renamed: not done yet
    app.groups = [NOW_OPEN, savedGroup('g1', { name: 'temp group' })]
    act(() => useUIStore.setState({ renameTarget: { kind: 'group', groupIndex: 1 } }))
    view.rerenderTour()
    await waitFor(() => expect(useUIStore.getState().tourPracticeGroupId).toBe('g1'))
    expect(dialog).toHaveAttribute('data-tour-task', 'todo')
    // named and saved
    app.groups = [NOW_OPEN, savedGroup('g1', { name: 'Practice' })]
    act(() => useUIStore.setState({ renameTarget: null }))
    view.rerenderTour()
    await waitFor(() => expect(dialog).toHaveAttribute('data-tour-task', 'done'))
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_task_done', { step_id: 'make-group' })
    await waitFor(async () => expect(await stored()).toEqual({ status: 'pending', stepId: 'make-group', practiceGroupId: 'g1' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await expectStep('Give it a color')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-tour-task', 'todo')
  })

  it('a new group that is cancelled puts "make a group" back to waiting', async () => {
    mountApp()
    const view = renderTour()
    start('make-group')
    const dialog = await screen.findByRole('dialog')
    app.groups = [NOW_OPEN, savedGroup('g1', { name: 'temp group' })]
    view.rerenderTour()
    await waitFor(() => expect(useUIStore.getState().tourPracticeGroupId).toBe('g1'))
    // Escape in the name field: the app deletes the never-named group again
    app.groups = [NOW_OPEN]
    view.rerenderTour()
    expect(dialog).toHaveAttribute('data-tour-task', 'todo')
    expect(mockTrackEvent).not.toHaveBeenCalledWith('tour_task_done', expect.anything())
  })

  it('completes the color step when the practice group color changes, and stays done after Back', async () => {
    app.groups = [NOW_OPEN, savedGroup('g1', { name: 'Practice' })]
    useUIStore.setState({ tourPracticeGroupId: 'g1' })
    mountApp()
    const user = userEvent.setup()
    const view = renderTour()
    start('group-color')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-tour-task', 'todo')
    app.groups = [NOW_OPEN, savedGroup('g1', { name: 'Practice', color: 'rgba(9,9,9,1)' })]
    view.rerenderTour()
    await waitFor(() => expect(dialog).toHaveAttribute('data-tour-task', 'done'))
    expect(dialog).toHaveTextContent('Nice, color changed.')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await expectStep('Pin a group to the top')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await expectStep('Give it a color')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-tour-task', 'done')
  })

  it('at the group limit the group steps are read-only and nothing is asked for', async () => {
    app.groups = [NOW_OPEN, ...['a', 'b', 'c', 'd', 'e'].map((id) => savedGroup(id))]
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start('make-group')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-tour-task', 'none')
    expect(dialog).toHaveTextContent('as many groups as your plan allows')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await expectStep('Give it a color')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-tour-task', 'none')
  })

  it('"Skip chapter" jumps to the first step of the next chapter', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start('make-group')
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Skip chapter' }))
    await expectStep('Reorder tabs')
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_chapter_skipped', { chapter: 'groups' })
  })

  it('stays on screen for the modal its own step opens, and completes on the saved theme', async () => {
    mountApp()
    const view = renderTour()
    start('theme')
    await screen.findByRole('dialog')
    act(() => useUIStore.getState().openModal('settings'))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-tour-card', 'theme')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-tour-task', 'todo')
    app.theme = 'dark'
    view.rerenderTour()
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-tour-task', 'done'))
  })

  it('closes the modal its step opened when the step is left', async () => {
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start('theme')
    await screen.findByRole('dialog')
    act(() => useUIStore.getState().openModal('settings'))
    await user.click(screen.getByRole('button', { name: 'Skip this step' }))
    await expectStep('More in Settings')
    expect(useUIStore.getState().modal.type).toBeNull()
  })

  it('offers to remove the practice group on the last step, and removes only that group', async () => {
    app.groups = [NOW_OPEN, savedGroup('keep'), savedGroup('g1', { name: 'Practice' })]
    useUIStore.setState({ tourPracticeGroupId: 'g1' })
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start('finish')
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Remove the practice group' }))
    expect(mockDeleteGroup).toHaveBeenCalledTimes(1)
    expect(mockDeleteGroup).toHaveBeenCalledWith(2)
    expect(screen.getByText('The practice group was removed.')).toBeInTheDocument()
  })

  it('a skipped tour offers the removal in a toast and remembers the group for a replay', async () => {
    app.groups = [NOW_OPEN, savedGroup('g1', { name: 'Practice' })]
    useUIStore.setState({ tourPracticeGroupId: 'g1' })
    mountApp()
    const user = userEvent.setup()
    renderTour()
    start()
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(mockToast).toHaveBeenCalledTimes(1)
    expect(mockToast.mock.calls[0][0]).toContain('Practice')
    await waitFor(async () => expect(await stored()).toEqual({ status: 'done', practiceGroupId: 'g1' }))
    expect(mockDeleteGroup).not.toHaveBeenCalled()
  })
})
