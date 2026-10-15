'use client'

import dynamic from 'next/dynamic'

// A client-side dynamic import, not an `await import()` in the server Navbar: Next's client
// manifest lists the chunks of every client module a server module can reach, so the latter
// would still ship the menu's Radix code to signed-out visitors. This way the chunk is
// requested only when a signed-in visitor's page actually renders the menu.
const AccountMenu = dynamic(() => import('@/components/layout/AccountMenu').then((m) => m.AccountMenu))

export function AccountMenuLoader(props: { email: string; initials?: string }) {
  return <AccountMenu {...props} />
}
