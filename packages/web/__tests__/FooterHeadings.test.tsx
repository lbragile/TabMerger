import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '@/components/layout/Footer'

// Pages have one h1 and then h2 sections. Footer headings one level deeper (h3) skipped a
// level on pages without their own h2, which Lighthouse reports as "heading order invalid".
describe('Footer headings', () => {
  it('are level 2, so they never skip a level after the page title', () => {
    render(<Footer />)
    const levels = screen.getAllByRole('heading').map((h) => h.tagName)
    expect(levels.length).toBeGreaterThan(0)
    expect(new Set(levels)).toEqual(new Set(['H2']))
  })
})
