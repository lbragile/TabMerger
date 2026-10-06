'use client'

import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEncryptionKey } from '@/lib/encryption/context'

/** Why an item shows as "(locked)" although the passphrase in this tab is the account's current one. */
export const LOCKED_ITEM_NOTE = {
  item: 'Saved with an earlier passphrase. Open the extension on the device that has it and let it sync.',
  device: 'Its open tabs were saved with an earlier passphrase. Open the extension on that device and let it sync.',
} as const

/** Shown instead while the key could not be compared with the account's key row (the lookup failed). */
export const LOCKED_ITEM_UNVERIFIED_NOTE = "Can't be read right now. Reload the page to try again."

/**
 * The reason a single group, session or device row cannot be read, shown inside that item: a lock
 * icon plus plain visible text (no hover needed, no colour-only signal). Give it an `id` and point
 * the item's disabled controls at it with `aria-describedby`.
 *
 * It only blames an earlier passphrase once the key is verified (`keyVerified`): before that, a
 * row that fails to decrypt may mean the key in this tab is the stale one.
 */
export function LockedItemNote({
  id,
  kind = 'item',
  className,
}: {
  id?: string
  kind?: keyof typeof LOCKED_ITEM_NOTE
  className?: string
}) {
  const { keyVerified } = useEncryptionKey()
  return (
    <p id={id} className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', className)}>
      <Lock aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="min-w-0">{keyVerified ? LOCKED_ITEM_NOTE[kind] : LOCKED_ITEM_UNVERIFIED_NOTE}</span>
    </p>
  )
}
