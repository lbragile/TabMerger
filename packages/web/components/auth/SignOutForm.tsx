'use client'

import { clearAllCachedDataKeys } from '@/lib/encryption/context'

/**
 * Wraps the plain `/api/auth/sign-out` POST form so the cached encryption
 * data key (sessionStorage, see `lib/encryption/context.tsx`) is wiped before
 * the browser navigates away — otherwise it would linger in the tab and could
 * be picked up if another account signs in in the same tab.
 */
export function SignOutForm({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <form
      action="/api/auth/sign-out"
      method="POST"
      className={className}
      onSubmit={() => clearAllCachedDataKeys()}
    >
      {children}
    </form>
  )
}
