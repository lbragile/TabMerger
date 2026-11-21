---
name: blog-client-test-gotchas
description: Traps hit building the blog's interactive parts — user-event's clipboard stub, jsdom matchMedia, refs-in-render lint, copy-then-open user activation, raw message keys, lens/carousel DOM-write patterns
metadata:
  type: reference
---

- **user-event replaces `navigator.clipboard`** in `userEvent.setup()`: define a clipboard mock
  *after* `setup()` or the component writes to user-event's stub and the spy never fires.
- **jsdom has no `window.matchMedia`**: client code calling it at render/handler time crashes a
  test far away. Blog code goes through `lib/blog/media.ts` (`mediaMatches`, `onMediaChange`).
- **react-hooks/refs** fails reading `ref.current` (or passing a ref to a function) during render.
  Work out derived view data in the event handler and keep it in state (the lightbox's
  `LightboxView`), and position things with DOM writes in effects (lens transform, carousel arrow
  layer height/top via ResizeObserver, Toc indicator) instead of state.
- **Clipboard + `window.open` in one click:** start `navigator.clipboard.writeText()` and call
  `window.open()` synchronously in the handler (don't `await` the write first), then handle the
  promise; both need the click's user activation.
- **Raw keys on the page:** next-intl prints the key path ("blog.sources") for a missing message.
  The test intl helper (`__tests__/helpers/intl.tsx`, `onIntlError`) throws for missing `blog.*`
  messages; add the English message in the same edit as the `t()` call.
- `jsx-no-literals` flags template literals with words (`{`, ${x}`}`); write `,{' '}{x}` and keep
  `'#'` as its own literal. An en dash isn't in the allowed list (`—` is): put it in a constant.
- Hashtag chips in RTL pages: `dir="auto"` on the chip keeps "#" before the label in either script.
- A page that returns `<AsyncServerComponent />` renders as nothing in RTL (`render(await Page())`
  can't run async components): have the page `return View({...})` (call it) so tests still see
  the markup. The blog listing pages do this.
- Horizontal-scroll chip rows on phones: `whitespace-nowrap` on the chip and `shrink-0` on the
  `li`, or flex shrinks the chips and their labels wrap.
- Importing `next.config` in a test is slower now (Sentry + next-intl + MDX + generators): the
  seo-metadata test warms it in a 30s `beforeAll`.

Related: [[rtl-layout-tailwind-v4]], [[i18n-next-intl]].
