# Web Smoke Test Memory Index

- [TypeScript Gotchas](ts-gotchas.md) — Recurring TypeScript issues found in web package: Stripe API version cast, Supabase SSR setAll types, empty interface lint errors
- [public/ fs reads on dynamic routes](public-fs-reads-on-dynamic-routes.md) — marketing routes are dynamic; check the route's nft.json to prove public/ files reach the function
- [Email routes live probe](email-routes-live-probe.md) — test contact/uninstall-feedback with no key + dead RESEND_BASE_URL; devtools fill("") skips onChange
- [Lint Config](lint-config.md) — ESLint was missing from web package; required .eslintrc.json to unblock lint step
- [i18n locale probe](i18n-locale-probe.md) — test en-XA on dev and on next start; NEXT_LOCALE cookie redirects later unprefixed requests
- [Health/cron/uninstall probe](health-and-cron-probe.md) — /api/health is 503 locally without the Supabase stack (expected); action-once check
- [Signed-in dashboard probe](signed-in-dashboard-probe.md) — headless free/Pro dashboard via local GoTrue admin users; fallback when chrome-devtools profile is locked
