---
name: store-ratings-sources
description: Where each store's rating figures and review texts come from for the landing reviews section (Chrome scrape facts, Edge JSON endpoints, AMO API), the parser traps, and the layout budget of the review card
metadata:
  type: reference
---

Modules: `lib/storeRatings.ts` (parallel fetch, count-weighted mean, interleave, `formatRating`), `lib/storeReviews.ts` (review type + selection rules, server-only), `lib/stores.ts` (ids and labels, client-safe), one module per store. Related: [[deployment-dependent-links]], [[og-preview-fallback-sources]].

**Chrome Web Store** (no API, scraped with a browser User-Agent; `?hl=en` pins the language the patterns rely on)
- The listing page has the visible rating (one decimal) and count. The unrounded mean sits in the embedded `AF_initDataCallback` data right before the exact count (`,4.57…,28,`). Accept it only when the count equals the visible count and it rounds to the visible rating: other number pairs in that data match a naive pattern first.
- Review texts are not on the listing page. `/detail/<id>/reviews` server-renders the first 10: per review an `<h3>` holding a name `<span>`, a `role="img" aria-label="N out of 5 stars"` element and a date `<span>` ("Oct 20, 2021"), then the body as `<p><span>text</span></p>`, then an optional nested `<section>` with the developer's reply. Class names are generated: anchor on tags, roles and aria-labels.
- Trap: `<p[^>]*>` matches `<path …>` (the page is full of SVG). Use `<p(?:\s[^>]*)?>`.
- Trap: a review past roughly 500 characters is cut in the HTML ("..." plus a "Show more" button inside the same `<p>`). The complete text is a JSON string in the embedded data; it is found as the single embedded string that starts with the cut text. No match, or more than one, means the review is dropped.
- Trap: a rating-only review has no body, so the next `<p>` is the developer's reply. Bound the body search at the first `<section`, `</section>` or `role="heading"` after the `</h3>`.
- There is no per-review URL; cards link to the reviews page.

**Edge Add-ons** (no documented API; both endpoints are public JSON and answer a plain fetch)
- Figures: `getproductdetailsbycrxid/<crx id>` returns `averageRating`, `ratingCount` and `storeProductId`.
- Reviews: `https://ratingsedge.rnr.microsoft.com/v1.0/ratingsedge/product/<storeProductId>?catalogId=1&callSiteId=3&pageSize=25&orderBy=1&skipItems=0` returns `{ PagingInfo, Items }`. Read only `Rating`, `ReviewText`, `UserName`, `SubmittedDateTime`, `IsTakenDown`, `IsPublished`. The items carry account and device identifiers as well: keep them out of types, logs and fixtures (fixtures are synthetic and list only the fields read).
- `SubmittedDateTime` has seven fractional digits and a `Z`; `Date.parse` accepts it. A timestamp without an offset is rejected, since it would be read in the server's timezone.
- There is no per-review page; cards link to the listing.

**Firefox** uses the documented AMO API (`addons/addon/<slug>/`, `ratings/rating/?addon=<slug>`), which returns the unrounded mean.

**Rules that apply to all three**
- Decision: ratings are kept unrounded in the data layer and rounded once, at display, to two decimals. Combining pre-rounded figures changes the result in the second decimal.
- Decision: the combined rating is the mean weighted by rating count, which is the mean of every individual rating; each store's own figures are shown next to it.
- The source-scan test in `__tests__/storeLinks.test.ts` rejects store URLs and ids as literals under `app/`, `components/`, `lib/` (including any Edge add-ons URL), so endpoint constants live in `packages/shared/src/constants/storeListings.ts`.
- `lib/storeReviews.ts` builds the `obscenity` matcher at load, so anything a client component can reach imports it as a type only. Sizes and box classes shared between server and client components live in the plain module `components/marketing/reviewsLayout.ts`.
- Tests: assigning `undefined` to `process.env.X` stores the string `"undefined"`; restore with `delete` when the original was unset, or an `X || default` fallback never runs.

**Review card layout budget** (20rem card, 280px content; the card narrows with the strip below 320px, see [[reviews-carousel-and-streaming]]): icon + author + date + "Read full review" on one 12px line leaves about 100px for the name, less than "Anonymous reviewer" needs. The date sits on the top line with the stars and the store name; the bottom line is icon, author (`min-w-0 truncate`) and the link pushed right (`ml-auto shrink-0`), which leaves about 160px. Measure with `scrollWidth > clientWidth` on the name span in a headless browser, not by eye.
