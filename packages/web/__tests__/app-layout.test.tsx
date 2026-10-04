import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// AppLayout is an async server component — mock its data dependency so we
// can `await` and render the markup under test.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com' } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              single: async () => ({ data: { tier: 'pro', status: 'active' } }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

// SyncIndicator is a client component that talks to Supabase directly —
// stub it out here since AppLayout tests only care about the shell markup.
// Includes `auth.onAuthStateChange` (with an unsubscribe handle) because
// SyncIndicator also mounts useSyncExtensionAuth, which subscribes and
// unsubscribes from auth state on mount/unmount. `auth.getSession` and
// `realtime.setAuth` are there because the realtime channel is subscribed
// only after the user's token is on the realtime client.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
    },
    realtime: { setAuth: () => Promise.resolve() },
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

  it('renders the SyncIndicator for an entitled Pro account', async () => {
    render(await AppLayout({ children: <div>content</div> }))
    expect(screen.getByRole('button', { name: 'Refresh sync status' })).toBeInTheDocument()
  })
})

describe('AppLayout — free account', () => {
  it('hides the SyncIndicator for a free account', async () => {
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com' } } }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  single: async () => ({ data: { tier: 'free', status: null } }),
                }),
              }),
            }),
          }),
        }),
      }),
    }))
    vi.resetModules()
    const { default: FreshAppLayout } = await import('@/app/(app)/layout')
    render(await FreshAppLayout({ children: <div>content</div> }))
    expect(screen.queryByRole('button', { name: 'Refresh sync status' })).not.toBeInTheDocument()
  })
})
