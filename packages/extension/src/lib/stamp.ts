/**
 * Server timestamps (`updated_at`) as INSTANTS. PostgREST and Realtime may spell the same moment
 * differently (`T` vs a space, `Z` vs `+00:00` vs `+00`, trailing zeros, no fraction), and `Date`
 * drops microseconds, so the stamp is parsed by hand into integer microseconds since the epoch
 * (about 1.8e15, which a double holds exactly). Always SEND the raw stored string to
 * `.eq('updated_at', …)`; only COMPARE through these helpers.
 */
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?(\d{2}))?)?$/i;

function toMicros(stamp: string): number | null {
  const m = STAMP_RE.exec(stamp.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac = '', zone, zoneMinutes = '0'] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const micros = +(frac + '000000').slice(0, 6);
  let offsetMinutes = 0;
  if (zone && zone.toUpperCase() !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    offsetMinutes = sign * (+zone.slice(1, 3) * 60 + +zoneMinutes);
  }
  return (ms - offsetMinutes * 60_000) * 1000 + micros;
}

/** <0, 0, >0 like a comparator. An unparseable stamp only equals the identical string. */
export function compareStamps(a: string, b: string): number {
  const x = toMicros(a);
  const y = toMicros(b);
  if (x === null || y === null) return a === b ? 0 : a < b ? -1 : 1;
  return x === y ? 0 : x < y ? -1 : 1;
}

export function sameStamp(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return compareStamps(a, b) === 0;
}
