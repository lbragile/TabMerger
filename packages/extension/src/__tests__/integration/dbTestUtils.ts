import { getDb } from '@/lib/localDb'

/** Clears every object store between tests so cases don't bleed into each other
 * while reusing the single cached `dbInstance` (avoids re-opening IndexedDB per test). */
export async function clearDb(): Promise<void> {
  const db = await getDb()
  await Promise.all(
    (['groups', 'groupsState', 'sessions', 'settings'] as const).map((store) => db.clear(store))
  )
}
