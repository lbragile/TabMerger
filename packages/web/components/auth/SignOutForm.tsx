'use client'

import type { ComponentProps } from 'react'
import { clearAllCachedDataKeys } from '@/lib/encryption/cachedKeys'

/**
 * Wraps the plain `/api/auth/sign-out` POST form so the cached encryption
 * data key (sessionStorage, see `lib/encryption/cachedKeys.ts`) is wiped before
 * the browser navigates away — otherwise it would linger in the tab and could
 * be picked up if another account signs in in the same tab.
 *
 * Every other prop is passed on to the <form>. That matters under Radix's `asChild`
 * (the account menu's "Sign out" item): the item hands its role, focus and pointer
 * handlers and ref to its child, and a child that drops them is not a menu item, so it
 * never highlights on hover or from the keyboard. The action and method stay fixed.
 */
export function SignOutForm({ onSubmit, ...props }: Omit<ComponentProps<'form'>, 'action' | 'method'>) {
  return (
    <form
      {...props}
      action="/api/auth/sign-out"
      method="POST"
      onSubmit={(event) => {
        clearAllCachedDataKeys()
        onSubmit?.(event)
      }}
    />
  )
}
