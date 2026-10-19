# Analytics

How TabMerger counts installs, uninstalls and active installs, and how each surface proves it is
alive. Event names live in one place: `ANALYTICS_EVENTS` in
`packages/shared/src/constants/analyticsEvents.ts`. Use the constant, never a string literal.

## GA4 properties

| Stream | Measurement ID / API secret (server env) | Receives |
|---|---|---|
| `extension` | `GA_EXTENSION_MEASUREMENT_ID` / `GA_EXTENSION_API_SECRET` | Extension lifecycle and usage events (via `/api/track`) and the server-side `extension_uninstalled` |
| `web` | `NEXT_PUBLIC_GA_MEASUREMENT_ID` / `GA_API_SECRET` | Website gtag events, server-side `web_heartbeat`, Stripe webhook events |

Every server-side event goes through `sendGa4Event(stream, …)` in `packages/web/lib/ga4.ts`
(Measurement Protocol). Server-side events can't be dropped by ad blockers, and the API secrets
never reach a browser or the extension bundle.

## Website consent (web property)

The website's browser analytics (gtag.js for GA4, posthog-js with session replay) follow the
visitor's cookie choice (`packages/web/lib/consent.ts`, `lib/consentRegions.ts`). Server-side
Measurement Protocol events (above) are not browser analytics and are unaffected.

| Visitor | Before any choice | Banner |
|---|---|---|
| Opt-in region: EEA (EU 27 + NO/IS/LI and EU territories with their own ISO code), GB (+ GG/JE/IM/GI), CH, CA-QC, or an unknown/missing/malformed country | Nothing loads: no gtag.js request, PostHog not initialised | Shows unasked (on the home page after scrolling past the first screen) |
| Opt-out region (everywhere else) | GA (analytics storage granted) and PostHog with session replay run | Hidden; the footer's "Cookie settings" opens it with the "analytics are on" text and a Reject |
| Browser sends Global Privacy Control (`navigator.globalPrivacyControl === true`), any region | Treated as Reject: nothing loads | Hidden; "Cookie settings" explains GPC and offers Accept |

A stored Accept or Reject (`tm_consent`, one year) always wins over the region and GPC.

**How the browser learns its region.** `proxy.ts` reads Vercel's `x-vercel-ip-country` and
`x-vercel-ip-country-region` headers on every page request and sets `tm_consent_region`
(`optin`/`optout`, one day, not HttpOnly, Secure on https) when it is missing or different. It is
never set on `/api/*`, `/_next/*`, files or metadata routes. Pages stay static: the root layout
never reads the cookie; the banner and the loaders read it in the browser. GPC is read in the
browser only (`navigator.globalPrivacyControl`); browsers that send the `Sec-GPC: 1` header also
expose it there, and nothing tracks before that check runs.

**Trying the opt-out path locally.** Localhost has no geo headers, so it is always opt-in. Set
`CONSENT_REGION_OVERRIDE` in `packages/web/.env.local` (or the shell that runs `pnpm dev:web`) to
a country code (`US`, `DE`) or `CA-QC`, and restart the dev server; it replaces the geo headers.
It is ignored on the production deployment (`isProductionDeployment()`), and a malformed value
(lowercase, three letters, anything else) is ignored too. Alternatively, send
`x-vercel-ip-country: US` with the site's own requests, as `e2e/cookie-consent.spec.ts` does. To
simulate GPC, run `Object.defineProperty(navigator, 'globalPrivacyControl', { value: true })` in
an init script, or use a browser with GPC turned on (Brave, Firefox with
`privacy.globalprivacycontrol.enabled`). Delete `tm_consent` to see the first-visit state again.

**What PostHog never receives** (`lib/analyticsPrivacy.ts`): URL fragments (a share link's
`#key=`; `disable_capture_url_hashes` plus a `before_send` that strips `#…` from every http(s) URL
property, `$set` and `$set_once` included), anything inside a `ph-no-capture` element (the
signed-in layout, shared-link tabs, the share-link chip, the account email and initials), Radix
popups and dialogs in replays (`session_recording.blockSelector`), click/copy/heatmap events on
`/dashboard`, `/account` and `/share/*`, and form input values (`maskAllInputs`). gtag.js already
leaves the fragment out of `page_location`. Wrap any new element that shows decrypted or personal
data in `NO_CAPTURE_CLASS`.

## Extension lifecycle and liveness events

| Event | Sent by | When | Params |
|---|---|---|---|
| `extension_installed` | Extension background → `POST /api/track` | `runtime.onInstalled`, reason `install` | `reason` |
| `extension_updated` | Extension background → `POST /api/track` | `runtime.onInstalled`, any other reason | `reason` |
| `extension_uninstalled` | Web server (server action on `/uninstalled`) | The uninstall page loads, once per page view | `browser`, `extension_version`, `channel`, `environment` |
| `extension_heartbeat` | Extension background → `POST /api/track` | Once a day per install | `browser`, `extension_version`, `channel` (`stable` / `beta`), `tier` (cached plan, when known), `days_since_install` (whole days, when the install date is known) |
| `web_heartbeat` | Vercel cron → `GET /api/cron/web-heartbeat` | Daily at 12:00 UTC (`packages/web/vercel.json`) | `environment`, `commit`, `supabase` (`ok` / `down` / `unconfigured`) |

`/api/track` already accepts any GA4-valid event name, so `extension_heartbeat` needs no server
change.

### Consent

- On Firefox, the extension sends nothing unless the `technicalAndInteraction` data-collection
  consent is granted (`packages/extension/src/lib/dataConsent.ts`).
- The uninstall URL carries an analytics flag, `a=1` or `a=0` (`UNINSTALL_SURVEY_PARAMS.analytics`).
  Chrome and Edge builds always send `a=1`; Firefox sends the consent state and re-registers the
  URL when the consent changes. The server records `extension_uninstalled` only when the flag is
  `1`. A URL without the flag (registered by a build older than the flag) counts only for Chrome
  and Edge (`uninstallAnalyticsAllowed` in `packages/shared`).

### Uninstall event details

- The page (`app/[locale]/(marketing)/uninstalled/page.tsx`) parses the query with
  `parseUninstallSurveyParams` (browser and channel allow-lists, manifest-version regex) and
  mounts `UninstallTracker` only when analytics are allowed. The server action
  (`recordUninstall`) re-checks every value, since anyone can call it.
- Once per page view: GA4 does not deduplicate Measurement Protocol events, so
  `UninstallTracker` guards with a ref (React's double effect run) plus a sessionStorage flag
  keyed by the query string (refresh, back/forward). Opening the URL in a new tab counts again,
  which is rare for a page only the browser opens.
- The URL carries no install id, so each uninstall uses a random one-off `client_id`. Read
  uninstalls as an **event count**, never as users.
- No install age yet: the URL has no install date. Adding one would need the extension to store
  its install date and add a parameter (for example a day-granular date) to the uninstall URL.

## Reading the numbers in GA4 (extension property)

- **Installs / uninstalls per day:** Reports, Engagement, Events, filtered to
  `extension_installed` and `extension_uninstalled`; use **Event count**.
- **Net installs:** `extension_installed` event count minus `extension_uninstalled` event count
  over the same range. In Explore, a free-form table with Event name as rows and Event count as
  the value, by Date, gives the daily series. Uninstalls from Firefox users without the analytics
  consent are not counted, and installs from them aren't either, so the net stays consistent.
- **Active installs:** the number of unique installs sending `extension_heartbeat`. Each install
  uses its own random `client_id`, so in Explore, filter Event name = `extension_heartbeat` and
  read **Total users** for the last 1, 7 and 28 days (roughly DAU / WAU / MAU of installs).
  Break down by `browser` and `extension_version` to see the active base per browser and how fast
  updates roll out.
- These numbers arrive within hours (Realtime for the first minutes, standard reports within
  about a day), well ahead of the store dashboards.

### Custom dimensions to register

GA4 Admin, Custom definitions, Create custom dimension, scope **Event**:

| Dimension name | Event parameter | Property |
|---|---|---|
| Browser | `browser` | extension |
| Extension version | `extension_version` | extension |
| Channel | `channel` | extension |
| Tier | `tier` | extension |
| Environment | `environment` | both |
| Commit | `commit` | web |
| Supabase status | `supabase` | web |

Dimensions only apply to events received after they are registered.

Optionally, register the heartbeat's `days_since_install` as an event-scoped custom **metric**
(Create custom metric, unit: Standard) to chart install age.

## Liveness checks

- `GET /api/health` (public, never cached): `{ ok, commit, environment, time, supabase }`. 200
  when healthy; 503 when Supabase is configured and its Auth health endpoint doesn't answer within
  3 seconds. The Supabase answer is cached for 60 seconds, so the endpoint can't be used to
  hammer Supabase. No secrets, no user data. Point an uptime monitor at it.
- `GET /api/cron/web-heartbeat`: protected by `Authorization: Bearer $CRON_SECRET` (Vercel adds
  the header itself when the `CRON_SECRET` environment variable is set). Without the variable the
  route rejects every request. It answers 503 when the web GA4 stream isn't configured and 502
  when GA refuses the event, so a failing run shows as an error in Vercel's cron logs.
- **Setup:** set `CRON_SECRET` (a random string of at least 16 characters) in the Vercel project
  for Production. Vercel runs crons on production deployments only. The schedule is daily because
  Hobby plans allow only daily crons; on a Pro plan it can move to hourly (`0 * * * *`).
- If GA4 shows no `web_heartbeat` for a day, the site, the cron or the GA pipeline is broken.
  Check Vercel, Project, Settings, Cron Jobs (last run and its logs), then `/api/health`.

### Suggested GA4 alerts (custom insights)

GA4 Home or Reports, Insights, Create, custom insight. Evaluation frequency **Daily**:

| Property | Condition | Meaning |
|---|---|---|
| web | Event count for `web_heartbeat` = 0 (Daily) | Site, cron or GA pipeline down |
| extension | Event count for `extension_heartbeat` has decreased by more than 30% (Daily) | Extension heartbeat broken, or a mass uninstall |
| extension | Event count for `extension_uninstalled` has increased by more than 100% (Daily) | Uninstall spike, often a bad release |
| extension | Event count for `extension_installed` = 0 (Daily) | Store listing or install tracking broken |

Add an email recipient to each. Because these watch for a missing event, check them once after
creating, as GA4 can need a few days of baseline before "decreased by" conditions fire.

## Checkout funnel (web property)

Who started a paid checkout and didn't finish. Client helpers live in
`packages/web/lib/checkoutAnalytics.ts`; the server events are sent by the Stripe webhook
(`app/api/webhooks/stripe/route.ts`). Tiers are reported with their database names (`pro`,
`pro_ai`), and every value is USD, the currency of every Stripe Price.

| Event | Sent by | When | Params |
|---|---|---|---|
| `begin_checkout` (GA4 recommended) | Browser (gtag, mirrored to PostHog) | A checkout CTA on a pricing card is clicked and the `/api/checkout` request starts. Not sent for the Free card or for a subscriber, whose click opens the billing portal | `tier`, `billing_interval`, `value`, `currency`, `items`, `source` (`pricing_page`), `component` (`pricing_card`) |
| `checkout_canceled` | Browser (gtag, mirrored to PostHog) | Stripe returns the buyer through `cancel_url` (`/pricing?checkout=canceled&tier=…&interval=…`, prefixed with the buyer's locale, e.g. `/fr/pricing?…`). Sent once on landing, then the parameters are removed with `router.replace`, so a refresh doesn't count it again | `tier`, `billing_interval`, and `value`/`currency`/`items` when both are known. Values not on the allow-list are dropped, never forwarded |
| `checkout_abandoned` | Stripe webhook, `checkout.session.expired` | A subscription Checkout Session this app created expired unpaid (Stripe's default: 24 hours after it was created) | `checkout_session_id` (opaque, see below), `tier`, `billing_interval`, `value`, `currency`, `items`, `environment` |
| `purchase` (GA4 recommended) | Stripe webhook, `checkout.session.completed` | A subscription checkout was paid | `transaction_id` (opaque, see below), `value` (USD paid, after any promotion code), `currency`, `tier`, `billing_interval`, `items`, `environment` |
| `checkout_completed` | Stripe webhook, `checkout.session.completed` | Same moment as `purchase`. The original custom event, kept unchanged so existing reports keep working | `tier`, `value` (list price), `currency` (`usd`), `billing` |

### Identity and ids (privacy)

The privacy page promises GA data is not linked to an account, so checkout events carry no
account identifier and no link to a browser session:

- **No `user_id`**, ever. `sendGa4Event` (`packages/web/lib/ga4.ts`) has no option for one.
- **`client_id`** of every server event is a fresh random UUID, new for each event. It is never
  derived from the account, and server events are **not joined to the buyer's browser session**
  (no `_ga` cookie is read or stored). So the server events (`purchase`, `checkout_completed`,
  `checkout_abandoned`) can't be tied to the browser events (`begin_checkout`,
  `checkout_canceled`) as one user: **read the funnel as event counts** (see the recipe below).
- **`transaction_id` / `checkout_session_id`** are the HMAC-SHA256 (hex) of the Stripe Checkout
  Session id, keyed with a subkey derived from **`STRIPE_WEBHOOK_SECRET`**
  (`HMAC-SHA256(secret, "tabmerger:ga-session-id:v1")`). That secret is server-only, **never sent to
  Google** (unlike `GA_API_SECRET`, which travels in the Measurement Protocol query string) and
  never logged. The ids are stable per session, so GA4 can deduplicate `purchase` and you can count
  unique sessions, but GA never sees a Stripe id. **Rotating `STRIPE_WEBHOOK_SECRET` changes
  every id from then on**, so a redelivery that straddles a rotation isn't recognized as a
  duplicate. Without the secret no checkout event is sent.
- **Opt-outs:** server-side events aren't covered by browser opt-outs. Ad blockers, GA opt-out
  extensions and the browser's own tracking protection stop `begin_checkout` and
  `checkout_canceled`, but not `purchase`, `checkout_completed` or `checkout_abandoned`, which
  the server sends straight to GA. They carry no identifier for the person (see above).

Server events are sent after the webhook has answered Stripe (`after()` from `next/server`), and
each Measurement Protocol request is aborted after 2 seconds, so GA can never delay or fail a
webhook.

### Stripe setup

The webhook endpoint must be subscribed to **`checkout.session.expired`** in the Stripe
Dashboard (Developers, Webhooks, the endpoint, Select events), in **both test and live mode**.
Without it `checkout_abandoned` never arrives. The handler only sends the analytics event: it
reads and writes no database row, calls nothing at Stripe and always answers 200.

### Redeliveries can double-count

Stripe can deliver an event more than once. GA4 deduplicates only `purchase` (by
`transaction_id`). **`checkout_completed` and `checkout_abandoned` are counted again on every
redelivery**, so for exact numbers count **unique `checkout_session_id`** for abandons (register
it as a custom dimension, or use BigQuery `COUNT(DISTINCT …)`) and use `purchase` rather than
`checkout_completed` for completions. In practice duplicates are rare: the handler answers 200
on the first delivery, so Stripe has no reason to retry.

### Key events

GA4 Admin, Data display, Events: mark **`purchase`** as a key event (it is the conversion and
carries revenue). Optionally mark **`begin_checkout`** too, to compare channels by checkout
starts. Leave `checkout_canceled` and `checkout_abandoned` as ordinary events: they are drop-offs,
not goals. Don't mark `checkout_completed`: it would count each purchase twice.

Register these event-scoped custom dimensions (Admin, Custom definitions) on the web property:
`tier`, `billing_interval`, `source`, `component`, and `checkout_session_id` (for counting
unique abandons). Revenue (`value`, `currency`) and `items`
need no registration.

### Funnel recipe (event counts)

Server events are never joined to a browser (see "Identity and ids"), so a user-level Funnel
exploration from `begin_checkout` to `purchase` always shows close to 0% completion. Read the
funnel as **event counts** instead:

1. **Drop-off table:** Explore, Free form. Rows: Event name (filter to `begin_checkout`,
   `checkout_canceled`, `checkout_abandoned`, `purchase`). Columns: `tier` (or
   `billing_interval`). Values: Event count. This gives started / canceled / abandoned /
   purchased per plan for any date range.
2. **Rates:** completion = `purchase` / `begin_checkout`; Back on Stripe's page =
   `checkout_canceled` / `begin_checkout`; left without paying and expired =
   `checkout_abandoned` / `begin_checkout`. The three don't have to add up to 100%: a buyer can
   cancel, then start again.
3. **Caveats:** browser events miss visitors whose blocker stops gtag, while server events don't
   (see "Opt-outs"), so the completion rate reads slightly high. For abandons, count unique
   `checkout_session_id` (see "Redeliveries can double-count").
