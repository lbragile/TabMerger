// Dev unpacked build ID, used when no published Chrome Web Store ID is configured.
const DEV_EXTENSION_ID = 'ogadhgghhdbaohdcajfakeogcamicdkm'

/** The TabMerger extension id to target with `chrome.runtime.sendMessage` — shared by
 * every externally_connectable caller (install probe, sync-now trigger) so the
 * prod-id-vs-dev-id fallback logic lives in exactly one place. */
export const EXTENSION_ID = process.env.NEXT_PUBLIC_CHROME_EXTENSION_ID || DEV_EXTENSION_ID
