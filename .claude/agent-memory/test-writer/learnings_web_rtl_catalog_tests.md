---
name: web-rtl-catalog-tests
description: Web catalog/RTL test patterns - ICU plural-category check, slow first role query, loader timeout
metadata:
  type: feedback
---

- Web catalog test (`__tests__/i18n-catalogs.test.ts`) parses ICU plural selectors by hand; `Intl.PluralRules(locale).resolvedOptions().pluralCategories` gives the required categories (ar: zero/one/two/few/many/other; he: one/two/other).
- Known catalog gaps go in a named allowlist with a "remove once fixed" comment, so the suite stays green while the gap is reported.
- A test using several `getByRole(..., {name})` queries can take about 1 s alone in jsdom and time out at 5 s under load; give it an explicit timeout with a comment rather than changing the query.
- The test that imports all shipped catalogs needs a longer timeout (20 s) under load.
- The web Playwright config reuses the dev server on :3000; run specs with `--project=chromium --reporter=list` to avoid the HTML reporter.
