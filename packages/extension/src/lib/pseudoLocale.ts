/**
 * Pseudo-locale for layout stress testing, development builds only.
 *
 * `pnpm --filter @tabmerger/extension build:dev:pseudo` builds the development extension with the
 * UI shown in a generated `en-XA` catalog: letters accented and every string padded by about 35%
 * inside brackets ("Undo" becomes "[Ûñðö]", "Select items" "[Šéļéçţ îţéɱš···]"). Accents show any
 * string that skipped the catalog (it stays plain ASCII), the padding shows what a longer language
 * does to the fixed 800×600 popup, and the brackets show where text is cut off.
 *
 * Only `initI18n` uses this, behind `import.meta.env.DEV`, so beta, demo and production bundles
 * leave it out.
 */

/** The generated locale's tag (Chromium's own pseudo-locale for long text). */
export const PSEUDO_LOCALE = 'en-XA';

/** Interpolations and `<Trans>` tags a translation keeps verbatim: `{{name}}`, `<0>`, `</strong>`, `<br/>`. */
const TOKEN_RE = /(\{\{[^}]+\}\}|<\/?[A-Za-z0-9]+\s*\/?>)/;

/** Padding added on top of the original length, brackets included (about what German adds). */
const PAD_RATIO = 0.35;

const ACCENTED: Record<string, string> = {
    a: 'à', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
    n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
    A: 'À', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
    N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

/** One string: letters accented, tokens kept, then padded inside brackets. */
export function pseudoLocalizeText(text: string): string {
    let visible = 0;
    const body = text
        .split(TOKEN_RE)
        .map((part, i) => {
            // split() with a capture group puts the tokens at the odd indexes
            if (i % 2 === 1) return part;
            visible += part.length;
            return part.replace(/[A-Za-z]/g, (ch) => ACCENTED[ch] ?? ch);
        })
        .join('');
    const filler = Math.max(0, Math.ceil(visible * PAD_RATIO) - 2);
    // In runs of at most 8 with a space between, so long text can still wrap like a real language
    const padding = Array.from({ length: Math.ceil(filler / 8) }, (_, i) => '·'.repeat(Math.min(8, filler - i * 8))).join(' ');
    return `[${body}${padding}]`;
}

/** The whole catalog, every string value rewritten, keys and nesting unchanged. */
export function pseudoLocalizeCatalog<T>(catalog: T): T {
    if (typeof catalog === 'string') return pseudoLocalizeText(catalog) as T;
    if (catalog && typeof catalog === 'object') {
        return Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, pseudoLocalizeCatalog(v)])) as T;
    }
    return catalog;
}
