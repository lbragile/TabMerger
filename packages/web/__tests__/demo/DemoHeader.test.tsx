import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DemoHeader } from '@/components/marketing/demo/DemoHeader'

describe('DemoHeader', () => {
  it('renders the TabMerger name', () => {
    render(<DemoHeader />)
    expect(screen.getByText('TabMerger')).toBeInTheDocument()
  })

  it('renders a disabled search input', () => {
    render(<DemoHeader />)
    const input = screen.getByPlaceholderText(/search tabs and groups/i)
    expect(input).toBeDisabled()
  })

  it('does not render macOS traffic-light dots', () => {
    const { container } = render(<DemoHeader />)
    expect(container.querySelector('.bg-red-400')).not.toBeInTheDocument()
  })
})
