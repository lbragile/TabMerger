'use server'

import { trackUninstall } from '@/lib/uninstallTracking'

/**
 * Server action behind `UninstallTracker`: records the `extension_uninstalled` event for the
 * uninstall page's query values. Callable by anyone with any argument, so `trackUninstall`
 * re-checks every value against the allow-lists; nothing is returned to the caller.
 */
export async function recordUninstall(raw: unknown): Promise<void> {
  await trackUninstall(raw)
}
