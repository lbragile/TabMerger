---
name: blog-listing-client-state
description: Client-only URL state on a dynamic page (history.replaceState, not router.replace), raw ICU subsets for client components, stable element slots so a search field keeps focus, hydration-safe e2e for keyboard shortcuts
metadata:
  type: reference
---

**URL state without a server round trip.** Every page here is dynamic (ƒ, see [[static-pages-vs-locale-root-404]]),
so `router.replace('?q=…')` is a soft navigation that re-renders the page on the server and only
commits the URL when that RSC payload returns: one request per keystroke, and under parallel e2e load
the URL lagged more than 5 s. For state that only the browser uses (blog sort/search), call
`window.history.replaceState(null, '', href)`: Next 16 patches it and keeps `useSearchParams` and
`usePathname` in sync, with no request (docs: "Native History API" in
`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`). Scroll stays
put on its own. Unit tests then spy on `window.history.replaceState` instead of mocking `useRouter`.

**Client messages without growing CLIENT_NAMESPACES.** The server page picks the keys it needs from
`getMessages()` as raw ICU strings and passes them as a prop. The client formats them with
`createTranslator({ locale: locale as never, messages: { blog: subset }, namespace: 'blog' as never })`.
That translator has `.rich` (tags → React nodes) and `.markup` (tags → strings, for an aria-label); cast
it to a local interface because the typed version wants the full AppMessages. Example:
`components/blog/HelpfulCounts.tsx`.

**Keep element slots stable across modes.** When the first typed letter switches a listing from
"static" to "search" mode, render the same tree shape in both (`{custom ? null : featured}` and then
the same `<section>`). A different shape remounts the `<input>` and drops focus mid-word.
`blog-listing.test.tsx` checks this with `rerender` and `toBe(sameElement)`.

**Rows rendered on the server, highlighted on the client.** Server-rendered row nodes passed into a
client shell still read the shell's React context. A tiny client `SearchHighlight` inside the server
`PostRow` can therefore mark the query (`matchRanges` maps accent-insensitive matches back to
original string offsets and never splits a base letter from its combining mark).

**E2E of keyboard shortcuts on SSR'd controls.** The field is already in the server HTML, so a "/"
pressed before hydration does nothing. Retry inside `expect(async () => { press; toBeFocused({timeout: 500}) }).toPass()`.
`waitForURL` returning doesn't mean React has committed either: wait for the rendered text.
