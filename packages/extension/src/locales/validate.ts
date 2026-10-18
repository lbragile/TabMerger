/**
 * Checks a translated catalog against the English one (used by the catalog unit test, never
 * bundled): same keys, same `{{placeholders}}`, same `<Trans>` tags, and exactly the plural forms
 * the language has (`Intl.PluralRules`: `one`/`other` for English, `one`/`few`/`many`/`other` for
 * Polish, ...). An empty catalog check is how a new language is accepted.
 */

/** i18next's plural suffixes (the CLDR plural categories). */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export type CatalogProblem = 'missing' | 'extra' | 'placeholders' | 'tags' | 'plural' | 'empty';

export interface CatalogIssue {
    locale: string;
    key: string;
    problem: CatalogProblem;
    detail?: string;
}

type Tree = { readonly [key: string]: string | Tree };

/** `{ a: { b: 'x' } }` as `{ 'a.b': 'x' }`. */
export function flattenCatalog(tree: Tree, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(tree)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') out[key] = v;
        else Object.assign(out, flattenCatalog(v, key));
    }
    return out;
}

/** `tabCount_one` -> `{ base: 'tabCount', category: 'one' }`; a key without a plural suffix has no category. */
function splitPlural(key: string): { base: string; category?: string } {
    const at = key.lastIndexOf('_');
    const suffix = at > 0 ? key.slice(at + 1) : '';
    return (PLURAL_CATEGORIES as readonly string[]).includes(suffix) ? { base: key.slice(0, at), category: suffix } : { base: key };
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map((m) => m[1]).sort();
const tags = (text: string) => [...text.matchAll(/<\/?([A-Za-z0-9]+)\s*\/?>/g)].map((m) => m[1]).sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const unique = (xs: string[]) => [...new Set(xs)].sort();

/** Plain keys and plural families (base key -> its forms) of a flattened catalog. */
function shape(flat: Record<string, string>) {
    const plain = new Map<string, string>();
    const plural = new Map<string, Map<string, string>>();
    for (const [key, text] of Object.entries(flat)) {
        const { base, category } = splitPlural(key);
        if (category) {
            if (!plural.has(base)) plural.set(base, new Map());
            plural.get(base)!.set(category, text);
        } else plain.set(key, text);
    }
    return { plain, plural };
}

/** Problems of one plural family against the forms `locale` needs. */
function checkPluralFamily(locale: string, base: string, forms: Map<string, string>): CatalogIssue[] {
    const needed = new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
    const have = [...forms.keys()];
    const missing = needed.filter((c) => !have.includes(c));
    const extra = have.filter((c) => !needed.includes(c));
    if (missing.length === 0 && extra.length === 0) return [];
    return [{ locale, key: base, problem: 'plural', detail: `needs ${needed.join('/')}, has ${have.join('/')}` }];
}

/** Every problem of `catalog` (language `locale`) against the English `reference`. */
export function validateCatalog(locale: string, catalog: Tree, reference: Tree): CatalogIssue[] {
    const issues: CatalogIssue[] = [];
    const mine = shape(flattenCatalog(catalog));
    const ref = shape(flattenCatalog(reference));

    for (const [key, refText] of ref.plain) {
        const text = mine.plain.get(key);
        if (text === undefined) {
            issues.push({ locale, key, problem: 'missing' });
            continue;
        }
        issues.push(...compareText(locale, key, [text], [refText]));
    }
    for (const key of mine.plain.keys()) if (!ref.plain.has(key)) issues.push({ locale, key, problem: 'extra' });

    for (const [base, refForms] of ref.plural) {
        const forms = mine.plural.get(base);
        if (!forms) {
            issues.push({ locale, key: base, problem: 'missing' });
            continue;
        }
        issues.push(...checkPluralFamily(locale, base, forms));
        issues.push(...compareText(locale, base, [...forms.values()], [...refForms.values()]));
    }
    for (const base of mine.plural.keys()) if (!ref.plural.has(base)) issues.push({ locale, key: base, problem: 'extra' });
    return issues;
}

/** Placeholders, tags and emptiness of a message (all forms of a plural family together). */
function compareText(locale: string, key: string, texts: string[], refTexts: string[]): CatalogIssue[] {
    const issues: CatalogIssue[] = [];
    if (texts.some((t) => t.trim() === '')) issues.push({ locale, key, problem: 'empty' });
    // `count` may be left out of a form ("one tab" instead of "1 tab"): compare the other values
    const mineVars = unique(texts.flatMap(placeholders)).filter((v) => v !== 'count');
    const refVars = unique(refTexts.flatMap(placeholders)).filter((v) => v !== 'count');
    if (!same(mineVars, refVars)) issues.push({ locale, key, problem: 'placeholders', detail: `${mineVars.join(',')} vs ${refVars.join(',')}` });
    if (!same(unique(texts.flatMap(tags)), unique(refTexts.flatMap(tags)))) issues.push({ locale, key, problem: 'tags' });
    return issues;
}

/** The English catalog's own plural families must have every English form (`one` and `other`). */
export function validateReferencePlurals(reference: Tree, locale = 'en'): CatalogIssue[] {
    const { plural } = shape(flattenCatalog(reference));
    return [...plural].flatMap(([base, forms]) => checkPluralFamily(locale, base, forms));
}
