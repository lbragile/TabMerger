import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Right-to-left guard: the UI is laid out with logical properties (`ms-`/`me-`, `ps-`/`pe-`,
 * `inset-s-`/`inset-e-`, `text-start`, `border-s`, `rounded-e`…), so it mirrors on its own under
 * `<html dir="rtl">` (Arabic, Hebrew, Persian). A physical class (`ml-2`, `right-4`, `text-left`,
 * `border-l-2`) or a physical inline style key (`borderLeft`, `marginRight`) would stay put and
 * break the mirrored layout, so every `.tsx` under `src/` is scanned for them.
 *
 * `space-x-*` and `divide-x` are not flagged: in Tailwind v4 they already use
 * `margin-inline-*` / `border-inline-*`. Positioning computed in JS (`style={{ left: rect.left }}`)
 * is geometry from `getBoundingClientRect`, physical on purpose, and not a class, so it is not
 * scanned. Classes behind `rtl:` / `ltr:` or a Radix `data-[side=left|right]` variant are
 * deliberate and skipped.
 *
 * An intentional exception goes in ALLOWED with the reason; an entry whose class is no longer in
 * its file fails, so the list cannot go stale.
 */

const SRC = path.resolve(__dirname, '../../..');

const ALLOWED: ReadonlyArray<{ file: string; token: string; reason: string }> = [
  // Centering (left 50% + translate -50%) is symmetric geometry, and the open/close animation is
  // built around that same translate.
  { file: 'components/ui/dialog.tsx', token: 'left-[50%]', reason: 'centers the dialog' },
  { file: 'components/ui/dialog.tsx', token: 'translate-x-[-50%]', reason: 'centers the dialog' },
  { file: 'components/ui/dialog.tsx', token: 'data-[state=closed]:slide-out-to-left-1/2', reason: 'paired with the centering translate' },
  { file: 'components/ui/dialog.tsx', token: 'data-[state=open]:slide-in-from-left-1/2', reason: 'paired with the centering translate' },
  // The thumb's slide; mirrored by `rtl:data-[state=checked]:-translate-x-4` on the same element.
  { file: 'components/ui/switch.tsx', token: 'data-[state=checked]:translate-x-4', reason: 'mirrored by an rtl: variant' },
];

/** `left-*` / `right-*` with a Tailwind value, so prose like "right-click" is not a hit. */
const POSITION = /^(?:left|right)-(?:\d+(?:\.\d+)?|\d+\/\d+|px|full|auto|\[.+\])$/;
const PHYSICAL =
  /^(?:m[lr]|p[lr]|scroll-[mp][lr]|border-[lr]|rounded-(?:[lr]|tl|tr|bl|br)|translate-x|space-x-reverse|divide-x-reverse|slide-(?:in-from|out-to)-(?:left|right))-.+$|^(?:border-[lr]|rounded-(?:[lr]|tl|tr|bl|br)|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right)|origin-(?:left|right|top-left|top-right|bottom-left|bottom-right))$/;
/** A zero translate (`translate-x-0`) moves nothing in either direction. */
const ZERO = /^translate-x-(?:0|px-0|\[0(?:px)?\])$/;
const STYLE_KEY = /\b(?:margin|padding|border|scrollMargin|scrollPadding)(?:Left|Right)(?:Width|Color|Style)?\s*:/;
const TEXT_ALIGN = /\btextAlign\s*:\s*['"](?:left|right)['"]/;

/** Splits a class token into its variants (`hover:`, `data-[x=y]:`) and the utility itself. */
function splitVariants(token: string): { variants: string; utility: string } {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ':' && depth === 0) last = i;
  }
  return { variants: token.slice(0, last + 1), utility: token.slice(last + 1) };
}

/** True when `token` is a physical-direction Tailwind class that should be logical. */
export function isPhysicalClass(token: string): boolean {
  const { variants, utility } = splitVariants(token);
  if (/(?:^|:)(?:rtl|ltr):/.test(variants) || /side=(?:left|right)/.test(variants)) return false;
  const bare = utility.replace(/^!/, '').replace(/!$/, '').replace(/^-/, '');
  if (ZERO.test(bare)) return false;
  return PHYSICAL.test(bare) || POSITION.test(bare);
}

/** Every physical class or inline style key in `source`, as `line: token`. */
export function findPhysical(source: string): Array<{ line: number; token: string }> {
  const hits: Array<{ line: number; token: string }> = [];
  source.split(/\r?\n/).forEach((text, i) => {
    for (const token of text.split(/[\s"'`{}(),]+/)) {
      if (token && isPhysicalClass(token)) hits.push({ line: i + 1, token });
    }
    const style = text.match(STYLE_KEY) ?? text.match(TEXT_ALIGN);
    if (style) hits.push({ line: i + 1, token: style[0] });
  });
  return hits;
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'locales') tsxFiles(full, out);
    } else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');

describe('isPhysicalClass', () => {
  it.each(['ml-2', 'mr-auto', '-ml-1', 'pl-8', 'pr-[3px]', 'left-2', 'right-1/2', '-right-0.5', 'text-left', 'text-right',
    'border-l', 'border-r-2', 'border-l-transparent', 'rounded-l', 'rounded-tr-md', 'translate-x-4', '-translate-x-1/2',
    'hover:ml-1', 'sm:text-left', 'data-[state=checked]:translate-x-4', '!pl-2', 'origin-left'])('flags %s', (token) => {
    expect(isPhysicalClass(token)).toBe(true);
  });

  it.each(['ms-2', 'me-auto', 'ps-8', 'pe-2', 'inset-s-2', 'inset-e-4', '-inset-e-0.5', 'start-2', 'end-4', 'text-start', 'text-end', 'border-s',
    'border-e-2', 'rounded-s', 'rounded-ee', 'space-x-2', 'divide-x', 'inset-x-1.5', 'mx-auto', 'px-3',
    'rtl:-translate-x-4', 'rtl:data-[state=checked]:-translate-x-4', 'ltr:ml-2', 'data-[side=left]:slide-in-from-right-2',
    'translate-x-0', 'data-[state=unchecked]:translate-x-0', 'right-click', 'right-aligned', 'left-out', 'left', 'right'])(
    'leaves %s alone',
    (token) => {
      expect(isPhysicalClass(token)).toBe(false);
    }
  );

  it('finds physical inline style keys and alignment', () => {
    const hits = findPhysical("style={{ borderLeft: '3px solid red' }}\nstyle={{ textAlign: 'right' }}\nstyle={{ borderInlineStart: 0 }}");
    expect(hits.map((h) => h.line)).toEqual([1, 2]);
  });
});

describe('extension UI uses logical (direction-aware) classes', () => {
  const files = tsxFiles(SRC);
  const allowed = (file: string, token: string) => ALLOWED.some((a) => a.file === file && a.token === token);

  it('scans the UI sources', () => {
    // A path mistake would otherwise pass vacuously
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => rel(f) === 'components/Windows/Tab.tsx')).toBe(true);
  });

  it('has no physical-direction class or inline style outside the allowlist', () => {
    const offenders = files.flatMap((file) =>
      findPhysical(readFileSync(file, 'utf8'))
        .filter((hit) => !allowed(rel(file), hit.token))
        .map((hit) => `src/${rel(file)}:${hit.line}  ${hit.token}`)
    );
    // Use the logical form (ml→ms, mr→me, pl→ps, pr→pe, left→inset-s, right→inset-e, text-left→text-start,
    // border-l→border-s, rounded-r→rounded-e, borderLeft→borderInlineStart), add an rtl: variant,
    // or, for real geometry, an ALLOWED entry with the reason.
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry is still needed', () => {
    const stale = ALLOWED.filter(({ file, token }) => !findPhysical(readFileSync(path.join(SRC, file), 'utf8')).some((hit) => hit.token === token));
    expect(stale).toEqual([]);
  });
});

/**
 * `text-ui-start` (globals.css) puts user and website text on the UI's start edge. It must take
 * that edge from `<html dir>` alone. A parent-relative value (`match-parent`, `inherit`) copies a
 * parent's `center` too: a <button>'s default centred the header's search placeholder in the
 * English UI. With a fixed `left` (and `right` under `<html dir="rtl">`) the English UI is
 * exactly as it was before right-to-left support, wherever the class is used.
 */
describe('text-ui-start is independent of the parent', () => {
  const css = readFileSync(path.join(SRC, 'styles/globals.css'), 'utf8')
  const block = css.match(/@utility text-ui-start\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

  it('is defined', () => {
    expect(block).not.toBe('')
  })

  it('is left in a left-to-right UI and right under <html dir="rtl">', () => {
    expect(block).toMatch(/^\s*text-align:\s*left;/m)
    expect(block).toMatch(/:root\[dir=['"]rtl['"]\][^{]*\{\s*text-align:\s*right;/)
  })

  it('never resolves against the parent', () => {
    expect(block).not.toMatch(/match-parent|inherit|\bstart\b|\bend\b/)
  })

  it('is only used on elements that set their own direction, or on the header search label', () => {
    // Anywhere else plain `text-start` is the right class (it already follows the UI direction)
    const misuse = tsxFiles(SRC).flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      return lines.flatMap((line, i) => {
        if (!line.includes('text-ui-start')) return []
        // The element's opening tag can span a few lines: its `dir` may sit on the lines above
        const tag = lines.slice(Math.max(0, i - 3), i + 1).join(' ')
        return /\bdir=/.test(tag) ? [] : [`src/${rel(file)}:${i + 1}`]
      })
    })
    expect(misuse).toEqual([])
  })
})
