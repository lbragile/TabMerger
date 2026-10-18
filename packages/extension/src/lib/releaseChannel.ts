/**
 * Release channel of this build. Beta store builds are `wxt zip --mode beta` (the same mode
 * `wxt.config.ts` keys the "TabMerger BETA" name and the beta store IDs off); every other build,
 * development included, reports `stable`. Shared by the uninstall-survey URL and the daily
 * heartbeat, so GA4's `channel` dimension means the same thing on both events.
 */
export function releaseChannel(): 'stable' | 'beta' {
  return import.meta.env.MODE === 'beta' ? 'beta' : 'stable';
}
