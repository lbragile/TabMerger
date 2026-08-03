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

describe('DemoVideo', () => {
  it('plays the dark video when resolved theme is dark', async () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo
        darkSrc="/videos/tabmerger-demo-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-demo-light.mp4?v=1"
        previewSrc="/videos/demo-preview.jpg"
      />
    )

    // effect flips `mounted` to true — flush microtasks
    await Promise.resolve()

    const video = container.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/videos/tabmerger-demo-dark.mp4?v=1')
  })

  it('plays the light video when resolved theme is light', async () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo
        darkSrc="/videos/tabmerger-demo-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-demo-light.mp4?v=1"
        previewSrc="/videos/demo-preview.jpg"
      />
    )
    await Promise.resolve()

    const video = container.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/videos/tabmerger-demo-light.mp4?v=1')
    expect(video).toHaveProperty('autoplay', true)
    expect(video).toHaveProperty('loop', true)
    expect(video).toHaveProperty('muted', true)
    expect(video?.hasAttribute('playsinline')).toBe(true)
  })

  it('renders native controls for playback/speed/volume instead of a custom overlay', async () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo
        darkSrc="/videos/tabmerger-demo-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-demo-light.mp4?v=1"
        previewSrc="/videos/demo-preview.jpg"
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
        darkSrc="/videos/tabmerger-demo-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-demo-light.mp4?v=1"
        previewSrc="/videos/demo-preview.jpg"
      />
    )
    await Promise.resolve()

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video.getAttribute('src')).toBe('/videos/tabmerger-demo-light.mp4?v=1')

    // simulate mid-playback state before the theme flips
    video.currentTime = 42
    Object.defineProperty(video, 'paused', { value: false, configurable: true })
    const playSpy = vi.spyOn(video, 'play').mockResolvedValue()

    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    rerender(
      <DemoVideo
        darkSrc="/videos/tabmerger-demo-dark.mp4?v=1"
        lightSrc="/videos/tabmerger-demo-light.mp4?v=1"
        previewSrc="/videos/demo-preview.jpg"
      />
    )
    await Promise.resolve()

    // the video element itself must not be remounted (no key={src} reset)
    expect(container.querySelector('video')).toBe(video)
    expect(video.getAttribute('src')).toBe('/videos/tabmerger-demo-dark.mp4?v=1')

    // currentTime/play resume only once the new source is ready to seek
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(video.currentTime).toBe(42)
    expect(playSpy).toHaveBeenCalled()
  })

  it('falls back to the preview image when the themed video file is missing', async () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo darkSrc={null} lightSrc={null} previewSrc="/videos/demo-preview.jpg" />
    )
    await Promise.resolve()

    expect(container.querySelector('video')).toBeNull()
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toContain('demo-preview.jpg')
  })

  it('renders nothing when neither the themed video nor a preview image exists', async () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    const { container } = render(
      <DemoVideo darkSrc={null} lightSrc={null} previewSrc={null} />
    )
    await Promise.resolve()

    expect(container.firstChild).toBeNull()
  })
})
