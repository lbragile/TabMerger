import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// ponytail: the demo page must never touch Supabase — assert no import even happens
vi.mock('@/lib/supabase/server', () => {
  throw new Error('ShareDemoPage must not import the Supabase server client')
})

import ShareDemoPage from '@/app/(marketing)/share/demo/page'

describe('ShareDemoPage — static /share/demo route', () => {
  it('renders fixture group names and tab titles without hitting Supabase', () => {
    render(<ShareDemoPage />)
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText(/GitHub/)).toBeInTheDocument()
    expect(screen.getByText(/MDN/)).toBeInTheDocument()
  })

  it('shows the read-only badge and install CTA', () => {
    render(<ShareDemoPage />)
    expect(screen.getByText(/shared collection/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /install free/i })).toBeInTheDocument()
  })

  it('shows a preview note about installing TabMerger for real links', () => {
    render(<ShareDemoPage />)
    expect(screen.getByText(/this is a preview/i)).toBeInTheDocument()
  })
})
