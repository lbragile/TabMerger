/**
 * Messages the website sends to the extension, and the extension's replies. Shared so both
 * sides of the boundary use the same strings: a typo in either copy would fail silently.
 */
export const EXTENSION_MESSAGE = {
  /** Website → extension: "are you installed?" */
  PING: 'PING',
  /** Extension → website: reply to PING. */
  PONG: 'PONG',
  /** Website → extension: hand over the website's Supabase session. */
  SYNC_AUTH: 'SYNC_AUTH',
  /** Website → extension: run a sync now. */
  SYNC_NOW: 'SYNC_NOW',
} as const;

export type ExtensionMessageType = (typeof EXTENSION_MESSAGE)[keyof typeof EXTENSION_MESSAGE];

/** The message types the website may send (and the Firefox relay may forward). */
export const WEBSITE_TO_EXTENSION_TYPES: readonly ExtensionMessageType[] = [
  EXTENSION_MESSAGE.PING,
  EXTENSION_MESSAGE.SYNC_AUTH,
  EXTENSION_MESSAGE.SYNC_NOW,
];

/**
 * The Firefox-only `window.postMessage` relay (Firefox has no `externally_connectable` for web
 * pages). Every message carries a `source` tag so each side ignores everything else on the page.
 */
export const WEB_BRIDGE = {
  /** `source` on messages the website posts to the relay. */
  WEBSITE_SOURCE: 'tabmerger-web',
  /** `source` on messages the relay posts back to the website. */
  EXTENSION_SOURCE: 'tabmerger-extension',
  /** Posted once by the relay when it loads, so the website can detect it without a request. */
  READY: 'READY',
} as const;
