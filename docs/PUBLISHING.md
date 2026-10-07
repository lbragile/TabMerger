# Publishing Guide

> This file is the *setup* reference (one-time secrets, store accounts). For the
> step-by-step process of actually cutting a release, see
> [`docs/RELEASE_SANITY_CHECK.md`](RELEASE_SANITY_CHECK.md) and the
> `.claude/skills/release-checklist` skill — they reflect the current pipeline and
> supersede anything below that conflicts.

## Automated pipeline (current shape)

- Version numbers are managed by **semantic-release** (`.releaserc.json`), not by hand-editing
  `packages/extension/package.json`. `package.json`'s version is never bumped by CI — the git
  tag is the sole source of truth for what ships.
- Releases are cut from two branches. `main` cuts **stable** versions (`vX.Y.Z`): a push to it
  releases whenever it carries a release-worthy commit since the last stable tag. `beta` (a
  semantic-release prerelease branch) cuts `vX.Y.Z-beta.N`. Stable store jobs wait for approval
  in the `store-stable` environment, and the Chrome job only uploads a draft. To pause stable
  releases, narrow the `release` job's condition in `ci.yml` back to `beta`.
- Commit scopes `ci`, `release`, `publish`, `e2e`, `demo`, `dev`, and `web` never trigger a
  release, regardless of commit type. A commit body line starting with `BREAKING CHANGE:`
  (with the colon) always forces a major release, even in an otherwise-suppressed scope.
- A tag on `beta` fires `.github/workflows/publish.yml`, which builds the extension via WXT and
  publishes to the **private BETA Chrome Web Store item only** — a separate listing from the
  public stable one. Firefox and Edge stable publishing, and the public Chrome listing, are
  wired into the same workflow but only run for a non-prerelease `release` event.
- Only **stable** releases get their packages attached as GitHub Release assets. Beta builds get
  none, because the repo is public and the beta Chrome listing is invite-only: testers install the
  Chrome beta from its store item and the Firefox beta from the self-hosted link below.
- `packages/extension/scripts/manifestVersion.ts` maps the semver tag onto MV3's numeric
  `manifest.version` + free-form `version_name` — MV3 rejects a prerelease suffix in `version`
  outright. The beta channel's mapped major is intentionally offset by
  `BETA_STORE_MAJOR_OFFSET` (see that file for why — an accidental early release permanently
  raised the floor on the BETA item's accepted version numbers).
- `.github/workflows/deploy-web.yml` deploys a Vercel **preview** (not production) of
  `packages/web`, called from `ci.yml` after CI passes on `main`, aliased to a fixed
  `tabmerger-preview.vercel.app` URL.
- `.github/workflows/deploy-web-production.yml` deploys `packages/web` to Vercel
  **production** (`tabmerger.vercel.app`). It runs automatically when a **stable** (non-prerelease)
  GitHub release is published, and manually from the Actions tab. Every run waits for approval in
  the `vercel-production` environment. See "Step 4 — Vercel" below.

Read the workflow files themselves for the authoritative, heavily-commented behavior — a lot of
non-obvious constraints (artifact glob patterns, `include-hidden-files`, publisher IDs, etc.)
are documented inline there and are easy to get stale in a separate doc.

---

## Browsers and stores

Where each browser gets TabMerger, under which ID, and whether the website can talk to it. An
extension installed from the Chrome Web Store keeps the **same ID in every Chromium browser**, so
Chrome, Edge, Brave, Vivaldi, Arc and Opera installs from that store all behave identically.
Store-listing details:
`packages/extension/CHROMEWEBSTORE.md` (Chrome/Edge) and `packages/extension/FIREFOXADDONS.md`
(both Firefox add-ons).

### Stable

| Browser | Where users install | Extension ID | Updates from |
| --- | --- | --- | --- |
| Chrome | [Chrome Web Store](https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc) | `inmiajapbpafmhjleiebcamfhkfnlgoc` | Chrome Web Store |
| Edge | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn) (default), or the Chrome Web Store after "Allow extensions from other stores" | `eogjdfjemlgmbblgkjlcgdehbeoodbfn` (Edge store) / the Chrome ID (Chrome Web Store) | The store it was installed from. Edge Add-ons certification takes up to 7 business days per release, so Edge-store users lag Chrome |
| Brave, Vivaldi, Arc | Chrome Web Store | Chrome ID | Chrome Web Store |
| Opera | Chrome Web Store, via Opera's "Install Chrome Extensions" add-on | Chrome ID | Chrome Web Store |
| Firefox | [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/tabmerger/) | Add-on GUID `{19feb84f-3a0b-4ca3-bbae-211b52eb158b}` (set in `wxt.config.ts`; **never change it**, or existing users stop receiving updates) | AMO |
| Safari | Not supported | | |

An Edge user can end up with both the Edge Add-ons copy and the Chrome Web Store copy: they have
different IDs, so Edge treats them as two extensions.

### Beta

| Browser | Where testers install | Extension ID | Access |
| --- | --- | --- | --- |
| Chrome, Edge, Brave, Vivaldi, Arc, Opera | [TabMerger BETA on the Chrome Web Store](https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd) (Edge: after "Allow extensions from other stores"; Opera: via its add-on) | `nboljhidpjakiohfdkdjkcljdehcapcd` in every one of them | Private: members of the Google Group [tabmerger-beta-testers](https://groups.google.com/g/tabmerger-beta-testers), signed in to the store with that Google account |
| Firefox | Unlisted, self-distributed add-on, signed in CI, files on Vercel Blob, auto-updating via `update_url`: install from `<beta site>/beta#firefox` (see `packages/extension/FIREFOXADDONS.md`) | Add-on ID `tabmerger-beta@lbragile.com` | Anyone with the link (Firefox has no private listings) |
| Safari | Not supported | | |

There is deliberately no separate Edge beta item: Edge Add-ons has no tester list (only Public or
Hidden), certifies each submission in up to 7 business days, and would issue a new ID.

### Website ↔ extension messaging

The website sends `PING` (install detection), `SYNC_AUTH` (hand its sign-in to the extension) and
`SYNC_NOW` to the extension (`packages/web/lib/extensionMessaging.ts`):

| Browser | Transport | Needs |
| --- | --- | --- |
| Chromium browsers | `chrome.runtime.sendMessage` via `externally_connectable` | The ID in the website's env: `NEXT_PUBLIC_CHROME_EXTENSION_ID` (production = stable ID, preview = BETA ID) and, production only, `NEXT_PUBLIC_EDGE_EXTENSION_ID` = `eogjdfjemlgmbblgkjlcgdehbeoodbfn`. The website tries each and uses the first that answers |
| Firefox | `window.postMessage`, relayed by a content script on the website's own origin that ships **in Firefox builds only** | No ID (Firefox gives each install a random internal address). Firefox users see one site permission for the TabMerger website; Chromium builds gain no permission |

Everything else (sign-in inside the extension, sync, sharing) works in every browser regardless
of messaging; only the website-driven shortcuts depend on it.

### Google sign-in: Supabase redirect URLs

Each Supabase project's **Authentication → URL Configuration → Redirect URLs** must list every
extension build that signs in to it, plus the websites. The extension's Google sign-in returns to
`identity.getRedirectURL()`; when that URL isn't listed, Supabase silently falls back to the
project's **Site URL**, so the sign-in window opens the website (or `localhost`, if the Site URL
was left at the local default) instead of finishing. Set the Site URL to the real site, never
`localhost`, so a missing entry fails visibly.

Add each extension URL exactly, ending in `/`. Never use a wildcard like `*.extensions.allizom.org`
or `*.chromiumapp.org`: any other extension could then receive TabMerger sign-ins.

| Build | Redirect URL |
| --- | --- |
| Chrome stable (also Brave, Vivaldi, Arc, Opera, and Edge via the Chrome Web Store) | `https://inmiajapbpafmhjleiebcamfhkfnlgoc.chromiumapp.org/` |
| Chrome BETA (every Chromium browser) | `https://nboljhidpjakiohfdkdjkcljdehcapcd.chromiumapp.org/` |
| Edge Add-ons stable | `https://eogjdfjemlgmbblgkjlcgdehbeoodbfn.chromiumapp.org/` |
| Firefox stable | `https://541d995cc738c669c050dc1dcfbb4b46a2dcbff1.extensions.allizom.org/` |
| Firefox BETA | `https://b00b8167da1d804b7108f9915bfd2eb660504ff8.extensions.allizom.org/` (confirmed working 2026-09-29) |
| Websites | `https://tabmerger.vercel.app/**`, `https://tabmerger-preview.vercel.app/**` |

Chromium's host is the extension ID. Firefox's is the SHA-1 (hex) of the add-on ID, e.g.
`node -e "console.log(require('crypto').createHash('sha1').update('tabmerger-beta@lbragile.com').digest('hex'))"`;
confirm with `browser.identity.getRedirectURL()` in the add-on's console (`about:debugging` →
Inspect). A new store item or add-on ID needs a new entry. The local stack's list is in
`supabase/config.toml`.

**A copy loaded unpacked has a different ID.** Chrome derives an unpacked extension's ID from its
folder path (the manifest has no `key`), so a release zip unzipped and loaded by hand is neither
the store ID nor the dev ID, and its sign-in falls back to the Site URL. To find out what a copy
uses, run `chrome.identity.getRedirectURL()` in its service worker console (`chrome://extensions`
→ Inspect views). Either install the store build, or add that URL temporarily and remove it
afterwards; the website's extension messaging still only reaches the store ID. The preview
project gained such an entry, `https://hjdgjhiidldknnhdcboiaceofladfgbh.chromiumapp.org/`, on
2026-09-29 for testing beta.7 before the store approved it.

---

## Prerequisites: one-time setup

### Step 1 — Chrome Web Store

1. Sign in to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. There are **two listings**: the public stable item and a separate private BETA item (own
   name, own ID). Note both Extension IDs.
3. Go to the [Google API Console](https://console.developers.google.com/) → create OAuth 2.0
   credentials, then run the auth flow to get a refresh token (`chrome-webstore-upload-cli`'s
   auth helper: `npx chrome-webstore-upload-cli@4 --help`).
4. Add to GitHub Secrets:
   - `CHROME_CLIENT_ID`
   - `CHROME_CLIENT_SECRET`
   - `CHROME_REFRESH_TOKEN`
   - `CHROME_PUBLISHER_ID` (the developer account ID — the segment after `/devconsole/` in the
     dashboard URL, **not** an extension ID; same value for both listings)

### Step 2 — Firefox AMO

1. Sign in to the [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/).
2. **API credentials** → generate an API key + secret.
3. Add to GitHub Secrets: `FIREFOX_API_KEY`, `FIREFOX_API_SECRET`.

### Step 3 — Edge Add-ons

1. Sign in to [Microsoft Partner Center](https://partner.microsoft.com/dashboard).
2. **Microsoft Edge → Overview** → the extension → copy the **Product ID** ("Extension identity").
3. **Microsoft Edge → Publish API**: enable the new experience, then **Create API credentials**.
   Copy the **Client ID** and the **API key**. The key has an expiry date: renew it here and
   update the secret before it lapses.
4. Add to the `store-stable` environment's secrets: `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`,
   `EDGE_API_KEY`.

`publish.yml` uses version 1.1 of the Edge Add-ons Update REST API (`Authorization: ApiKey …` plus
`X-ClientID`). Version 1, which sent an access token, ended on 2024-12-31. The API uploads the
package and submits it for certification; the listing text and screenshots can only be changed
in Partner Center.

### Step 4 — Vercel

1. Install the Vercel CLI: `npm install -g vercel`.
2. Run `vercel link` from `packages/web/`.
3. Add to GitHub Secrets: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.
   (`VERCEL_PROJECT_ID` starts with `prj_`; don't swap the two IDs.)

**Preview** uses the `vercel-preview` GitHub environment. **Production** uses a separate
`vercel-production` environment:

1. GitHub → Settings → Environments → New environment → `vercel-production`.
2. Enable **Required reviewers** and add the maintainer, so every production deploy waits for an
   approval click.
3. Deployment branches and tags: a release run executes on the release's tag, a manual run on
   `main`, so either allow both (`main` and `v*` tags) or leave it unrestricted.
4. Add the same three secrets to that environment: `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
   `VERCEL_PROJECT_ID`. Anything the production build needs (`NEXT_PUBLIC_*`, server keys) lives in
   Vercel's own **Production** environment variables, which `vercel pull` loads.

How production is deployed:

- **Automatic:** publishing a stable release (the same event that triggers `publish.yml`) deploys
  that release's tag. Prereleases are ignored.
- **Manual:** Actions → "Deploy Web Production" → Run workflow, on the `main` branch. It refuses
  other branches, and refuses a commit that has no successful `CI` run.
- Production is built fresh with production env vars; a preview deployment is never promoted
  (`NEXT_PUBLIC_*` values are baked in at build time, so a preview carries the preview Supabase
  project).

Confirm a deploy: the job's **Verify the live site** step must be green (it checks `/`, `/privacy`
and that `/api/track` answers an extension preflight with a matching `Access-Control-Allow-Origin`),
and the job summary shows the deployed commit and deployment URL. Then open
`https://tabmerger.vercel.app/privacy` and check its "Last updated" date.

### Step 4b — Firefox beta hosting (Vercel Blob)

The self-distributed (unlisted) Firefox beta build is served from the BETA web app's own domain
(`tabmerger-preview.vercel.app/firefox-beta/...`), not a separate host — `next.config.ts` rewrites
`/firefox-beta/*` to a public Vercel Blob store. Path/file names come from the single shared
source of truth, `packages/shared/src/constants/firefoxBeta.ts` (`FIREFOX_BETA`), used by both the
web app's rewrite and CI's publish step.

1. Create (or reuse) a public Vercel Blob store for the project.
2. Set `FIREFOX_BETA_BLOB_BASE_URL` (its public base, e.g.
   `https://<id>.public.blob.vercel-storage.com`) as a Vercel environment variable on the
   **Preview** environment only — the beta channel only exists on the preview deployment, and
   this is not a secret (it's just environment-specific, so it isn't hardcoded). Leave it unset on
   Production; the `/beta` page falls back to a short "coming soon" line when it's unset.
3. CI's publish step (`packages/extension/scripts/publishFirefoxBeta.ts`, run from the
   `publish-firefox-beta` job in `publish.yml`) uploads the signed `.xpi` and `updates.json` to that store under the
   `FIREFOX_BETA.PATH` prefix, using `FIREFOX_BETA.XPI_CONTENT_TYPE` for the `.xpi`'s
   `Content-Type` so Firefox offers to install it directly from the link.
4. Add `FIREFOX_BETA_BLOB_TOKEN` to GitHub Secrets — a Vercel Blob **read-write** token for that
   store (Vercel dashboard → Storage → the Blob store → `.env.local` tab, or
   `vercel env pull` after `vercel link`). This is distinct from `FIREFOX_BETA_BLOB_BASE_URL`
   above: the base URL is a public, non-secret Vercel env var the *web app* reads to build its
   rewrite; this token is the *write* credential CI uses to actually upload files, and must
   never be exposed to the web app or any client.

Firefox's beta build also needs `FIREFOX_API_KEY`/`FIREFOX_API_SECRET` (Step 2 above) a second
time, this time with `--channel unlisted` rather than `--channel listed` — same AMO credentials,
different `web-ext sign` invocation, no additional secret to create.

### Step 5 — Which site and Supabase project each build uses (not secrets)

Each extension build's web app URL, Supabase URL and publishable key are **public** (compiled
into every build anyone can install), so they are plain values in `publish.yml`'s top-level
`env:`, not GitHub Secrets. The same goes for the Chrome Web Store item IDs:

| `publish.yml` env | Used by |
| --- | --- |
| `BETA_WEB_APP_URL`, `BETA_SUPABASE_URL`, `BETA_SUPABASE_PUBLISHABLE_KEY` | Chrome and Firefox BETA builds: the preview site and preview Supabase project (`xmofzeqcuyenmxgxjtrv`) |
| `PROD_WEB_APP_URL`, `PROD_SUPABASE_URL`, `PROD_SUPABASE_PUBLISHABLE_KEY` | Stable Chrome, Firefox and Edge builds: the production site and project (`jzgzdaileqxtsudbaouj`) |
| `CHROME_EXTENSION_ID`, `CHROME_BETA_EXTENSION_ID` | The store uploads, and each build's `externally_connectable` |

Beta and stable must use different projects: while both read one shared secret, the stable path
silently pointed at the preview project. Change these values only in `publish.yml` (and
`ci.yml`'s `PREVIEW_SUPABASE_*`, which must match the `BETA_*` pair). Without them a build falls
back to a placeholder Supabase URL and sign-in/sync silently fail.

CI's web build and web E2E run against the preview project (`ci.yml`'s top-level `env:`). The E2E
setup creates and deletes throwaway users through the admin API, so it needs the secret
`PREVIEW_SUPABASE_SERVICE_ROLE_KEY`: the **preview** project's service-role key, never
production's.

The real secrets are only the credentials: `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`,
`CHROME_REFRESH_TOKEN`, `CHROME_PUBLISHER_ID`, `FIREFOX_API_KEY`, `FIREFOX_API_SECRET`,
`FIREFOX_BETA_BLOB_TOKEN`, `RELEASE_TOKEN`, `VERCEL_TOKEN` (+ `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`), `PREVIEW_SUPABASE_SERVICE_ROLE_KEY`, and the not-yet-set
`EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`, `SENTRY_AUTH_TOKEN`.

---

## Releasing (current flow)

Cutting a release is a normal conventional-commit merge: to `beta` for a prerelease, to `main`
for a stable version. There is no manual version bump or manual `git tag`. A push to `main`
that carries only suppressed scopes (`web`, `ci`, `demo`, ...) or docs releases nothing, unless
release-worthy commits are still unreleased. See
[`docs/RELEASE_SANITY_CHECK.md`](RELEASE_SANITY_CHECK.md) for the full pre-flight/post-flight
checklist, and `.claude/skills/release-checklist` for the automated-gate summary.

A **stable** release also deploys the website: publishing the GitHub release triggers
`deploy-web-production.yml`, which pauses for approval in the `vercel-production` environment
(Actions → the run → Review deployments). Stable extension builds call the production site, so
approve it promptly. Web-only production deploys can be started manually from the Actions tab
(branch `main`, CI must have passed on that commit).

`publish.yml` also exposes a `workflow_dispatch` escape hatch to (re-)publish an already-tagged
beta version to the BETA listing only, for the case where a `release` GitHub event silently
failed to fire.

## Manual build (testing before release)

```bash
cd packages/extension

pnpm build            # Chrome MV3 → .output/chrome-mv3/
pnpm zip              # all store zips → .output/
```

Load unpacked in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select
`.output/chrome-mv3/` (or `.output/chrome-mv3-dev/` for a `pnpm dev:extension` build).

---

## Store review times (approximate)

- Chrome: 1–3 business days
- Firefox: 1–2 weeks (AMO review is manual)
- Edge: up to 7 business days (Microsoft's stated certification window)
- Firefox unlisted (the planned beta): automated signing, typically minutes

Plan releases accordingly.

## Rollback

- **Chrome**: Developer Dashboard → Versions → roll back to the previous version.
- **Firefox**: AMO doesn't support rollback — publish a patch version immediately.
- **Edge**: Partner Center → Submissions → can revert to a previous submission.

A store rollback does not revert git — follow with a revert commit so the next release doesn't
re-ship the same defect.
