---
name: rtl-layout-tailwind-v4
description: Right-to-left layout in the web app with Tailwind v4.3 — logical utilities, the ltr:/rtl: specificity trap, what has no logical form, dir="auto" placement for truncation, bidi isolates for composed numbers, script fonts, and the guard test
metadata:
  type: reference
---

Conventions live in docs/I18N.md "Right-to-left"; this is what was non-obvious when doing it.

**Tailwind v4.3 specifics**
- `inset-s-*`/`inset-e-*` are the current logical insets; `start-*`/`end-*` still compile but are
  deprecated (registered without suggestions). tailwind-merge 3.6 knows `inset-s`.
- `space-x-*` is already logical in v4 (`margin-inline-start/end`), so it needs no conversion;
  `divide-x`, `translate-x`, `border-l` etc. are physical.
- The `rtl:`/`ltr:` variants wrap in `:where(...)`, so they add no specificity. Don't pair an
  unprefixed physical class with an `rtl:` override of the same property and hope order wins; use
  `sm:ltr:...` and `sm:rtl:...` side by side (the cookie card does this, because each side must
  pair with its own `env(safe-area-inset-left|right)` — there is no logical safe-area inset).
- No logical form: translate (switch thumb: `rtl:data-[state=checked]:-translate-x-5`), rotation,
  gradient direction (set a CSS var with `[--accent-to:to_right] rtl:[--accent-to:to_left]` and
  use `linear-gradient(var(--accent-to), …)` inline). Symmetric centring needs nothing: prefer
  `inset-x-0 mx-auto w-fit` over `left-1/2 -translate-x-1/2`.
- A `-inset-s-[625rem]` honeypot goes off the start side, which is never scrollable in either
  direction — the logical version is strictly correct, not just equivalent.

**Content direction**
- `dir="auto"` must sit on the element that truncates: an LTR title inside an RTL clipping box
  gets its *beginning* cut. Padding that belongs to the page layout (an indent) moves to a
  wrapper without `dir`, or it flips with the text.
- An empty `dir="auto"` input/textarea resolves to LTR in Chrome, so an Arabic/Hebrew placeholder
  sat on the left. Fixed globally with `:where(input,textarea)[dir='auto']:placeholder-shown {
  direction: inherit }`; the language search instead sets `dir={query ? 'auto' : pageDir}`.
- Numbers composed from separate inline pieces reverse in an RTL paragraph: the reviews strip's
  "4.28" + "/ 5" span rendered "5 / 4.28", and "−10%" (U+2212 is bidi class ES) rendered "10%−".
  Wrap the whole figure in `dir="ltr"`. A single Intl-formatted price string is fine.
- A comma (or "،", or `), (`, or `", "`) between two Latin words resolves left to right in RTL
  prose, so "Chrome, Firefox" became one LTR run and Hebrew showed Firefox first. `listNames`
  (lib/stores.ts) isolates each name, and the catalog test "right-to-left catalogs: Latin lists"
  fails on any bare joined run in ar/he/fa. Strings built this way carry invisible U+2068/U+2069,
  so RTL tests need a `getDefaultNormalizer` that strips them.
- Latin examples inside RTL catalog copy ("de, he" in a Hebrew placeholder) go in FSI/PDI
  (U+2068/U+2069) inside the message itself.

**Fonts**: script fonts (`lib/fonts.ts`) are `preload: false` and only their class goes on
`<body>` for those locales; `--font-sans` falls through `var(--font-script, ui-sans-serif)`.
Any test importing `app/layout` (socialPreview.test.ts) must mock every `next/font/google` loader
the module calls, or the import throws.

**Guard**: `__tests__/rtl-logical-classes.test.ts` scans components/ and app/ (comments blanked,
`//` only after whitespace so URLs survive) with an `ALLOWED` list that also fails when stale.

Related: [[radix-direction-and-menu-search]]
