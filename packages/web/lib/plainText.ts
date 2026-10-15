/**
 * Removes characters that can disguise or break plain text placed into an email or a log: C0 and
 * C1 control characters (keeping tab and newline), DEL, and the bidirectional overrides/isolates
 * that can make text read differently from what it is. `\r\n` and lone `\r` become `\n`, and the
 * Unicode line/paragraph separators become `\n` too.
 *
 * A character loop rather than a regex: ESLint's `no-control-regex` forbids control characters in
 * regex literals, escaped or not.
 */
export function stripControlChars(value: string): string {
  const normalised = value.replace(/\r\n?/g, '\n')
  let out = ''
  for (const ch of normalised) {
    const code = ch.charCodeAt(0)
    if (ch === '\n' || ch === '\t') {
      out += ch
    } else if (code === 0x2028 || code === 0x2029) {
      out += '\n'
    } else if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0x200e ||
      code === 0x200f
    ) {
      continue
    } else {
      out += ch
    }
  }
  return out
}
