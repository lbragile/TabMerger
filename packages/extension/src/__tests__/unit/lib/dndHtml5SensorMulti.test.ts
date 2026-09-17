/**
 * dndHtml5SensorMulti.test.ts — multi-item pickup in the native HTML5 sensor.
 *
 * The sensor is visual glue only: `useDndHandlers.onDragStart` (run synchronously by
 * dnd-kit inside `props.onStart`) records the selection in `dndMultiDrag`; the sensor then
 *  - builds the ghost with a `+N` badge during `dragstart` (aux host — safe, C4)
 *  - collapses the source AND every other visible selected row in the FIRST rAF (never
 *    during the dispatch, C4), measuring all of them before collapsing any
 *  - records the extra rows on the drag session for the collision layer
 *  - restores every collapsed row exactly on drop / Escape, AFTER `onEnd` ran
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Html5DragSensor, DND_SOURCE_COLLAPSE_EVENT, getDndDragSession } from '@/lib/dndHtml5Sensor'
import { DND_ROW_ID_ATTR, clearDndDragSelection, setDndDragSelection } from '@/lib/dndMultiDrag'

// The sensor captures `requestAnimationFrame` at module load, so frames can't be stubbed —
// wait for real ones (a frame + a macrotask, twice, like dndHtml5Sensor.test.ts).
const oneFrame = () =>
  new Promise<void>((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0))
    else setTimeout(r, 20)
  })
const flushFrames = async () => {
  await oneFrame()
  await oneFrame()
}

function row(id: string, top: number, height = 24): { row: HTMLElement; grip: HTMLElement } {
  const r = document.createElement('div')
  r.setAttribute('role', 'listitem')
  r.setAttribute('data-window-index', '0')
  r.setAttribute(DND_ROW_ID_ATTR, id)
  r.className = 'group flex'
  const grip = document.createElement('span')
  grip.setAttribute('aria-label', 'Drag to reorder tab')
  grip.setAttribute('draggable', 'true')
  const title = document.createElement('span')
  title.textContent = id
  r.append(grip, title)
  r.getBoundingClientRect = () =>
    ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  document.body.appendChild(r)
  return { row: r, grip }
}

function construct(grip: HTMLElement, selection: string[] | null, primary: string) {
  const cb = {
    // what useDndHandlers.onDragStart does, synchronously inside onStart
    onStart: vi.fn(() => setDndDragSelection(primary, selection)),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
    onAbort: vi.fn(),
    onPending: vi.fn()
  }
  const dt = { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() }
  const event = { type: 'dragstart', target: grip, dataTransfer: dt, clientX: 10, clientY: 10 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new Html5DragSensor({ event, options: {}, ...cb } as any)
  return cb
}

const collapsed = (el: HTMLElement) => el.style.getPropertyValue('height') === '0px' && el.style.visibility === 'hidden'

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  clearDndDragSelection()
})

describe('Html5DragSensor — multi-item pickup', () => {
  it('no row is touched during dragstart; the first frame collapses the source AND every other visible selected row; unselected rows untouched', async () => {
    const a = row('g::w0::t0', 0)
    const b = row('g::w0::t1', 24)
    const c = row('g::w0::t2', 48, 30)
    c.row.style.marginBottom = '2px'
    const heights: number[] = []
    const onCollapse = (e: Event) => heights.push((e as CustomEvent<{ height: number }>).detail.height)
    document.addEventListener(DND_SOURCE_COLLAPSE_EVENT, onCollapse)
    try {
      construct(a.grip, ['g::w0::t0', 'g::w0::t2', 'other::w0::t0'], 'g::w0::t0')
      expect([a.row, b.row, c.row].some(collapsed)).toBe(false)

      await flushFrames()
      expect(collapsed(a.row)).toBe(true)
      expect(collapsed(c.row)).toBe(true)
      expect(collapsed(b.row)).toBe(false)
      // the gap the provider opens is the PRIMARY's height (rbd-style)
      expect(heights).toEqual([24])
      // extras recorded with their PRE-collapse rect and outer height, for virtual geometry
      expect(getDndDragSession()!.extras).toEqual([
        { id: 'g::w0::t2', rect: { top: 48, bottom: 78, left: 0, right: 300 }, height: 32, connected: expect.any(Function) }
      ])
      expect(getDndDragSession()!.collapsed).toBe(true)
    } finally {
      document.removeEventListener(DND_SOURCE_COLLAPSE_EVENT, onCollapse)
    }
  })

  it('the ghost carries a `+N` badge (N = the other selected items, rendered or not)', () => {
    const a = row('g::w0::t0', 0)
    construct(a.grip, ['g::w0::t0', 'g::w0::t2', 'other::w0::t0'], 'g::w0::t0')
    expect(document.querySelector('[data-testid="drag-ghost-count"]')!.textContent).toBe('+2')
  })

  it('a single-item drag gets no badge and collapses only its own row', async () => {
    const a = row('g::w0::t0', 0)
    const b = row('g::w0::t1', 24)
    construct(a.grip, null, 'g::w0::t0')
    expect(document.querySelector('[data-testid="drag-ghost-count"]')).toBeNull()
    await flushFrames()
    expect(collapsed(a.row)).toBe(true)
    expect(collapsed(b.row)).toBe(false)
    expect(getDndDragSession()!.extras).toEqual([])
  })

  it('drop: onEnd runs while every row is still collapsed; then ALL rows get their prior inline styles back exactly', async () => {
    const a = row('g::w0::t0', 0)
    const c = row('g::w0::t2', 48)
    c.row.style.setProperty('height', '31px', 'important')
    let atEnd: boolean[] = []
    const cb = construct(a.grip, ['g::w0::t0', 'g::w0::t2'], 'g::w0::t0')
    cb.onEnd.mockImplementation(() => {
      atEnd = [collapsed(a.row), collapsed(c.row)]
    })
    await flushFrames()
    document.dispatchEvent(Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { clientX: 5, clientY: 60 }))
    await flushFrames() // deferred end
    expect(cb.onEnd).toHaveBeenCalledTimes(1)
    expect(atEnd).toEqual([true, true])
    expect(a.row.getAttribute('style') ?? '').toBe('')
    expect(c.row.style.getPropertyValue('height')).toBe('31px')
    expect(c.row.style.getPropertyPriority('height')).toBe('important')
    expect(c.row.style.visibility).toBe('')
    expect(document.querySelector('[data-testid="drag-ghost"]')).toBeNull()
  })

  it('Escape restores every collapsed row', async () => {
    const a = row('g::w0::t0', 0)
    const c = row('g::w0::t2', 48)
    const cb = construct(a.grip, ['g::w0::t0', 'g::w0::t2'], 'g::w0::t0')
    await flushFrames()
    expect(collapsed(a.row) && collapsed(c.row)).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(cb.onCancel).toHaveBeenCalledTimes(1)
    expect(collapsed(a.row)).toBe(false)
    expect(collapsed(c.row)).toBe(false)
  })
})
