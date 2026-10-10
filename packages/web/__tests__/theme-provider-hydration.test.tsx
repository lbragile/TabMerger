import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { DemoVideo } from '@/components/marketing/DemoVideo'

// The hydration commit carries the SERVER theme ('light'). The inline script in
// app/layout.tsx has already put the visitor's real theme on <html> before React runs, so
// the provider must not touch the class on that commit, and the hero video must not be
// handed the light source first. RTL's render() is a client render and cannot show this:
// it needs real server-rendered markup + hydrateRoot.

const SOURCES = {
  darkSrc: '/videos/tabmerger-tour-dark.mp4?v=1',
  lightSrc: '/videos/tabmerger-tour-light.mp4?v=1',
  darkPoster: '/videos/tour-poster-dark.jpg?v=1',
  lightPoster: '/videos/tour-poster-light.jpg?v=1',
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

function Toggle() {
  const { toggleTheme } = useTheme()
  return <button onClick={toggleTheme}>toggle</button>
}

const App = () => (
  <ThemeProvider>
    <Toggle />
    <DemoVideo {...SOURCES} />
  </ThemeProvider>
)

describe('ThemeProvider hydration', () => {
  let container: HTMLDivElement
  let root: Root | undefined
  let srcWrites: string[]
  let classLog: boolean[]

  beforeEach(() => {
    localStorage.clear()
    mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

    // Record every `src` assignment on any media element, and every change of the dark class.
    srcWrites = []
    const proto = HTMLMediaElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'src')
    vi.spyOn(proto, 'src', 'set').mockImplementation(function (this: HTMLMediaElement, v: string) {
      srcWrites.push(v)
      desc?.set?.call(this, v)
    })
    // classList.toggle is spied (not a MutationObserver, whose batched callback would only see
    // the final state): a momentary removal followed by a re-add must still be caught.
    classLog = []
    const toggle = DOMTokenList.prototype.toggle
    vi.spyOn(DOMTokenList.prototype, 'toggle').mockImplementation(function (this: DOMTokenList, t: string, force?: boolean) {
      if (t === 'dark') classLog.push(force ?? !this.contains('dark'))
      return toggle.call(this, t, force)
    })

    // Server markup is produced with the server snapshot, as the real server would.
    const serverHtml = renderToString(<App />)
    container = document.createElement('div')
    container.innerHTML = serverHtml
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
    vi.restoreAllMocks()
    document.documentElement.classList.remove('dark')
  })

  async function hydrate() {
    await act(async () => {
      root = hydrateRoot(container, <App />)
    })
    await act(async () => {})
  }

  it('server markup names no video source (the theme is unknown on the server)', () => {
    expect(container.querySelector('video')?.getAttribute('src')).toBeNull()
  })

  it('keeps the dark class on <html> through hydration for a dark visitor, and loads only the dark video', async () => {
    localStorage.setItem('theme', 'dark')
    // what the layout's inline script does before first paint
    document.documentElement.classList.add('dark')
    classLog = []

    await hydrate()

    expect(classLog).not.toContain(false)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(srcWrites).toEqual([SOURCES.darkSrc])
    expect(container.querySelector('video')?.getAttribute('poster')).toBe(SOURCES.darkPoster)
  })

  it('loads only the light video for a light visitor and leaves the class off', async () => {
    await hydrate()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(srcWrites).toEqual([SOURCES.lightSrc])
  })

  it('still applies theme changes after hydration (class and video source)', async () => {
    await hydrate()
    const button = container.querySelector('button') as HTMLButtonElement

    await act(async () => button.click())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(srcWrites).toEqual([SOURCES.lightSrc, SOURCES.darkSrc])

    await act(async () => button.click())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(srcWrites).toEqual([SOURCES.lightSrc, SOURCES.darkSrc, SOURCES.lightSrc])
  })
})
