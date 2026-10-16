---
name: public-email-form-routes
description: Shared helpers for public routes that email the support inbox (contact, uninstall-feedback), body-size capping, header-safe subjects, and testing an async searchParams page plus Playwright live-region traps
metadata:
  type: reference
---

- Public routes that email support use `lib/supportEmail.ts` (`createRateLimiter`, `getClientIp`,
  `buildDiagnostics` with `envTag`, `sendSupportEmail(logTag, …)` which logs only
  `[<logTag>] send failed {name,statusCode}`), `lib/emailAddress.ts` (`isEmailAddress`, client-safe)
  and `lib/plainText.ts` (`stripControlChars`, loop-based because of `no-control-regex`). Each route
  creates its own limiter, so routes never share an allowance.
- Body cap: check `content-length` first, then `req.text()` + `TextEncoder` byte length, then
  `JSON.parse`. A JSON-escaped char can cost 6 bytes, so size the cap from the char limits x6.
- Subjects carry only fixed text, the env tag and validated ids; free text goes in the body only.
  `replyTo` is safe only after `isEmailAddress` (no whitespace, so no CRLF).
- Async server page with `searchParams`: test with
  `render(await Page({ searchParams: Promise.resolve(query) }))`; arrays (`?b=x&b=y`) arrive as
  `string[]`, so parse with type checks rather than `as string`.
- Playwright: `getByRole('alert'|'status')` can also match Next's route announcer (a live region
  in a shadow root); add `.filter({ hasText })`. Public-page specs add
  `test.use({ storageState: { cookies: [], origins: [] } })` so they mean the same in every project.
- The support address lives once, in `SUPPORT_EMAIL` (`lib/supportInbox.ts`, client-safe so the
  contact and privacy pages can show it); `DEFAULT_FROM`/`DEFAULT_TO` in `lib/supportEmail.ts` derive
  from it. It is on the Resend-verified `tabmerger.com` domain; a custom `CONTACT_FROM_EMAIL` must be
  on a verified domain too. `scripts/scan-secrets.sh` blocks any literal email address in a staged
  file unless the path is in `.secretsignore`, so docs, `.env.example` and non-listed tests name the
  constant instead of the address; the route tests assert the literal (they are on the ignore list)
  so a changed default is caught.
- Env addresses go through `supportFromAddress()` / `supportToAddress(...envNames)`: trimmed, one
  plain address (or `Name <address>` for the sender, no `"<>` or control chars in the name), else
  skipped with a warning naming only the variable, falling back to the default. Never read
  `process.env.CONTACT_*` directly in a route.
- Honeypot field: hide with an off-screen container plus `aria-hidden` and `tabIndex={-1}`, not
  `sr-only` (screen readers would still reach it).
