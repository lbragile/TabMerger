// Dev unpacked build ID, used when no published Chrome Web Store ID is configured.
const DEV_EXTENSION_ID = 'ogadhgghhdbaohdcajfakeogcamicdkm'

/**
 * Ordered, de-duplicated list of TabMerger extension IDs to target with
 * `chrome.runtime.sendMessage` — shared by every externally_connectable caller
 * (install probe, auth sync, sync-now trigger).
 *
 * Chrome, Brave, Vivaldi, Arc, Opera, and Edge-via-Chrome-Web-Store installs
 * all share the Chrome Web Store ID. An extension installed from the Edge
 * Add-ons store gets a *different* ID from the same source code, so it needs
 * its own entry — see `NEXT_PUBLIC_EDGE_EXTENSION_ID` in `.env.example`.
 *
 * The dev/unpacked ID is excluded only in production (`NODE_ENV === 'production'`)
 * so a real production deploy never probes for a build that can't exist there,
 * while local dev and the test environment (`NODE_ENV === 'test'`) still see it.
 */
export const EXTENSION_IDS: string[] = Array.from(
  new Set(
    [
      process.env.NEXT_PUBLIC_CHROME_EXTENSION_ID,
      process.env.NEXT_PUBLIC_EDGE_EXTENSION_ID,
      process.env.NODE_ENV !== 'production' ? DEV_EXTENSION_ID : undefined,
    ].filter((id): id is string => Boolean(id))
  )
)
