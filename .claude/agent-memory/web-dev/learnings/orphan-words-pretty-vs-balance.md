---
name: orphan-words-pretty-vs-balance
description: Chromium's text-wrap pretty leaves a lone LONG last word (de "synchronisiert", "устройствами"); balance on short list lines fixes it; how to measure last-line word counts headless; repairing a dev-server manifest corrupted by parallel e2e
metadata:
  type: reference
---

**`text-pretty` is not an orphan guarantee in Chromium (149).** It only reworks a *short* last
line: "sessions" or "note" alone gets a partner word, but a long single word that fills ~40% of
the line ("synchronisiert", "устройствами", "dispositivos", "urządzeniami") stays alone, and CJK
2-character tails do too. Measured on the pricing cards in 18 locales, `text-balance` on the
feature-line spans removed every case. Decision: feature lines (`FeatureList` in
`PricingCard.tsx`, highlights in `PricingTeaser.tsx`) use `text-balance`; the multi-sentence
`AiOptionNote` paragraph keeps `text-pretty` (balance would narrow a paragraph). Balance also has
wider support (Firefox 121+, Safari 17.5+) than pretty. A 3-word line whose last word is long
("Sinkronisasi cloud antarperangkat" at 375px in the teaser) can't be fixed by CSS; only rewording
helps.

To test a wrap mode on a string, append a standalone absolutely-positioned box to `body` with the
real font size and width: a clone appended inside the flex `li` shrinks and gives nonsense line
counts.

**Measuring orphans headless:** for each target element, walk its text nodes, make a `Range` per
`\S+` word (per character for ja/zh/ko), group `getClientRects()[0].top` values within 4px into
lines, and flag `lines > 1 && lastLineWords === 1` (CJK: `<= 2` chars). Elements inside an
`invisible` panel (the hidden Pro AI option) still lay out, so both options get measured without
clicking. After `goto`, await `document.fonts.ready` first.

**Dev server 500 "Internal Server Error" after a parallel Playwright run:** the log in
`.next/dev/logs/next-development.log` shows `SyntaxError: Unexpected non-whitespace character
after JSON at position N`. Two concurrent compiles wrote `.next/dev/prerender-manifest.json`
and the shorter write didn't truncate the longer one, leaving trailing junk. Repair without
restarting: `JSONDecoder().raw_decode` the file and write back only the first value; the server
recovers on the next request. The next run of the same spec then passes.
