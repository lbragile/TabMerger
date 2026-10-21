---
name: learnings-i18n-bundle-size
description: Why catalogs blew the 3.5 MB build budget (ship twice: popup + background; WXT forces esbuild charset ascii) and how the worker catalog set + per-group utf8 fix it
metadata:
  type: reference
---

Measured on the 15-locale build (`du -sb .output/chrome-mv3`): 5,000,178 bytes before, 3,304,037
after (budget 3,670,016; 7-locale main was 2,978,950).

- **Every bundle gets its own copy.** WXT builds the background (and content scripts) in Vite lib
  mode as one self-contained file, separate from the popup's multi-page build, so nothing is shared
  between them. A module imported by both (the catalogs, via `lib/i18n.ts`) ships twice. Lazy
  `import()` in the popup would NOT shrink `du`: the chunks still sit in the folder. Fix:
  `initI18n(catalogs, ...modules)` takes the catalog set; pages pass `@/locales`, the worker passes
  `@/locales/worker` (English in full + `WORKER_AREAS` per language). background.js 1.93 MB -> 685 KB.
  `i18n.ts` imports only the TYPE `CatalogSet`, so it pulls no catalog into any bundle.
- **WXT forces `esbuild.charset = "ascii"`** in `getBaseConfig` (dist/core/builders/vite/index.mjs)
  even though Vite defaults to utf8. Every Cyrillic/CJK/Devanagari character becomes a 6-byte
  `\uXXXX`: 127,925 escapes per bundle. The reason is content scripts: Chrome rejects one it doesn't
  consider valid UTF-8 ("isn't UTF-8 encoded"). Override per build group in
  `vite:build:extendConfig` (runs after the base+entry merge): `charset: "utf8"` only when every
  entrypoint's `inputPath` ends in `.html`. Vite's `resolveEsbuildTranspileOptions` spreads
  `config.esbuild`, so the same setting covers the minify step. Popup chunk 2.96 MB -> 2.51 MB.
  esbuild still escapes noncharacters/lone surrogates in utf8 mode (77 escapes left; output passes
  `iconv -f UTF-8` with no U+FFFE/U+FFFF/U+FDD0-FDEF bytes).
- **Find the worker's areas from the build:** grep `background.js` for `"(area)\.` string literals
  (keys survive minification as literals). `workerCatalogs.test.ts` does the same on source: it walks
  the value-import graph from `entrypoints/background.ts` (skips `import type`, strips comments,
  skips `src/locales/`) and fails on a key outside `WORKER_AREAS`, or an area no longer used.
- Production builds in a worktree need `VITE_EXTRA_WEB_APP_URLS=" "` (the `.env.local` http extra
  origin fails a non-development build), same as demo builds.

See [[learnings-i18n-i18next]].
