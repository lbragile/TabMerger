import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

// DemoSection is a server component: it stats the tour files under public/videos and hands
// the (cache-busted) URLs to DemoVideo. fs and DemoVideo are stubbed so the test controls
// which files "exist" and sees exactly what the player is given.
const { existsSync, statSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('node:fs', () => ({ default: { existsSync, statSync }, existsSync, statSync }))
vi.mock('@/components/marketing/DemoVideo', () => ({ DemoVideo: () => null }))

import { DemoSection } from '@/components/marketing/DemoSection'

const publicPath = (rel: string) => path.join(process.cwd(), 'public', rel)

describe('DemoSection', () => {
  beforeEach(() => {
    existsSync.mockReset()
    statSync.mockReset()
  })

  // The component is a plain function returning one element: its props are what DemoVideo gets.
  function propsFor() {
    const element = DemoSection() as unknown as { props: Record<string, string | null> }
    return element.props
  }

  it('passes the four tour assets with an mtime cache-buster when the files exist', () => {
    existsSync.mockReturnValue(true)
    statSync.mockImplementation((p: string) => ({ mtimeMs: p.includes('dark') ? 111 : 222 }))

    expect(propsFor()).toEqual({
      darkSrc: '/videos/tabmerger-tour-dark.mp4?v=111',
      lightSrc: '/videos/tabmerger-tour-light.mp4?v=222',
      darkPoster: '/videos/tour-poster-dark.jpg?v=111',
      lightPoster: '/videos/tour-poster-light.jpg?v=222',
    })
    expect(existsSync).toHaveBeenCalledWith(publicPath('videos/tabmerger-tour-dark.mp4'))
  })

  it('passes null for exactly the files that are missing (no stat on a missing file)', () => {
    existsSync.mockImplementation((p: string) => !p.includes('tabmerger-tour-dark.mp4') && !p.includes('poster-light'))
    statSync.mockReturnValue({ mtimeMs: 5 })

    expect(propsFor()).toEqual({
      darkSrc: null,
      lightSrc: '/videos/tabmerger-tour-light.mp4?v=5',
      darkPoster: '/videos/tour-poster-dark.jpg?v=5',
      lightPoster: null,
    })
    expect(statSync).toHaveBeenCalledTimes(2)
  })

  it('passes all nulls when no asset exists, so the player renders nothing', () => {
    existsSync.mockReturnValue(false)
    expect(propsFor()).toEqual({ darkSrc: null, lightSrc: null, darkPoster: null, lightPoster: null })
    expect(statSync).not.toHaveBeenCalled()
  })

  it('references the new tour files, not the deleted demo files', () => {
    existsSync.mockReturnValue(true)
    statSync.mockReturnValue({ mtimeMs: 1 })
    const joined = Object.values(propsFor()).join(' ')
    expect(joined).not.toContain('tabmerger-demo')
    expect(joined).not.toContain('demo-preview')
  })
})
