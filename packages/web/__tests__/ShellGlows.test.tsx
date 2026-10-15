import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIT_OPACITY, SHELL_GLOWS, ShellGlows } from '@/components/errors/ShellGlows'
import { ShellBackdrop } from '@/components/errors/ErrorPageShell'

type Listener = () => void

/**
 * A `matchMedia` stub where the queries in `matching` match. Each query object keeps its
 * `change` listeners so a test can flip a query and fire them.
 */
function mockMatchMedia(matching: string[] = []) {
  const lists = new Map<string, { matches: boolean; listeners: Set<Listener> }>()
  const matchMedia = vi.fn((query: string) => {
    let entry = lists.get(query)
    if (!entry) {
      entry = { matches: matching.includes(query), listeners: new Set() }
      lists.set(query, entry)
    }
    const e = entry
    return {
      get matches() {
        return e.matches
      },
      media: query,
      addEventListener: (_: string, fn: Listener) => e.listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => e.listeners.delete(fn),
    }
  })
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia
  return {
    set(query: string, matches: boolean) {
      const entry = lists.get(query)
      if (!entry) throw new Error(`query not registered: ${query}`)
      entry.matches = matches
      entry.listeners.forEach((fn) => fn())
    },
    listenerCount: () => [...lists.values()].reduce((n, e) => n + e.listeners.size, 0),
  }
}

/** A manual `requestAnimationFrame` queue so frames run only when the test says so. */
function mockRaf() {
  let queue = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    id += 1
    queue.set(id, cb)
    return id
  })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
    queue.delete(handle)
  })
  return {
    cancel,
    pending: () => queue.size,
    step(frames = 1) {
      for (let i = 0; i < frames; i += 1) {
        const current = queue
        queue = new Map()
        act(() => current.forEach((cb) => cb(performance.now())))
      }
    },
  }
}

// The backdrop is partway down the page: its rect does not start at the viewport's origin.
const RECT = { left: 40, top: 100, width: 800, height: 600, right: 840, bottom: 700, x: 40, y: 100, toJSON: () => ({}) }
const [MAIN, TRAILING] = SHELL_GLOWS

/** A custom property written in px, as a number (0 when unset). */
const px = (el: HTMLElement, name: string) => parseFloat(el.style.getPropertyValue(name) || '0')

/** Where the main glow's centre is, in viewport coordinates: rect + resting point + offset. */
const mainCentre = (el: HTMLElement, rect = RECT) => ({
  x: rect.left + MAIN.rest.x * rect.width + px(el, '--g1x'),
  y: rect.top + MAIN.rest.y * rect.height + px(el, '--g1y'),
})

function renderGlows() {
  render(<ShellGlows />)
  const el = screen.getByTestId('backdrop-glows')
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(RECT as DOMRect)
  return el
}

function movePointer(x: number, y: number) {
  const event = new Event('pointermove') as PointerEvent
  Object.assign(event, { clientX: x, clientY: y })
  act(() => {
    window.dispatchEvent(event)
  })
}

function leaveWindow() {
  act(() => {
    document.dispatchEvent(new MouseEvent('pointerout', { relatedTarget: null }))
  })
}

describe('ShellGlows', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    vi.restoreAllMocks()
  })

  it('attaches one passive pointermove listener on a fine-pointer device', () => {
    mockMatchMedia()
    const add = vi.spyOn(window, 'addEventListener')
    renderGlows()
    const calls = add.mock.calls.filter(([type]) => type === 'pointermove')
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toEqual({ passive: true })
  })

  it.each([['(prefers-reduced-motion: reduce)'], ['(hover: none)'], ['(pointer: coarse)']])(
    'stays static (no listener, no grid) when %s matches',
    (query) => {
      mockMatchMedia([query])
      const add = vi.spyOn(window, 'addEventListener')
      const el = renderGlows()
      expect(add.mock.calls.some(([type]) => type === 'pointermove')).toBe(false)
      movePointer(300, 300)
      expect(el.style.getPropertyValue('--lit')).toBe('')
    }
  )

  it('stays static where matchMedia is missing', () => {
    // @ts-expect-error jsdom without the stub
    delete window.matchMedia
    const add = vi.spyOn(window, 'addEventListener')
    renderGlows()
    expect(add.mock.calls.some(([type]) => type === 'pointermove')).toBe(false)
  })

  it('renders the glows at rest with nothing set (matches the server output)', () => {
    mockMatchMedia()
    const el = renderGlows()
    expect(el.getAttribute('style')).toBeNull()
    const [, main, trailing] = Array.from(el.children) as HTMLElement[]
    expect(main.style.transform).toBe('translate3d(var(--g1x, 0px), var(--g1y, 0px), 0)')
    expect(trailing.style.transform).toBe('translate3d(var(--g2x, 0px), var(--g2y, 0px), 0)')
    expect(main.style.left).toBe(`${MAIN.rest.x * 100}%`)
    expect(main.style.top).toBe(`${MAIN.rest.y * 100}%`)
    expect(main.className).toMatch(/will-change-transform/)
    // A transition on transform would make the main glow lag behind the pointer.
    expect(main.className).not.toMatch(/transition/)
  })

  it('takes colours from theme tokens and centres a 4rem grid circle on the main glow', () => {
    mockMatchMedia()
    const el = renderGlows()
    const [lit, main, trailing] = Array.from(el.children) as HTMLElement[]
    expect(main.getAttribute('style')).toContain('hsl(var(--glow-1) / var(--glow-1-alpha))')
    expect(trailing.getAttribute('style')).toContain('hsl(var(--glow-2) / var(--glow-2-alpha))')
    expect(lit).toHaveAttribute('data-testid', 'backdrop-lit-grid')
    expect(lit.getAttribute('style')).toContain('hsl(var(--grid-lit))')
    expect(lit.getAttribute('style')).toContain(
      `at calc(${MAIN.rest.x * 100}% + var(--g1x, 0px)) calc(${MAIN.rest.y * 100}% + var(--g1y, 0px))`
    )
    expect(lit.style.opacity).toBe('var(--lit, 0)')
    expect(lit.style.backgroundSize).toBe('4rem 4rem')
    expect(lit.className).toMatch(/transition-opacity/)
  })

  it('puts the main glow exactly under the pointer after one frame; the second one trails', () => {
    mockMatchMedia()
    const raf = mockRaf()
    const el = renderGlows()

    movePointer(600, 500)
    // Nothing is written until the frame runs.
    expect(el.style.getPropertyValue('--g1x')).toBe('')
    expect(raf.pending()).toBe(1)
    raf.step()
    expect(mainCentre(el).x).toBeCloseTo(600, 1)
    expect(mainCentre(el).y).toBeCloseTo(500, 1)

    // Trailing glow: one lerp step towards `reach` of the way to the pointer.
    const targetX = (600 - RECT.left - TRAILING.rest.x * RECT.width) * TRAILING.reach
    expect(px(el, '--g2x')).toBeCloseTo(targetX * TRAILING.lerp, 1)

    // A new position is applied in full on the next frame, with no easing.
    movePointer(100, 650)
    raf.step()
    expect(mainCentre(el).x).toBeCloseTo(100, 1)
    expect(mainCentre(el).y).toBeCloseTo(650, 1)

    // The loop stops once the trailing glow settles, and the next move restarts it.
    raf.step(1000)
    expect(raf.pending()).toBe(0)
    movePointer(200, 200)
    expect(raf.pending()).toBe(1)
  })

  it('re-aims on scroll under a still pointer', () => {
    mockMatchMedia()
    const raf = mockRaf()
    const el = renderGlows()
    movePointer(400, 500)
    raf.step()
    const scrolled = { ...RECT, top: RECT.top - 50 }
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(scrolled as DOMRect)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    raf.step()
    expect(mainCentre(el, scrolled).y).toBeCloseTo(500, 1)
  })

  it('keeps the glows inside the backdrop when the pointer is outside it', () => {
    mockMatchMedia()
    const raf = mockRaf()
    const el = renderGlows()
    movePointer(5000, -5000)
    raf.step()
    expect(mainCentre(el).x).toBeCloseTo(RECT.right, 1)
    expect(mainCentre(el).y).toBeCloseTo(RECT.top, 1)
  })

  it('shows the grid on the first move, and on leaving fades it out and eases the glows to rest', () => {
    mockMatchMedia()
    const raf = mockRaf()
    const el = renderGlows()
    expect(el.style.getPropertyValue('--lit')).toBe('')
    movePointer(600, 500)
    expect(el.style.getPropertyValue('--lit')).toBe(LIT_OPACITY)
    raf.step()
    const offset = px(el, '--g1x')
    expect(offset).not.toBe(0)

    leaveWindow()
    expect(el.style.getPropertyValue('--lit')).toBe('')
    raf.step()
    // Eased, not snapped.
    expect(px(el, '--g1x')).toBeCloseTo(offset * (1 - MAIN.lerp), 1)
    raf.step(1000)
    expect(px(el, '--g1x')).toBe(0)
    expect(px(el, '--g2x')).toBe(0)
    expect(raf.pending()).toBe(0)

    movePointer(200, 200)
    expect(el.style.getPropertyValue('--lit')).toBe(LIT_OPACITY)
  })

  it('ignores pointerout between elements inside the page', () => {
    mockMatchMedia()
    const raf = mockRaf()
    const el = renderGlows()
    movePointer(600, 500)
    raf.step()
    const offset = px(el, '--g1x')
    act(() => {
      document.dispatchEvent(new MouseEvent('pointerout', { relatedTarget: document.body }))
    })
    raf.step()
    expect(px(el, '--g1x')).toBeCloseTo(offset, 1)
    expect(el.style.getPropertyValue('--lit')).toBe(LIT_OPACITY)
  })

  it('schedules at most one frame for many moves in one frame', () => {
    mockMatchMedia()
    const raf = mockRaf()
    renderGlows()
    movePointer(100, 200)
    movePointer(200, 200)
    movePointer(300, 200)
    expect(raf.pending()).toBe(1)
  })

  it('detaches and resets when reduced motion turns on, and reattaches when it turns off', () => {
    const media = mockMatchMedia()
    const raf = mockRaf()
    const remove = vi.spyOn(window, 'removeEventListener')
    const el = renderGlows()
    movePointer(700, 400)
    raf.step(3)
    expect(el.style.getPropertyValue('--g1x')).not.toBe('')

    act(() => media.set('(prefers-reduced-motion: reduce)', true))
    expect(remove.mock.calls.some(([type]) => type === 'pointermove')).toBe(true)
    expect(el.getAttribute('style')).toBe('')
    expect(raf.pending()).toBe(0)

    const add = vi.spyOn(window, 'addEventListener')
    act(() => media.set('(prefers-reduced-motion: reduce)', false))
    expect(add.mock.calls.some(([type]) => type === 'pointermove')).toBe(true)
  })

  it('removes listeners and cancels a pending frame on unmount', () => {
    const media = mockMatchMedia()
    const raf = mockRaf()
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<ShellGlows />)
    movePointer(400, 300)
    expect(raf.pending()).toBe(1)
    unmount()
    const removed = remove.mock.calls.map(([type]) => type)
    expect(removed).toContain('pointermove')
    expect(removed).toContain('scroll')
    expect(raf.cancel).toHaveBeenCalled()
    expect(raf.pending()).toBe(0)
    expect(media.listenerCount()).toBe(0)
  })
})

describe('ShellBackdrop', () => {
  it('is decorative, behind the content, and has no always-on grid', () => {
    const { container } = render(<ShellBackdrop />)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('aria-hidden', 'true')
    for (const cls of ['pointer-events-none', 'absolute', 'inset-0', '-z-10']) {
      expect(root.classList).toContain(cls)
    }
    expect(root.children).toHaveLength(1)
    expect(root.firstElementChild).toHaveAttribute('data-testid', 'backdrop-glows')
  })
})
