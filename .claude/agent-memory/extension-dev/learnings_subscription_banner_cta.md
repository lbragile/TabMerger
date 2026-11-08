---
name: learnings-subscription-banner-cta
description: SubscriptionStatusBanner plan-ends CTA — shared ACCOUNT_URL handler, one-line fit in long locales, and where per-locale "subscription" wording comes from
metadata:
  type: reference
---

`components/SubscriptionStatusBanner.tsx` has two states that both open the web `/account` page
(past_due "update your card" and the amber "Your Pro plan ends on {date}" bar with its
"Manage subscription" CTA, key `banners.manageSubscription`). Both use one module-level
`ACCOUNT_URL` + `openAccountPage()`; no shared account-URL helper existed elsewhere in the
extension (`lib/buyCredits.ts` builds its own `/account#…` URL for the AI-credits anchor).

- **One-line fit:** the message span is `min-w-0 truncate` (with `title` for the full text) and the
  CTA is `ms-auto shrink-0 whitespace-nowrap` — `ms-auto`, not `ml-auto`, so it sits at the end in
  RTL locales too (see [[learnings-rtl-layout]]).
- **Terminology source:** the extension catalogs had no word for "subscription" before this key.
  The web app's `packages/web/messages/<lng>/account.json` (`subscription.title`,
  `cancelSubscription.button`) is where each locale's term lives (de "Abo", fr "abonnement",
  pt-BR "assinatura", vi "gói đăng ký", he "מינוי"…); match it so the CTA and the page it opens agree.
- **e2e:** no spec asserts this banner. The e2e subscription mocks send
  `current_period_end: null`, so the amber bar never renders there even with
  `cancel_at_period_end: true` (the banner needs both).
- Locale `banners.json` files are CRLF on disk; insert keys with a line-ending-preserving script.
