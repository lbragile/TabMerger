import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Hero } from '@/components/marketing/Hero'

describe('Hero', () => {
  it('renders the looped demo video instead of the interactive mock', () => {
    const { container } = render(<Hero />)

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toMatch(/tabmerger-demo\.mp4\?v=[\d.]+$/)
  })

  it('lays out the two-column grid responsively (single column on mobile)', () => {
    // The two-column layout must collapse to one column below `md` — a bare inline
    // `gridTemplateColumns: '5fr 6fr'` has no mobile fallback and causes overflow/squish.
    const { container } = render(<Hero />)

    const gridEl = container.querySelector('.grid') as HTMLElement | null
    expect(gridEl).not.toBeNull()

    // No unconditional fixed-column inline style — that's the pre-fix pattern with no breakpoint.
    expect(gridEl?.style.gridTemplateColumns).toBeFalsy()

    // A Tailwind responsive grid-column class (e.g. md:grid-cols-[5fr_6fr]) must gate the
    // multi-column layout so mobile viewports render a single column by default.
    expect(gridEl?.className).toMatch(/\bmd:grid-cols-/)
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
