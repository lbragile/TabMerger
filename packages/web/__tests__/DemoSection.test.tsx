import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { DemoVideo } from '@/components/marketing/DemoVideo'

// ponytail: DemoSection itself is a server component that only stats files on
// disk (fs.existsSync/statSync) and hands plain string props to DemoVideo —
// the interesting theme/fallback logic lives in DemoVideo, so we test that
// directly instead of mounting a server component in RTL.

const mockUseTheme = vi.fn()
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => mockUseTheme(),
}))

afterEach(() => {
  cleanup()
  mockUseTheme.mockReset()
})

const SOURCES = {
  darkSrc: '/videos/tabmerger-tour-dark.mp4?v=1',
  lightSrc: '/videos/tabmerger-tour-light.mp4?v=1',
  darkPoster: '/videos/tour-poster-dark.jpg?v=1',
  lightPoster: '/videos/tour-poster-light.jpg?v=1',
}

describe('DemoVideo', () => {
  it('plays the dark video when resolved theme is dark', async () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo
        darkSrc="/videos/tabmerger-tour-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-tour-light.mp4?v=1"
        darkPoster="/videos/tour-poster-dark.jpg?v=1"
        lightPoster="/videos/tour-poster-light.jpg?v=1"
      />
    )

    // let the mount effect (which assigns `src`) settle
    await Promise.resolve()

    const video = container.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/videos/tabmerger-tour-dark.mp4?v=1')
  })

  it('plays the light video when resolved theme is light', async () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo
        darkSrc="/videos/tabmerger-tour-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-tour-light.mp4?v=1"
        darkPoster="/videos/tour-poster-dark.jpg?v=1"
        lightPoster="/videos/tour-poster-light.jpg?v=1"
      />
    )
    await Promise.resolve()

    const video = container.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/videos/tabmerger-tour-light.mp4?v=1')
    expect(video).toHaveProperty('autoplay', true)
    expect(video).toHaveProperty('loop', true)
    expect(video).toHaveProperty('muted', true)
    expect(video?.hasAttribute('playsinline')).toBe(true)
  })

  it('renders native controls for playback/speed/volume instead of a custom overlay', async () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo
        darkSrc="/videos/tabmerger-tour-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-tour-light.mp4?v=1"
        darkPoster="/videos/tour-poster-dark.jpg?v=1"
        lightPoster="/videos/tour-poster-light.jpg?v=1"
      />
    )
    await Promise.resolve()

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video.hasAttribute('controls')).toBe(true)
    expect(container.querySelectorAll('button').length).toBe(0)
  })

  it('preserves currentTime and play state when the theme swaps the video src', async () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const { container, rerender } = render(
      <DemoVideo
        darkSrc="/videos/tabmerger-tour-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-tour-light.mp4?v=1"
        darkPoster="/videos/tour-poster-dark.jpg?v=1"
        lightPoster="/videos/tour-poster-light.jpg?v=1"
      />
    )
    await Promise.resolve()

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video.getAttribute('src')).toBe('/videos/tabmerger-tour-light.mp4?v=1')

    // simulate mid-playback state before the theme flips
    video.currentTime = 42
    Object.defineProperty(video, 'paused', { value: false, configurable: true })
    const playSpy = vi.spyOn(video, 'play').mockResolvedValue()

    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    rerender(
      <DemoVideo
        darkSrc="/videos/tabmerger-tour-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-tour-light.mp4?v=1"
        darkPoster="/videos/tour-poster-dark.jpg?v=1"
        lightPoster="/videos/tour-poster-light.jpg?v=1"
      />
    )
    await Promise.resolve()

    // the video element itself must not be remounted (no key={src} reset)
    expect(container.querySelector('video')).toBe(video)
    expect(video.getAttribute('src')).toBe('/videos/tabmerger-tour-dark.mp4?v=1')

    // currentTime/play resume only once the new source is ready to seek
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(video.currentTime).toBe(42)
    expect(playSpy).toHaveBeenCalled()
  })

  it("uses the theme's own poster, and offers both to CSS so the first paint can pick by class", () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    const { container, rerender } = render(<DemoVideo {...SOURCES} />)

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video.getAttribute('poster')).toBe(SOURCES.darkPoster)

    const box = video.parentElement as HTMLElement
    expect(box.style.getPropertyValue('--tour-poster-dark')).toBe(`url("${SOURCES.darkPoster}")`)
    expect(box.style.getPropertyValue('--tour-poster-light')).toBe(`url("${SOURCES.lightPoster}")`)

    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    rerender(<DemoVideo {...SOURCES} />)
    expect(video.getAttribute('poster')).toBe(SOURCES.lightPoster)
  })

  it('sizes the player as a 16:9 box and gives the video an accessible name', () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const { container, getByLabelText } = render(<DemoVideo {...SOURCES} />)

    const video = getByLabelText('TabMerger feature tour video')
    expect(video.tagName).toBe('VIDEO')
    expect(video.parentElement?.className).toMatch(/\baspect-video\b/)
    expect(container.innerHTML).not.toContain('aspect-[4/3]')
  })

  it('sets the muted property itself, since autoplay is only allowed when muted', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    const { container } = render(<DemoVideo {...SOURCES} />)

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video.muted).toBe(true)
    expect(video.defaultMuted).toBe(true)
    expect(video.autoplay).toBe(true)
  })

  it('keeps the original position when the theme is toggled twice before the first swap loads', () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const { container, rerender } = render(<DemoVideo {...SOURCES} />)
    const video = container.querySelector('video') as HTMLVideoElement
    video.currentTime = 42

    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    rerender(<DemoVideo {...SOURCES} />)
    // the new source has not loaded yet: the element reports 0 until it has
    video.currentTime = 0

    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    rerender(<DemoVideo {...SOURCES} />)
    video.dispatchEvent(new Event('loadedmetadata'))

    expect(video.getAttribute('src')).toBe(SOURCES.lightSrc)
    expect(video.currentTime).toBe(42)
  })

  it('stays paused after a theme swap when the visitor had paused it', () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const { container, rerender } = render(<DemoVideo {...SOURCES} />)
    const video = container.querySelector('video') as HTMLVideoElement
    video.currentTime = 12
    // jsdom's `paused` is already true: nothing ever played
    const playSpy = vi.spyOn(video, 'play').mockResolvedValue()

    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    rerender(<DemoVideo {...SOURCES} />)
    // the autoplay attribute would restart a paused video on the new source
    expect(video.autoplay).toBe(false)

    video.dispatchEvent(new Event('loadedmetadata'))
    expect(video.currentTime).toBe(12)
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('sets muted before it assigns the source, so the browser is allowed to autoplay', () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const order: string[] = []
    const proto = HTMLMediaElement.prototype
    const srcDesc = Object.getOwnPropertyDescriptor(proto, 'src')!
    const spy = vi.spyOn(proto, 'src', 'set').mockImplementation(function (this: HTMLMediaElement, v: string) {
      order.push(`src:${this.muted}`)
      srcDesc.set!.call(this, v)
    })
    try {
      const { container } = render(<DemoVideo {...SOURCES} />)
      const video = container.querySelector('video') as HTMLVideoElement
      // muted was already true at the moment the source was assigned
      expect(order).toEqual(['src:true'])
      expect(video.autoplay).toBe(true)
      expect(video.loop).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  describe('theme swap keeps the viewing position', () => {
    function mount(startTheme: 'light' | 'dark') {
      mockUseTheme.mockReturnValue({ theme: startTheme, toggleTheme: vi.fn() })
      const utils = render(<DemoVideo {...SOURCES} />)
      const video = utils.container.querySelector('video') as HTMLVideoElement
      const playSpy = vi.spyOn(video, 'play').mockResolvedValue()
      const setPaused = (paused: boolean) =>
        Object.defineProperty(video, 'paused', { value: paused, configurable: true })
      const switchTo = (theme: 'light' | 'dark') => {
        mockUseTheme.mockReturnValue({ theme, toggleTheme: vi.fn() })
        utils.rerender(<DemoVideo {...SOURCES} />)
      }
      return { ...utils, video, playSpy, setPaused, switchTo }
    }

    it.each([
      ['light', 'dark'],
      ['dark', 'light'],
    ] as const)('%s to %s: same timestamp, still playing', (from, to) => {
      const { video, playSpy, setPaused, switchTo } = mount(from)
      video.currentTime = 37.5
      setPaused(false)

      switchTo(to)
      expect(video.getAttribute('src')).toBe(to === 'dark' ? SOURCES.darkSrc : SOURCES.lightSrc)
      // nothing is restored until the new source can seek
      expect(playSpy).not.toHaveBeenCalled()
      video.currentTime = 0
      video.dispatchEvent(new Event('loadedmetadata'))

      expect(video.currentTime).toBe(37.5)
      expect(video.autoplay).toBe(true)
      expect(playSpy).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['light', 'dark'],
      ['dark', 'light'],
    ] as const)('%s to %s: a paused video stays paused at the same timestamp', (from, to) => {
      const { video, playSpy, setPaused, switchTo } = mount(from)
      video.currentTime = 9
      setPaused(true)

      switchTo(to)
      video.currentTime = 0
      video.dispatchEvent(new Event('loadedmetadata'))

      expect(video.currentTime).toBe(9)
      expect(video.autoplay).toBe(false)
      expect(playSpy).not.toHaveBeenCalled()
    })

    it('keeps the mute state and volume the visitor chose, and the same element', () => {
      const { container, video, switchTo } = mount('light')
      video.muted = false
      video.volume = 0.3

      switchTo('dark')
      video.dispatchEvent(new Event('loadedmetadata'))
      expect(video.muted).toBe(false)
      expect(video.volume).toBe(0.3)

      video.muted = true
      switchTo('light')
      video.dispatchEvent(new Event('loadedmetadata'))
      expect(video.muted).toBe(true)
      expect(video.volume).toBe(0.3)
      expect(container.querySelectorAll('video')).toHaveLength(1)
      expect(container.querySelector('video')).toBe(video)
    })

    it('does nothing when a re-render keeps the same theme (no reload, no restart)', () => {
      const { video, playSpy, switchTo } = mount('light')
      video.currentTime = 20

      switchTo('light')

      expect(video.currentTime).toBe(20)
      expect(playSpy).not.toHaveBeenCalled()
      expect(video.getAttribute('src')).toBe(SOURCES.lightSrc)
    })

    it('shows the spinner again while the swapped-in source loads, then hides it when it plays', () => {
      const { video, switchTo, queryByTestId } = mount('light')
      fireEvent.playing(video)
      expect(queryByTestId('tour-video-spinner')).toBeNull()

      switchTo('dark')
      // a new source makes the browser emit loadstart
      fireEvent.loadStart(video)
      expect(queryByTestId('tour-video-spinner')).not.toBeNull()

      fireEvent.playing(video)
      expect(queryByTestId('tour-video-spinner')).toBeNull()
    })

    it('an error on the swapped-in source shows the message instead of the spinner', () => {
      const { video, switchTo, queryByTestId, getByRole } = mount('light')
      switchTo('dark')
      fireEvent.loadStart(video)
      fireEvent.error(video)

      expect(queryByTestId('tour-video-spinner')).toBeNull()
      expect(getByRole('status').textContent).toBe('The video could not be loaded.')
    })
  })

  describe('loading indicator', () => {
    function setup() {
      mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
      const utils = render(<DemoVideo {...SOURCES} />)
      const video = utils.container.querySelector('video') as HTMLVideoElement
      const spinner = () => utils.queryByTestId('tour-video-spinner')
      const setReadyState = (value: number) =>
        Object.defineProperty(video, 'readyState', { value, configurable: true })
      return { ...utils, video, spinner, setReadyState }
    }

    it('shows before the video can play, named for assistive tech, without blocking the controls', () => {
      const { spinner, getByRole } = setup()

      expect(spinner()).not.toBeNull()
      const status = getByRole('status')
      expect(status.textContent).toBe('Loading video')
      expect(status.className).toContain('pointer-events-none')
      expect(status.className).toContain('absolute')
      // the spin itself stops under prefers-reduced-motion
      expect(spinner()?.querySelector('svg')?.getAttribute('class')).toContain('motion-reduce:animate-none')
    })

    it.each(['canPlay', 'playing', 'seeked'] as const)('hides on %s', (event) => {
      const { video, spinner, getByRole } = setup()

      fireEvent[event](video)
      expect(spinner()).toBeNull()
      // the live region stays mounted, only its content goes
      expect(getByRole('status').textContent).toBe('')
    })

    it.each(['waiting', 'seeking', 'loadStart'] as const)('shows again on %s', (event) => {
      const { video, spinner } = setup()
      fireEvent.playing(video)
      expect(spinner()).toBeNull()

      fireEvent[event](video)
      expect(spinner()).not.toBeNull()
    })

    it('shows on stalled only when the video has run out of data', () => {
      const { video, spinner, setReadyState } = setup()
      fireEvent.playing(video)

      setReadyState(4)
      fireEvent.stalled(video)
      expect(spinner()).toBeNull()

      setReadyState(2)
      fireEvent.stalled(video)
      expect(spinner()).not.toBeNull()
    })

    it('hides once time advances with data in hand, even if no playing event followed', () => {
      const { video, spinner, setReadyState } = setup()

      setReadyState(2)
      fireEvent.timeUpdate(video)
      expect(spinner()).not.toBeNull()

      setReadyState(4)
      fireEvent.timeUpdate(video)
      expect(spinner()).toBeNull()
    })

    it('replaces the spinner with a message on error, and recovers when a new source loads', () => {
      const { video, spinner, getByRole } = setup()

      fireEvent.error(video)
      expect(spinner()).toBeNull()
      expect(getByRole('status').textContent).toBe('The video could not be loaded.')

      fireEvent.loadStart(video)
      expect(spinner()).not.toBeNull()
      fireEvent.playing(video)
      expect(getByRole('status').textContent).toBe('')
    })
  })

  it('falls back to the poster as a named image when the themed video file is missing', async () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    const { container, getByRole } = render(
      <DemoVideo darkSrc={null} lightSrc={null} darkPoster={SOURCES.darkPoster} lightPoster={null} />
    )
    await Promise.resolve()

    expect(container.querySelector('video')).toBeNull()
    const img = getByRole('img', { name: 'TabMerger feature tour preview' })
    expect(img.style.getPropertyValue('--tour-poster-dark')).toContain('tour-poster-dark.jpg')
  })

  it('renders nothing when neither the themed video nor its poster exists', async () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo darkSrc={null} lightSrc={null} darkPoster={null} lightPoster={null} />
    )
    await Promise.resolve()

    expect(container.firstChild).toBeNull()
  })
})
