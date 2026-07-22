import type { Group } from './types'

export interface Entitlement {
  tier: string
  sharing: boolean
}

/**
 * Creates a public share bundle by inserting the selected groups into the `shared_bundles` table.
 * Requires an active Supabase session (Pro entitlement). Returns the full share URL
 * (e.g. `https://tabmerger.app/share/<slug>`) for the caller to copy or display.
 */
export async function createSharedBundle(
  groupIds: string[],
  groups: Group[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: any,
  entitlements?: Entitlement
): Promise<string> {
  if (groupIds.length === 0) throw new Error('No groups selected')

  const { data: { session } } = await supabaseClient.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  if (entitlements && !entitlements.sharing) {
    throw new Error('Sharing requires a Pro upgrade — entitlement not met')
  }

  const selected = groups.filter((g) => groupIds.includes(g.id))

  const { data, error } = await supabaseClient
    .from('shared_bundles')
    .insert({ user_id: session.user.id, groups: selected })
    .select()
    .single()

  if (error) throw new Error(error.message)

  const base = import.meta.env.VITE_WEB_APP_URL ?? 'https://tabmerger.app'
  return `${base}/share/${data.slug}`
}
