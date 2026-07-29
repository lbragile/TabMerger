import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DemoSection } from '@/components/marketing/DemoSection'

describe('DemoSection', () => {
  it('renders a looped, autoplaying, muted video pointing at the demo asset', () => {
    const { container } = render(<DemoSection />)
    const video = container.querySelector('video')

    expect(video).not.toBeNull()
    // Cache-busted via a ?v= mtime query param — assert the asset identity
    // and that a version param is present, not an exact value.
    expect(video?.getAttribute('src')).toMatch(/tabmerger-demo\.mp4\?v=[\d.]+$/)
    expect(video).toHaveProperty('autoplay', true)
    expect(video).toHaveProperty('loop', true)
    expect(video).toHaveProperty('muted', true)
    expect(video?.hasAttribute('playsinline')).toBe(true)
  })
})
