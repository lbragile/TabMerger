---
name: i18n-unsegmented-routes
description: How /auth/* and the root 404/500 get a locale without a [locale] segment (cookie then Accept-Language in i18n/request.ts), and how to test locale-prefixed links despite the global navigation mock
metadata:
  type: reference
---

- Routes outside `app/[locale]/` (`/auth/*`, root `not-found.tsx`/`error.tsx`) get
  `requestLocale === undefined` in `i18n/request.ts`; the config then negotiates
  `NEXT_LOCALE` cookie -> `Accept-Language` -> default via `i18n/negotiate.ts` (pure, tested).
  URLs stay unprefixed (Supabase redirect allow-lists, email templates and the extension point at
  `/auth/*`). `global-error.tsx` replaces the root layout and bundles only English `errors`.
- Don't wrap `cookies()`/`headers()` in a broad try/catch: during prerender Next signals the
  dynamic bailout by throwing, and swallowing it breaks the bailout.
- A Client Component's namespace must be in `CLIENT_NAMESPACES` (`i18n/messages.ts`), or it is
  missing in the browser; `i18n-infrastructure.test.tsx` scans for this.
- `vitest.setup.tsx` globally mocks `@/i18n/navigation` with a plain `next/link`, so a test can't
  see locale prefixes. To assert `/fr/...` hrefs: `vi.unmock('@/i18n/navigation')` and give the
  `next/navigation` mock `redirect`, `permanentRedirect` and `notFound` exports too (the real
  module imports them), then render inside your own `NextIntlClientProvider` (the inner provider
  wins over the default test wrapper).
- New en keys break `i18n-catalogs` "has exactly the English keys" for every translated locale
  until translators add them: expected, report the keys.
- Long Python/TS edits via a Git Bash heredoc can fail with "unexpected EOF while looking for
  matching `'`"; write the script to the scratchpad with Write and run it instead.
