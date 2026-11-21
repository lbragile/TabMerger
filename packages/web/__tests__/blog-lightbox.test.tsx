/**
 * The figure lightbox (open/close, focus, #figure-N history, stepping, scroll lock, motion), the
 * hover lens (off by default, per-figure toggle, touch, persisted preferences) and the carousel.
 * jsdom has no layout or <dialog> modality, so layout calls and showModal/close are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnnotatedFigure } from '@/components/blog/AnnotatedFigure'
import { BlogPostStateProvider } from '@/components/blog/BlogPostState'
import { Carousel } from '@/components/blog/Carousel'
import { FigureLightbox } from '@/components/blog/FigureLightbox'
import { DEFAULT_LENS_PREFS, LENS_PREFS_KEY, parseLensPrefs, readLensPrefsRaw, writeLensPrefs } from '@/lib/blog/lensPrefs'

type MatchMap = Record<string, boolean>
let media: MatchMap = {}
function stubMedia(map: MatchMap) {
  media = map
}

beforeEach(() => {
  media = {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: media[query] ?? false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  // jsdom lays nothing out: every element counts as shown.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return [{}] as unknown as DOMRectList
  })
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
  history.replaceState(null, '', '/blog/demo')
  document.body.style.overflow = ''
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const fig = (n: number, extra: Record<string, unknown> = {}) => (
  <AnnotatedFigure key={n} src={`/blog/demo/s${n}.webp`} alt={`Shot ${n}`} width={800} height={400} figure={String(n)} {...extra}>
    Caption {n}
  </AnnotatedFigure>
)

function page(ui: React.ReactNode = [fig(1), fig(2), fig(3)]) {
  return render(
    <BlogPostStateProvider>
      <FigureLightbox>{ui}</FigureLightbox>
    </BlogPostStateProvider>
  )
}
const enlarge = (n: number) => screen.getByRole('button', { name: `Enlarge: Shot ${n}` })
const dialog = () => document.querySelector('dialog') as HTMLDialogElement

describe('lightbox', () => {
  it('opens from the keyboard, shows the figure and caption, and Escape closes it with focus back on the image', async () => {
    const user = userEvent.setup()
    page()
    enlarge(2).focus()
    await user.keyboard('{Enter}')
    expect(dialog()).toHaveAttribute('open')
    expect(within(dialog()).getByAltText('Shot 2')).toBeInTheDocument()
    expect(within(dialog()).getByText('Figure 2 of 3')).toBeInTheDocument()
    expect(within(dialog()).getByText(/Caption 2/)).toBeInTheDocument()
    // Escape arrives as a cancel event on a modal dialog.
    const cancel = new Event('cancel', { cancelable: true })
    act(() => {
      dialog().dispatchEvent(cancel)
    })
    expect(cancel.defaultPrevented).toBe(true)
    // close() undoes the pushed history entry; the browser's popstate then closes the dialog.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(dialog()).not.toHaveAttribute('open')
    expect(document.activeElement).toBe(enlarge(2))
  })

  it('pushes #figure-N when it opens and Back to article, the close button and a backdrop click all close it', async () => {
    const user = userEvent.setup()
    page()
    for (const how of ['back', 'close', 'backdrop'] as const) {
      await user.click(enlarge(1))
      expect(location.hash).toBe('#figure-1')
      if (how === 'back') await user.click(within(dialog()).getByRole('button', { name: /Back to article/ }))
      if (how === 'close') await user.click(within(dialog()).getByRole('button', { name: 'Close' }))
      if (how === 'backdrop') await user.click(dialog().querySelector('[data-lightbox-scroll]')!)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
      expect(dialog()).not.toHaveAttribute('open')
      expect(location.hash).toBe('')
    }
  })

  it('closes on the browser Back button', async () => {
    const user = userEvent.setup()
    page()
    await user.click(enlarge(1))
    expect(dialog()).toHaveAttribute('open')
    act(() => {
      history.back()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(dialog()).not.toHaveAttribute('open')
  })

  it('opens the figure a #figure-N link points at, without pushing another history entry', async () => {
    history.replaceState(null, '', '/blog/demo#figure-3')
    const before = history.length
    page()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(dialog()).toHaveAttribute('open')
    expect(within(dialog()).getByAltText('Shot 3')).toBeInTheDocument()
    expect(history.length).toBe(before)
  })

  it('steps to the next and previous figure in article order, replacing the hash, with the ends disabled', async () => {
    const user = userEvent.setup()
    page()
    await user.click(enlarge(1))
    const d = within(dialog())
    expect(d.getByRole('button', { name: 'Previous figure' })).toBeDisabled()
    await user.click(d.getByRole('button', { name: 'Next figure' }))
    expect(d.getByAltText('Shot 2')).toBeInTheDocument()
    expect(location.hash).toBe('#figure-2')
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' })
    expect(d.getByAltText('Shot 3')).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Next figure' })).toBeDisabled()
    fireEvent.keyDown(dialog(), { key: 'ArrowLeft' })
    expect(d.getByAltText('Shot 2')).toBeInTheDocument()
  })

  it('steps through carousel slides like any other figures', async () => {
    const user = userEvent.setup()
    page([fig(1), <Carousel key="c" label="Steps" steps={[{ title: 'A' }, { title: 'B' }]}>{[fig(2), fig(3)]}</Carousel>, fig(4)])
    await user.click(enlarge(1))
    const next = () => user.click(within(dialog()).getByRole('button', { name: 'Next figure' }))
    await next()
    expect(within(dialog()).getByAltText('Shot 2')).toBeInTheDocument()
    await next()
    expect(within(dialog()).getByAltText('Shot 3')).toBeInTheDocument()
    await next()
    expect(within(dialog()).getByAltText('Shot 4')).toBeInTheDocument()
  })

  it('toggles actual size', async () => {
    const user = userEvent.setup()
    page()
    await user.click(enlarge(1))
    const toggle = within(dialog()).getByRole('button', { name: /Actual size/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog()).getByAltText('Shot 1')).toHaveStyle({ width: '800px' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('locks page scrolling while open and restores it, and the scroll position, on close', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Object.defineProperty(window, 'scrollY', { value: 420, configurable: true })
    page()
    await user.click(enlarge(1))
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(document.body.style.overflow).toBe('')
    expect(scrollTo).toHaveBeenCalledWith({ top: 420, behavior: 'instant' })
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })

  it('does not morph with reduced motion (no view transition), and morphs when motion is allowed', async () => {
    const user = userEvent.setup()
    const start = vi.fn((cb: () => void) => {
      cb()
      return { finished: Promise.resolve() }
    })
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true })
    stubMedia({ '(prefers-reduced-motion: reduce)': true })
    page()
    await user.click(enlarge(1))
    expect(start).not.toHaveBeenCalled()
    expect(dialog()).toHaveAttribute('open')
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    stubMedia({ '(prefers-reduced-motion: reduce)': false })
    await user.click(enlarge(1))
    expect(start).toHaveBeenCalled()
    Reflect.deleteProperty(document, 'startViewTransition')
  })
})

describe('lens', () => {
  const FINE = { '(hover: hover) and (pointer: fine)': true }
  const lensEl = () => document.querySelector('div.fixed[aria-hidden="true"]') as HTMLElement

  it('is off by default: no toggle pressed, no magnified image, even when the pointer enters', () => {
    stubMedia(FINE)
    page()
    expect(screen.getAllByRole('button', { name: 'Magnifier' })[0]).toHaveAttribute('aria-pressed', 'false')
    fireEvent.pointerEnter(enlarge(1), { pointerType: 'mouse' })
    expect(lensEl().querySelector('img')).toBeNull()
  })

  it('toggles per figure with aria-pressed and does not turn on the other figures', async () => {
    const user = userEvent.setup()
    page()
    const [first, second] = screen.getAllByRole('button', { name: 'Magnifier' })
    await user.click(first)
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(second).toHaveAttribute('aria-pressed', 'false')
    await user.click(first)
    expect(first).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a magnified copy after a short rest on a toggled figure, and Escape turns it off', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stubMedia(FINE)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    page()
    const toggle = screen.getAllByRole('button', { name: 'Magnifier' })[0]
    await user.click(toggle)
    fireEvent.pointerEnter(enlarge(1), { pointerType: 'mouse', clientX: 10, clientY: 10 })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(lensEl().querySelector('img')).toHaveAttribute('src', '/blog/demo/s1.webp')
    expect(lensEl()).toHaveClass('pointer-events-none')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(lensEl().querySelector('img')).toBeNull()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    vi.useRealTimers()
  })

  it('never intercepts a click: the figure still opens the lightbox', async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getAllByRole('button', { name: 'Magnifier' })[0])
    await user.click(enlarge(1))
    expect(dialog()).toHaveAttribute('open')
  })

  it('shows no lens for touch or pen pointers, or on a device that cannot hover', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    stubMedia(FINE)
    page()
    await user.click(screen.getAllByRole('button', { name: 'Magnifier' })[0])
    fireEvent.pointerEnter(enlarge(1), { pointerType: 'touch' })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(lensEl().querySelector('img')).toBeNull()
    stubMedia({})
    fireEvent.pointerEnter(enlarge(1), { pointerType: 'mouse' })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(lensEl().querySelector('img')).toBeNull()
    vi.useRealTimers()
  })

  it('only shows the toggle on fine pointers (hidden class, shown at pointer-fine)', () => {
    page()
    expect(screen.getAllByRole('button', { name: 'Magnifier' })[0].closest('div.hidden')).toHaveClass('pointer-fine:flex')
  })

  describe('preferences', () => {
    it('default to a wide lens at 1.75x, and a stored choice is read back', () => {
      expect(DEFAULT_LENS_PREFS).toEqual({ shape: 'wide', zoom: 1.75 })
      writeLensPrefs({ shape: 'circle', zoom: 2.5 })
      expect(parseLensPrefs(readLensPrefsRaw())).toEqual({ shape: 'circle', zoom: 2.5 })
      expect(JSON.parse(localStorage.getItem(LENS_PREFS_KEY)!)).toEqual({ shape: 'circle', zoom: 2.5 })
    })

    it('fall back to the defaults, field by field, for junk', () => {
      expect(parseLensPrefs('not json')).toEqual(DEFAULT_LENS_PREFS)
      expect(parseLensPrefs(null)).toEqual(DEFAULT_LENS_PREFS)
      expect(parseLensPrefs('{"shape":"star","zoom":9}')).toEqual(DEFAULT_LENS_PREFS)
      expect(parseLensPrefs('{"shape":"panel","zoom":"x"}')).toEqual({ shape: 'panel', zoom: 1.75 })
    })

    it('fall back to the defaults when storage throws, on read and on write', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(readLensPrefsRaw()).toBeNull()
      expect(parseLensPrefs(readLensPrefsRaw())).toEqual(DEFAULT_LENS_PREFS)
      expect(() => writeLensPrefs({ shape: 'circle', zoom: 1.5 })).not.toThrow()
    })

    it('are chosen in the options menu and persisted', async () => {
      const user = userEvent.setup()
      page()
      await user.click(screen.getAllByRole('button', { name: 'Magnifier options' })[0])
      await user.click(await screen.findByRole('menuitemradio', { name: 'Circle' }))
      expect(JSON.parse(localStorage.getItem(LENS_PREFS_KEY)!).shape).toBe('circle')
    })

    it('offer the side panel only from 80rem', async () => {
      const user = userEvent.setup()
      page()
      await user.click(screen.getAllByRole('button', { name: 'Magnifier options' })[0])
      expect(screen.queryByRole('menuitemradio', { name: /panel/i })).toBeNull()
      await user.keyboard('{Escape}')
      stubMedia({ '(min-width: 80rem)': true })
      page()
      await user.click(screen.getAllByRole('button', { name: 'Magnifier options' }).at(-1)!)
      expect(await screen.findByRole('menuitemradio', { name: /panel/i })).toBeInTheDocument()
    })

    it('show a stored side panel as the wide lens on a narrow screen', async () => {
      writeLensPrefs({ shape: 'panel', zoom: 1.75 })
      const user = userEvent.setup()
      page()
      await user.click(screen.getAllByRole('button', { name: 'Magnifier options' })[0])
      expect(await screen.findByRole('menuitemradio', { name: /wide/i })).toBeChecked()
    })
  })
})

describe('carousel', () => {
  const steps = [{ title: 'Menu' }, { title: 'Merge' }, { title: 'Result' }]
  const mount = (dir: 'ltr' | 'rtl' = 'ltr') => {
    const view = render(
      <div dir={dir}>
        <Carousel label="Merge steps" steps={steps}>
          {[fig(1), fig(2), fig(3)]}
        </Carousel>
      </div>
    )
    return view
  }
  const status = () => screen.getByText(/^Slide \d of 3$/)

  it('has every slide in the HTML, labelled "n of N" (role description slide), and only the shown one is interactive', () => {
    const { container } = mount()
    const slides = container.querySelectorAll('[data-index]')
    expect(slides).toHaveLength(3)
    expect([...slides].map((s) => s.getAttribute('aria-label'))).toEqual(['1 of 3', '2 of 3', '3 of 3'])
    expect([...slides].map((s) => s.hasAttribute('inert'))).toEqual([false, true, true])
    expect(container.querySelectorAll('img')).toHaveLength(3)
  })

  it('disables the arrows at the ends and names the slide each goes to', async () => {
    const user = userEvent.setup()
    mount()
    const prev = () => screen.getByRole('button', { name: /^Previous slide/ })
    const next = () => screen.getByRole('button', { name: /^Next slide/ })
    expect(prev()).toBeDisabled()
    expect(next()).toHaveAccessibleName('Next slide: Merge')
    await user.click(next())
    expect(prev()).toHaveAccessibleName('Previous slide: Menu')
    expect(next()).toHaveAccessibleName('Next slide: Result')
    await user.click(next())
    expect(next()).toBeDisabled()
    expect(status()).toHaveTextContent('Slide 3 of 3')
  })

  it('announces the position in a polite live region and the dots are hidden, one per slide, with the active one following', async () => {
    const user = userEvent.setup()
    const { container } = mount()
    expect(status()).toHaveAttribute('aria-live', 'polite')
    const dots = container.querySelector('[data-carousel-dots]')!
    expect(dots).toHaveAttribute('aria-hidden', 'true')
    expect(dots.children).toHaveLength(3)
    const active = () => [...dots.children].map((d) => d.classList.contains('bg-primary'))
    expect(active()).toEqual([true, false, false])
    await user.click(screen.getByRole('button', { name: /^Next slide/ }))
    expect(active()).toEqual([false, true, false])
    expect(status()).toHaveTextContent('Slide 2 of 3')
  })

  it('moves with the arrow keys, mirrored in right-to-left pages, without going past the ends', async () => {
    const user = userEvent.setup()
    const { container } = mount()
    const section = container.querySelector('section')!
    fireEvent.keyDown(section, { key: 'ArrowLeft' })
    expect(status()).toHaveTextContent('Slide 1 of 3')
    fireEvent.keyDown(section, { key: 'ArrowRight' })
    expect(status()).toHaveTextContent('Slide 2 of 3')
    await user.keyboard('{Escape}')
    fireEvent.keyDown(section, { key: 'ArrowLeft' })
    expect(status()).toHaveTextContent('Slide 1 of 3')
  })

  it('reverses the arrow keys in right-to-left', () => {
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration)
    const { container } = mount('rtl')
    const section = container.querySelector('section')!
    fireEvent.keyDown(section, { key: 'ArrowLeft' })
    expect(status()).toHaveTextContent('Slide 2 of 3')
    fireEvent.keyDown(section, { key: 'ArrowRight' })
    expect(status()).toHaveTextContent('Slide 1 of 3')
    spy.mockRestore()
  })

  it('never advances on its own', () => {
    vi.useFakeTimers()
    mount()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(status()).toHaveTextContent('Slide 1 of 3')
    vi.useRealTimers()
  })

  it('names the carousel region by its label', () => {
    mount()
    expect(screen.getByRole('region', { name: 'Merge steps' })).toBeInTheDocument()
  })
})
