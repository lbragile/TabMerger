/**
 * Regression guard for right-to-left layout: no physical-direction Tailwind classes or inline
 * style properties in `components/` and `app/`. Arabic, Hebrew and Persian pages render
 * under `<html dir="rtl">`, and only logical utilities flip with it: `ms-`/`me-` not `ml-`/`mr-`,
 * `ps-`/`pe-`, `inset-s-`/`inset-e-` not `left-`/`right-`, `text-start`/`text-end`,
 * `border-s`/`border-e`, `rounded-s`/`rounded-e`, `borderInlineStart` not `borderLeft`.
 *
 * Not flagged:
 * - a class with an `ltr:` or `rtl:` variant: it is already direction-specific on purpose;
 * - a class under a Radix `data-[side=left|right]` variant: the popper's side is physical;
 * - `space-x-*`: Tailwind v4 implements it with `margin-inline-*`, so it flips by itself;
 * - comments.
 *
 * Anything else that must stay physical goes in ALLOWED with its reason. An entry that no longer
 * matches anything fails too, so the list can't go stale. See docs/I18N.md, "Right-to-left".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB = resolve(__dirname, '..')
const ROOTS = ['components', 'app']

/** Deliberate physical classes: `file` (relative to packages/web, forward slashes) and the class. */
const ALLOWED: { file: string; token: string; reason: string }[] = [
  {
    file: 'components/ui/dialog.tsx',
    token: 'left-[50%]',
    reason: 'centring (left 50% + translate -50%) is symmetric, and the open/close slide animation is built on it',
  },
  { file: 'components/ui/dialog.tsx', token: 'translate-x-[-50%]', reason: 'the other half of the centring above' },
  {
    file: 'components/errors/ShellGlows.tsx',
    token: '-translate-x-1/2',
    reason: 'centres each glow on a point given in physical (pointer) coordinates',
  },
  {
    file: 'components/consent/CookieConsentBanner.tsx',
    token: 'left-[max(0.75rem,env(safe-area-inset-left))]',
    reason: 'phones: spans both sides, each paired with its physical safe-area inset',
  },
  {
    file: 'components/consent/CookieConsentBanner.tsx',
    token: 'right-[max(0.75rem,env(safe-area-inset-right))]',
    reason: 'phones: spans both sides, each paired with its physical safe-area inset',
  },
  {
    file: 'components/ui/switch.tsx',
    token: 'translate-x-5',
    reason: 'thumb travel; the right-to-left travel is the rtl: class beside it',
  },
  { file: 'components/ui/switch.tsx', token: 'translate-x-0', reason: 'thumb at rest, the same in both directions' },
]

const SIZE = String.raw`(?:\d|px$|auto$|full$|\[|\()`
const PHYSICAL: RegExp[] = [
  new RegExp(String.raw`^(?:ml|mr|pl|pr|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-${SIZE}`),
  new RegExp(String.raw`^(?:left|right)-${SIZE}`),
  /^(?:text|float|clear)-(?:left|right)$/,
  /^border-[lr](?:$|-)/,
  /^rounded-(?:l|r|tl|tr|bl|br)(?:$|-)/,
  /^translate-x-/,
  /^divide-x(?:$|-)/,
  /^origin-(?:left|right|top-left|top-right|bottom-left|bottom-right)$/,
]
const PHYSICAL_STYLE = /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\b/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** The source with comments blanked out, line numbers kept. `//` only counts after whitespace or at a line start, so `https://` survives. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

/**
 * Splits a class token into its variants and the utility: `sm:rtl:-ms-2` → variants [sm, rtl],
 * `raw` `-ms-2` (important `!` dropped), `utility` `ms-2` (sign dropped too).
 */
function splitVariants(token: string): { variants: string[]; raw: string; utility: string } {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of token) {
    if (ch === '[' || ch === '(') depth++
    if (ch === ']' || ch === ')') depth--
    if (ch === ':' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  const raw = current.replace(/^!/, '')
  return { variants: parts, raw, utility: raw.replace(/^-/, '') }
}

function physicalClassesIn(line: string): string[] {
  const found: string[] = []
  for (const token of line.split(/[\s"'`{}]+/)) {
    if (!token) continue
    const { variants, utility } = splitVariants(token)
    if (variants.some((v) => v === 'ltr' || v === 'rtl' || /^data-\[side=(?:left|right)\]$/.test(v))) continue
    if (PHYSICAL.some((re) => re.test(utility))) found.push(token)
  }
  if (PHYSICAL_STYLE.test(line)) found.push(line.match(PHYSICAL_STYLE)![0])
  return found
}

describe('physical-direction class guard', () => {
  it('recognises physical classes and lets logical and direction-specific ones through', () => {
    expect(physicalClassesIn('className="ml-2 pr-4 left-3 -right-8 text-left border-l-2 rounded-tl-md"')).toEqual([
      'ml-2',
      'pr-4',
      'left-3',
      '-right-8',
      'text-left',
      'border-l-2',
      'rounded-tl-md',
    ])
    expect(physicalClassesIn("cn('sm:hover:mr-auto', '-translate-x-1/2')")).toEqual(['sm:hover:mr-auto', '-translate-x-1/2'])
    expect(physicalClassesIn('style={{ borderLeft: x }}')).toEqual(['borderLeft'])
    expect(
      physicalClassesIn(
        'className="ms-2 pe-4 inset-s-3 -inset-e-8 text-start border-s-2 rounded-ss-md space-x-2 rtl:-scale-x-100 sm:rtl:right-4 ltr:left-2 data-[side=left]:-translate-x-1 rounded-lg border-lime-500 right-click"'
      )
    ).toEqual([])
  })

  it('ignores comments but not URLs', () => {
    expect(physicalClassesIn(withoutComments('// was ml-auto'))).toEqual([])
    expect(withoutComments("const u = 'https://x' // ml-2")).toBe("const u = 'https://x' ")
    expect(withoutComments('a /* ml-2\n pl-4 */ b').split('\n')).toHaveLength(2)
  })

  const findings: { file: string; line: number; token: string }[] = []
  for (const root of ROOTS) {
    for (const path of sourceFiles(join(WEB, root))) {
      const file = relative(WEB, path).replace(/\\/g, '/')
      withoutComments(readFileSync(path, 'utf8'))
        .split(/\r?\n/)
        .forEach((text, i) => {
          for (const token of physicalClassesIn(text)) findings.push({ file, line: i + 1, token })
        })
    }
  }
  const allows = (a: (typeof ALLOWED)[number], f: { file: string; token: string }) =>
    a.file === f.file && splitVariants(f.token).raw === a.token
  const isAllowed = (f: { file: string; token: string }) => ALLOWED.some((a) => allows(a, f))

  it('uses logical direction classes in components/ and app/ (see docs/I18N.md, Right-to-left)', () => {
    const offending = findings.filter((f) => !isAllowed(f)).map((f) => `${f.file}:${f.line}  ${f.token}`)
    expect(offending, `Physical-direction classes found; use the logical form or add an ALLOWED entry with a reason:\n${offending.join('\n')}`).toEqual([])
  })

  it('has no stale allowlist entries', () => {
    const stale = ALLOWED.filter((a) => !findings.some((f) => allows(a, f)))
    expect(stale.map((a) => `${a.file}  ${a.token}`)).toEqual([])
  })
})
