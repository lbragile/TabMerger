import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockTrackEvent, mockDeleteGroup, mockToast, app } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockToast: Object.assign(vi.fn(), { dismiss: vi.fn() }),
  app: { groups: [] as unknown[], theme: 'system', maxGroups: 5 },
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/lib/toast', () => ({ toast: mockToast }))
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: false }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: { available: app.groups } }),
  useDeleteGroup: () => ({ mutate: mockDeleteGroup }),
}))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: { theme: app.theme } }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ maxGroups: app.maxGroups }) }))
vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn().mockResolvedValue(0),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

import { Tour } from '@/components/Tour/Tour'
import { useUIStore } from '@/stores/uiStore'

/**
 * The action ring, the region attribute, the pulse and the focus rules of tour v2.
 * jsdom lays nothing out, so an element gets a box from its `data-rect="left,top,width,height"`.
 */
const NOW_OPEN = { id: 'now', name: 'Now Open', color: 'rgba(1,1,1,1)', updatedAt: 0, windows: [], permanent: true }
const saved = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, color: 'rgba(1,1,1,1)', updatedAt: 0, windows: [], ...extra })

function mountApp(html: string) {
  const root = document.createElement('div')
  root.id = 'root'
  root.innerHTML = `<button id="launcher">Launcher</button>${html}`
  document.body.appendChild(root)
  return root
}
const ROW = (id: string, inner: string, rect = '0,100,240,36') => `<div data-sidebar-group-index="1" data-tm-dnd-id="${id}" data-rect="${rect}">${inner}</div>`

const start = (stepId?: string) => act(() => useUIStore.getState().startTour(stepId))
const dialog = () => screen.getByRole('dialog')
const action = () => document.querySelector<HTMLElement>('[data-tour-action]')
const region = () => document.querySelector<HTMLElement>('[data-tour-spotlight]')
const expectStep = (title: string) => waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent(title))

let rectSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
  app.groups = [NOW_OPEN]
  app.theme = 'system'
  app.maxGroups = 5
  useUIStore.setState({
    tourActive: false,
    tourStepId: null,
    tourPracticeGroupId: null,
    modal: { type: null },
    searchFilter: '',
    renameTarget: null,
    previewGroupColor: null
  })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 800 })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 600 })
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [left = 0, top = 0, width = 0, height = 0] = (this.getAttribute('data-rect') ?? '').split(',').map(Number)
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }
  })
})
afterEach(() => rectSpy.mockRestore())

describe('Tour action ring', () => {
  it('is drawn on the Add Group control while the task is to do, and the region merges with it', async () => {
    mountApp('<button data-tour="add-group" data-rect="0,500,240,36">Add Group</button>')
    render(<Tour />)
    start('make-group')
    await waitFor(() => expect(action()).not.toBeNull())
    expect(region()).toHaveAttribute('data-tour-spotlight', 'merged')
    // cut-out = control grown by 3px, kept 8px from the frame edge
    expect(action()).toHaveStyle({ left: '8px', top: '497px' })
  })

  it('moves from the name field to Save once the typed name is marked ready, and the region goes calm', async () => {
    app.groups = [NOW_OPEN, saved('g1', { name: 'temp group' })]
    useUIStore.setState({ tourPracticeGroupId: 'g1' })
    mountApp(
      ROW(
        'g1',
        '<input data-tour="group-name-input" aria-label="Group name" data-rect="40,106,120,24" />' +
          '<button data-tour="group-name-save" id="save" data-rect="170,106,50,24">Save</button>'
      )
    )
    render(<Tour />)
    start('make-group')
    await waitFor(() => expect(action()).not.toBeNull())
    expect(action()).toHaveStyle({ left: '37px', top: '103px' }) // the input, 40,106
    expect(region()).toHaveAttribute('data-tour-spotlight', 'calm')
    act(() => document.getElementById('save')!.setAttribute('data-tour-ready', ''))
    await waitFor(() => expect(action()).toHaveStyle({ left: '167px' })) // Save, 170,106
  })

  it('is not drawn on a read-only step, which keeps its pulse and an empty region attribute', async () => {
    mountApp('<button data-tour="undo" data-rect="300,10,30,30">u</button><button data-tour="redo" data-rect="340,10,30,30">r</button>')
    render(<Tour />)
    start('undo')
    await waitFor(() => expect(region()).not.toBeNull())
    expect(action()).toBeNull()
    expect(region()).toHaveAttribute('data-tour-spotlight', '')
    expect(region()!.querySelector('[data-tour-pulse]')).not.toBeNull()
  })

  it('pulses on the action ring only; the calm region has no pulse', async () => {
    app.groups = [NOW_OPEN, saved('g1')]
    useUIStore.setState({ tourPracticeGroupId: 'g1' })
    mountApp(ROW('g1', '<button data-tour="group-pin" data-rect="200,106,24,24">star</button>'))
    render(<Tour />)
    start('group-pin')
    await waitFor(() => expect(action()).not.toBeNull())
    expect(action()!.querySelector('[data-tour-pulse]')).not.toBeNull()
    expect(region()).toHaveAttribute('data-tour-spotlight', 'calm')
    expect(region()!.querySelector('[data-tour-pulse]')).toBeNull()
    expect(document.querySelectorAll('[data-tour-pulse]')).toHaveLength(1)
  })

  it('disappears once the task is done, and the region pulses again', async () => {
    app.groups = [NOW_OPEN, saved('g1')]
    useUIStore.setState({ tourPracticeGroupId: 'g1' })
    mountApp(ROW('g1', '<button data-tour="group-pin" data-rect="200,106,24,24">star</button>'))
    const view = render(<Tour />)
    start('group-pin')
    await waitFor(() => expect(action()).not.toBeNull())
    app.groups = [NOW_OPEN, saved('g1', { starred: true })]
    view.rerender(<Tour />)
    await waitFor(() => expect(dialog()).toHaveAttribute('data-tour-task', 'done'))
    await waitFor(() => expect(action()).toBeNull())
    expect(region()).toHaveAttribute('data-tour-spotlight', '')
  })

  it('is absent when the step falls back to read-only (group limit)', async () => {
    app.groups = [NOW_OPEN, ...['a', 'b', 'c', 'd', 'e'].map((id) => saved(id))]
    mountApp('<button data-tour="add-group" data-rect="0,500,240,36">Add Group</button>')
    render(<Tour />)
    start('make-group')
    await waitFor(() => expect(region()).not.toBeNull())
    expect(dialog()).toHaveAttribute('data-tour-task', 'none')
    expect(action()).toBeNull()
  })
})

describe('Tour colour step: previewColor is fed only for the practice group', () => {
  const picker =
    '<div data-tour="color-picker" data-rect="260,60,200,180">' +
    '<div data-tour="color-swatches" data-rect="270,70,180,100"></div>' +
    '<button data-tour="color-apply" data-rect="400,200,50,24">Apply</button></div>'
  const dot = ROW('g1', '<button data-tour="group-color" data-rect="10,106,20,20">dot</button>')

  beforeEach(() => {
    app.groups = [NOW_OPEN, saved('g1'), saved('g2')]
    useUIStore.setState({ tourPracticeGroupId: 'g1' })
  })

  it('walks dot, swatches, Apply as the practice group colour is previewed', async () => {
    mountApp(dot + picker)
    render(<Tour />)
    start('group-colour')
    // picker is on the page: swatches (270,70), not the dot
    await waitFor(() => expect(action()).toHaveStyle({ left: '267px', top: '67px' }))
    act(() => useUIStore.setState({ previewGroupColor: { groupId: 'g1', color: 'rgba(9,9,9,1)' } }))
    await waitFor(() => expect(action()).toHaveStyle({ left: '397px', top: '197px' })) // Apply
  })

  it('stays on the swatches when the preview belongs to another group or equals the stored colour', async () => {
    mountApp(dot + picker)
    render(<Tour />)
    start('group-colour')
    await waitFor(() => expect(action()).toHaveStyle({ top: '67px' }))
    act(() => useUIStore.setState({ previewGroupColor: { groupId: 'g2', color: 'rgba(9,9,9,1)' } }))
    await new Promise((r) => setTimeout(r, 50))
    expect(action()).toHaveStyle({ top: '67px' })
    act(() => useUIStore.setState({ previewGroupColor: { groupId: 'g1', color: 'rgba(1,1,1,1)' } }))
    await new Promise((r) => setTimeout(r, 50))
    expect(action()).toHaveStyle({ top: '67px' })
  })

  it('points at the colour dot while no picker is open', async () => {
    mountApp(dot)
    render(<Tour />)
    start('group-colour')
    await waitFor(() => expect(action()).toHaveStyle({ left: '8px', top: '103px' })) // 10,106 grown by 3, kept 8 from the edge
  })
})

describe('Tour focus rules', () => {
  it('entering a waiting task moves focus to the card, not onto the Skip-this-step button that replaces Next', async () => {
    mountApp('<button data-tour="select-items" data-rect="500,10,30,30">s</button><button data-tour="search" data-rect="300,10,200,30">search</button>')
    const user = userEvent.setup()
    render(<Tour />)
    start('select-items')
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await expectStep('Find anything')
    await waitFor(() => expect(dialog()).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Skip this step' })).not.toHaveFocus()
  })

  it('does not take focus from a text field when the task completes (search is done at the first letter)', async () => {
    mountApp(
      '<button data-tour="search" data-rect="300,10,200,30">search</button><div data-tour="search-overlay" data-rect="100,10,500,200"><input id="q" /></div>'
    )
    render(<Tour />)
    start('search')
    await screen.findByRole('dialog')
    const input = document.getElementById('q') as HTMLInputElement
    input.focus()
    act(() => useUIStore.getState().setSearchFilter('w'))
    await waitFor(() => expect(dialog()).toHaveAttribute('data-tour-task', 'done'))
    await new Promise((r) => setTimeout(r, 100))
    expect(input).toHaveFocus()
  })

  it('hands focus to the card when a non-text control had it at completion', async () => {
    mountApp('<button data-tour="search" id="open" data-rect="300,10,200,30">search</button><div data-tour="search-overlay"></div>')
    render(<Tour />)
    start('search')
    await screen.findByRole('dialog')
    document.getElementById('open')!.focus()
    act(() => useUIStore.getState().setSearchFilter('w'))
    await waitFor(() => expect(dialog()).toHaveAttribute('data-tour-task', 'done'))
    await waitFor(() => expect(dialog()).toHaveFocus())
  })
})

describe('Tour chapter description', () => {
  const status = () => screen.getByRole('status')

  it('is announced once per chapter and run, not again after Back', async () => {
    mountApp('<button data-tour="groups" data-rect="0,40,240,300">g</button>')
    const user = userEvent.setup()
    render(<Tour />)
    start('group-menu')
    await screen.findByRole('dialog')
    const DESC = 'Groups are where saved tabs live.'
    // the first step shown in the chapter introduces it, whichever step that is
    await waitFor(() => expect(status()).toHaveTextContent(DESC))
    expect(document.querySelector('[data-tour-chapter-description]')).toHaveTextContent(DESC)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await expectStep('Put groups in order')
    await waitFor(() => expect(status()).toHaveTextContent('Put groups in order'))
    expect(status()).not.toHaveTextContent(DESC)

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await expectStep('More for each group')
    await waitFor(() => expect(status()).toHaveTextContent('More for each group'))
    expect(status()).not.toHaveTextContent(DESC)
  })

  it('shows the chapter title on every step of the run', async () => {
    mountApp('<button data-tour="groups" data-rect="0,40,240,300">g</button>')
    const user = userEvent.setup()
    render(<Tour />)
    start('group-menu')
    await screen.findByRole('dialog')
    expect(document.querySelector('[data-tour-chapter-title]')).toHaveTextContent('Organise with groups')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(document.querySelector('[data-tour-chapter-title]')).toHaveTextContent('Organise with groups')
  })
})
