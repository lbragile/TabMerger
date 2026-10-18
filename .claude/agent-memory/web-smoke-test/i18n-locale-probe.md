---
name: i18n-locale-probe
description: How to probe next-intl locale routing in the web app (as-needed prefix, en-XA pseudo-locale) without the locale cookie skewing later requests
metadata:
  type: reference
---

- **[2026-10]** The pseudo-locale `en-XA` only exists when NODE_ENV isn't production. Check it on
  `next dev` (should be 200) and also on `next start` after `next build` (should be 404). A probe
  that only uses the dev server can't show that it's left out of production.
- next-intl sets a `NEXT_LOCALE` cookie on document requests. After a context visits `/en-XA/...`,
  every unprefixed URL in that context 307s to `/en-XA/...` (even `/xx/pricing` becomes
  `/en-XA/xx/pricing`, which is still a 404). Use a fresh browser context, or curl without
  cookies, for each locale's checks. `Accept-Language: en-XA` causes the same redirect.
- curl sends no `Accept-Language`, so next-intl answers it with `NEXT_LOCALE=en`. Real browsers
  that send an unmatched language get no cookie (this is what the unit test asserts). Don't report
  the curl cookie as a regression.
- Locale redirects (`/en/x` → `/x`, `/EN/x` → `/en/x`) are 307, not 308. That's next-intl's
  default.
- The changelog route's `outputFileTracingIncludes` key is `/[locale]/changelog`. To prove it,
  look in `.next/server/app/[locale]/(marketing)/changelog/page.js.nft.json` for `CHANGELOG.md`
  (see [[public-fs-reads-on-dynamic-routes]]).
