import { WEBSITE_TO_EXTENSION_TYPES, type ExtensionMessageType } from '@tabmerger/shared';

/**
 * Longest session token the web bridge accepts. Supabase access tokens are JWTs of one to a few
 * thousand characters and refresh tokens are short; anything far beyond that is not a token.
 */
export const MAX_BRIDGE_TOKEN_LENGTH = 16_384;

/** A message from the web app, after its runtime check. */
export interface BridgeMessage {
  type: ExtensionMessageType;
  accessToken?: string;
  refreshToken?: string;
}

function tokenOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_BRIDGE_TOKEN_LENGTH ? value : undefined;
}

/**
 * Runtime check for a message that reached the background script from the web app
 * (`externally_connectable`, or the Firefox relay content script). Returns `null` unless the
 * message is an object whose `type` is one of the types the website may send. The token fields
 * are kept only when they are non-empty strings of bounded length; nothing else is copied.
 */
export function parseBridgeMessage(msg: unknown): BridgeMessage | null {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null;
  const { type, accessToken, refreshToken } = msg as Record<string, unknown>;
  if (typeof type !== 'string' || !(WEBSITE_TO_EXTENSION_TYPES as readonly string[]).includes(type)) return null;
  const parsed: BridgeMessage = { type: type as ExtensionMessageType };
  const access = tokenOrUndefined(accessToken);
  const refresh = tokenOrUndefined(refreshToken);
  if (access) parsed.accessToken = access;
  if (refresh) parsed.refreshToken = refresh;
  return parsed;
}
