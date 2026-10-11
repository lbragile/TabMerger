import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Hero } from '@/components/marketing/Hero'

describe('Hero', () => {
  it('renders the feature-tour video instead of the interactive mock', () => {
    // ponytail: theme/fallback selection logic is covered directly in
    // DemoSection.test.tsx — this just asserts Hero mounts a video (the
    // themed renders are present on disk in this checkout, default theme is
    // light) instead of the old interactive mock UI.
    const { container } = render(<Hero />)

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toMatch(/tabmerger-tour-light\.mp4\?v=[\d.]+$/)
  })

  it('lays out the two-column grid responsively (single column on mobile)', () => {
    // The two-column layout must collapse to one column below `lg` — a bare inline
    // `gridTemplateColumns: '5fr 6fr'` has no mobile fallback and causes overflow/squish.
    const { container } = render(<Hero />)

    const gridEl = container.querySelector('.grid') as HTMLElement | null
    expect(gridEl).not.toBeNull()

    // No unconditional fixed-column inline style — that's the pre-fix pattern with no breakpoint.
    expect(gridEl?.style.gridTemplateColumns).toBeFalsy()

    // A Tailwind responsive grid-column class must gate the multi-column layout so mobile
    // and tablet viewports render a single column by default. It is `lg`, not `md`: half a
    // tablet-width row is too narrow for the 16:9 tour video, so it stacks under the copy.
    expect(gridEl?.className).toMatch(/\bgrid-cols-1\b/)
    expect(gridEl?.className).toMatch(/\blg:grid-cols-/)
    expect(gridEl?.className).not.toMatch(/\bmd:grid-cols-/)
  })

  it('uses a responsive heading size instead of a fixed 52px inline style', () => {
    const { container } = render(<Hero />)
    const heading = container.querySelector('h1') as HTMLElement | null
    expect(heading).not.toBeNull()

    // Fixed pixel font-size has no mobile scaling — should be removed in favor of
    // Tailwind responsive text-size classes (e.g. text-4xl md:text-6xl).
    expect(heading?.style.fontSize).toBeFalsy()
    expect(heading?.className).toMatch(/\bmd:text-/)
  })
})
