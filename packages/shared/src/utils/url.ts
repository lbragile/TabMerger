/**
 * URL checks shared by the extension and the web app for values that come from
 * users or from stored data (saved tabs, shared bundles) before they are opened
 * or rendered as links.
 */

/** Schemes that run or embed content in the opening page instead of navigating to a site. */
const SCRIPT_SCHEMES: readonly string[] = ['javascript:', 'data:', 'vbscript:', 'blob:'];

const SCHEME_RE = /^([a-z][a-z0-9+.-]*:)/i;

/**
 * Returns the normalised absolute URL when `value` is an http(s) URL, otherwise
 * `undefined`. Relative strings, other schemes (`javascript:`, `data:`, `file:`,
 * `chrome:` and so on), empty values and non-strings all return `undefined`.
 *
 * The result is the parsed form (`https://example.com` becomes
 * `https://example.com/`), so use the return value, not the input.
 */
export function toHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when `url` uses a `javascript:`, `data:`, `vbscript:` or `blob:` scheme.
 *
 * Matches the way browsers read a scheme: case-insensitive, leading whitespace
 * and control characters ignored, and ASCII tab, CR and LF ignored wherever they
 * appear (`java\tscript:` is `javascript:`). Relative strings, empty values and
 * non-strings return false.
 */
export function isScriptUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const withoutBreaks = url.replace(/[\t\n\r]/g, '');
  let start = 0;
  while (start < withoutBreaks.length && withoutBreaks.charCodeAt(start) <= 0x20) start++;
  const cleaned = withoutBreaks.slice(start);
  if (!cleaned) return false;

  let scheme: string | undefined;
  try {
    scheme = new URL(cleaned).protocol;
  } catch {
    scheme = SCHEME_RE.exec(cleaned)?.[1];
  }
  return scheme !== undefined && SCRIPT_SCHEMES.includes(scheme.toLowerCase());
}
