/**
 * Pseudo-localization for layout stress tests (the dev/test-only `en-XA` locale).
 *
 * Every message keeps its ICU structure (placeholders, plurals, selects, rich-text tags) and
 * changes only its literal text: letters get accents, vowels are doubled (English grows by
 * about 35-40%, like German or Finnish copy would) and the whole message is wrapped in
 * `[ ]` so a cut-off string shows a missing bracket.
 */

const ACCENTED: Record<string, string> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ď', e: 'é', f: 'ƒ', g: 'ğ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ',
  m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ',
  y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ď', E: 'É', F: 'Ƒ', G: 'Ğ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ',
  M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ',
  Y: 'Ý', Z: 'Ž',
}
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U'])
/** ICU syntax characters that a leading apostrophe quotes. */
const QUOTABLE = new Set(['{', '}', '<', '>', '#', '|'])
const BRANCHING = new Set(['plural', 'select', 'selectordinal'])

function pseudoChar(ch: string): string {
  const accented = ACCENTED[ch] ?? ch
  return VOWELS.has(ch) ? accented + accented : accented
}

/** Index of the `}` closing the `{` just before `start`, counting nested braces. */
function closingBrace(msg: string, start: number): number {
  let depth = 1
  for (let i = start; i < msg.length; i++) {
    if (msg[i] === '{') depth++
    else if (msg[i] === '}' && --depth === 0) return i
  }
  return msg.length
}

/** Pseudo-localizes message text from `start` until an unmatched `}` (or the end). */
function transform(msg: string, start: number, inPlural: boolean): { out: string; end: number } {
  let out = ''
  let i = start
  while (i < msg.length) {
    const ch = msg[i]
    if (ch === '}') return { out, end: i }
    if (ch === "'" && QUOTABLE.has(msg[i + 1] ?? '')) {
      // A quoted literal: copied as is, apostrophes included.
      const close = msg.indexOf("'", i + 1)
      const stop = close === -1 ? msg.length : close + 1
      out += msg.slice(i, stop)
      i = stop
    } else if (ch === '<') {
      // A rich-text tag (<link>, </link>, <br/>): the tag name must not change.
      const close = msg.indexOf('>', i)
      const stop = close === -1 ? msg.length : close + 1
      out += msg.slice(i, stop)
      i = stop
    } else if (ch === '#' && inPlural) {
      out += ch
      i++
    } else if (ch === '{') {
      const { out: arg, end } = argument(msg, i + 1)
      out += arg
      i = end
    } else {
      out += pseudoChar(ch)
      i++
    }
  }
  return { out, end: i }
}

/** An ICU argument starting after its `{`; returns it with both braces and the index after `}`. */
function argument(msg: string, start: number): { out: string; end: number } {
  const header = /^\s*([^\s,{}]+)\s*(?:,\s*([a-z]+)\s*)?/i.exec(msg.slice(start))
  const type = header?.[2]
  if (!header || !type || !BRANCHING.has(type)) {
    // `{name}`, `{n, number}`, `{d, date, short}`: copied untouched.
    const close = closingBrace(msg, start)
    return { out: msg.slice(start - 1, close + 1), end: close + 1 }
  }
  let out = '{' + header[0]
  let i = start + header[0].length
  if (msg[i] === ',') {
    out += ','
    i++
  }
  // Options: `selector {message}` pairs until the argument's closing brace.
  while (i < msg.length && msg[i] !== '}') {
    if (msg[i] === '{') {
      const inner = transform(msg, i + 1, type !== 'select')
      out += '{' + inner.out + '}'
      i = inner.end + 1
    } else {
      out += msg[i]
      i++
    }
  }
  return { out: out + '}', end: i + 1 }
}

/** One message, pseudo-localized. */
export function pseudoLocalizeMessage(message: string): string {
  if (message === '') return message
  return `[${transform(message, 0, false).out}]`
}

export type MessageTree = { [key: string]: string | MessageTree }

/** A whole catalog, pseudo-localized; keys and nesting are unchanged. */
export function pseudoLocalize<T extends MessageTree>(messages: T): T {
  const out: MessageTree = {}
  for (const [key, value] of Object.entries(messages)) {
    out[key] = typeof value === 'string' ? pseudoLocalizeMessage(value) : pseudoLocalize(value)
  }
  return out as T
}
