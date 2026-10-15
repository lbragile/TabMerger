import type { ReactNode } from 'react'
import Image from 'next/image'
import { ShellLink } from './ErrorPageShell'

/**
 * A minimal header for error pages that render above every layout (the root `error.tsx` and
 * `global-error.tsx`), where the marketing Navbar isn't available: it's an async server component,
 * and when the root layout has failed it may be what broke.
 */
export function ErrorHeader({ plainLinks = false, end }: { plainLinks?: boolean; end?: ReactNode }) {
  return (
    <header className="flex h-16 w-full items-center border-b border-border bg-background">
      <div className="container flex items-center justify-between gap-3 px-4 sm:px-8">
        <ShellLink
          href="/"
          plain={plainLinks}
          className="flex shrink-0 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Image src="/logo.png" alt="" width={26} height={26} className="shrink-0 rounded-md" />
          <span className="text-[0.9375rem] font-semibold tracking-tight">TabMerger</span>
        </ShellLink>
        {end}
      </div>
    </header>
  )
}
