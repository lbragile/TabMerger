import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// AppLayout is an async server component — mock its data dependency so we
// can `await` and render the markup under test.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com' } } }),
    },
  }),
}))

// SyncIndicator is a client component that talks to Supabase directly —
// stub it out here since AppLayout tests only care about the shell markup.
// Includes `auth.onAuthStateChange` (with an unsubscribe handle) because
// SyncIndicator also mounts useSyncExtensionAuth, which subscribes and
// unsubscribes from auth state on mount/unmount.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [] }) }) }),
      }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  }),
}))

import AppLayout from '@/app/(app)/layout'

describe('AppLayout', () => {
  it('renders the theme toggle button next to the account menu', async () => {
    render(await AppLayout({ children: <div>content</div> }))
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument()
  })

  it('renders children and nav links', async () => {
    render(await AppLayout({ children: <div>content</div> }))
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeInTheDocument()
  })
})
