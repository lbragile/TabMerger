/**
 * Shared rgba()/hex conversion helpers for group colours. Group colours are stored as
 * `rgba(R, G, B, 1)` strings (see `PRESET_COLORS` in `lib/types.ts`) — colours are always
 * fully opaque, so every helper here normalises to `a: 1` regardless of what it's given
 * (including any legacy/imported data that happens to carry a different alpha — that's
 * treated as its opaque RGB, never a crash).
 */

export interface RgbParts {
  r: number;
  g: number;
  b: number;
}

/** Parse an `rgb(a)?(...)` string into its R/G/B parts. Any alpha channel present is ignored. */
export function parseRgba(rgba: string): RgbParts {
  const match = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/);
  if (!match) return { r: 128, g: 128, b: 128 };
  const [, r, g, b] = match;
  return { r: parseInt(r, 10), g: parseInt(g, 10), b: parseInt(b, 10) };
}

/** Format parts back into the project's canonical, always-opaque `rgba(R, G, B, 1)` string. */
export function formatRgba({ r, g, b }: RgbParts): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 1)`;
}

/** True for 3- or 6-digit hex colours (`#rgb`, `#rrggbb`). */
export function isValidHexColor(hex: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);
}

/** Convert a 3- or 6-digit hex colour to the project's rgba() format (always opaque). */
export function hexToRgba(hex: string): string {
  const stripped = hex.startsWith('#') ? hex.slice(1) : hex;
  const full = stripped.length === 3 ? [...stripped].map((c) => c + c).join('') : stripped;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return formatRgba({ r, g, b });
}

/** Convert an rgba() string to a plain 6-digit hex, ignoring any alpha channel. */
export function rgbaToHex(rgba: string): string {
  const { r, g, b } = parseRgba(rgba);
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
