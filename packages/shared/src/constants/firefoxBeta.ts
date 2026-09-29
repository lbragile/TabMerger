/**
 * Where the self-distributed (unlisted) Firefox beta add-on is served from. CI uploads the
 * signed files to Vercel Blob under `FIREFOX_BETA.PATH`, and the web app forwards the same path
 * on its own domain to that store. The beta build's `gecko.update_url` points at
 * `<web app URL><PATH>/<UPDATES_FILE>`, so these names must never drift between the
 * extension, the web app and CI.
 */
export const FIREFOX_BETA = {
  /** URL path on the web app, and the Blob pathname prefix (no trailing slash). */
  PATH: '/firefox-beta',
  /** Firefox's update manifest, overwritten on every beta release. */
  UPDATES_FILE: 'updates.json',
  /** Always the newest signed build: what the /beta page's install link points at. */
  LATEST_XPI_FILE: 'tabmerger-beta.xpi',
  /** Content type that makes Firefox offer to install a linked `.xpi` directly. */
  XPI_CONTENT_TYPE: 'application/x-xpinstall',
} as const;

/** The versioned file name a given beta build is uploaded as (kept so `updates.json` can pin it). */
export function firefoxBetaXpiFileName(version: string): string {
  return `tabmerger-beta-${version}.xpi`;
}
