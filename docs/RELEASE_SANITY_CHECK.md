# Release sanity check

A **manual** run-through to do before and after each release. Deliberately not automated:
everything here is either a judgement call, a thing only a human eye catches, or a check
against an external system (the Chrome Web Store) that CI cannot assert on.

**Related, and different:**
- `.claude/skills/release-checklist` — the *automated* gates (lint, type-check, tests, zips).
  Run that first. This document assumes it passed.
- `.claude/plans/release-and-beta-channel-spec.md` — *why* the pipeline is shaped as it is.
- `docs/PUBLISHING.md` — one-time secret/store-account setup and the current pipeline shape.
  This document is the step-by-step checklist; PUBLISHING.md is the reference for what each
  secret is and how to obtain it.

Timebox: ~20 minutes for a beta, ~45 for a stable. If a step fails, **stop** — do not
proceed to the next section. Most of these checks are cheap precisely because the thing
they catch is expensive.

---

## 0. Decide whether to release at all

- [ ] Are there user-visible changes since the last release? `git log --oneline <last-tag>..HEAD`
- [ ] If every commit is `ci:`/`chore:`/`docs:`, **stop** — nothing to ship.
- [ ] **Scope decides too, not just type.** `.releaserc.json` suppresses scopes that cannot
      change what a user installs: `ci`, `release`, `publish`, `e2e`, `dev`, `demo`, `web`.
      A batch of only those cuts **no release**, by design — see
      `release-and-beta-channel-spec.md` §5.3a.
- [ ] If you expected a release and got none, check the scope before assuming CI is broken.
      `semantic-release --dry-run` (the `release-config` CI job) tells you what it decided.
- [ ] A `BREAKING CHANGE` footer always releases **major**, even in a suppressed scope. That
      override is deliberate and tested — don't remove the `breaking` rule.
- [ ] For a **stable** release: has the equivalent beta been live for **72h** with no `fix:`
      in the last 24h? (Policy: `release-and-beta-channel-spec.md` §3.)

---

## 1. Local pre-flight

Run from a clean tree on the branch you intend to release from.

```bash
git status                       # must be clean — uncommitted work will NOT be in the build
pnpm lint && pnpm type-check
pnpm --filter @tabmerger/extension test -- --run
pnpm scan-secrets
```

- [ ] `git status` clean. **This is the one people skip.** Working-tree changes are invisible
      to CI, so a "verified locally" build can differ from what ships.
- [ ] Lint, type-check, unit tests green — actual output seen, not assumed.
- [ ] `scan-secrets` clean, and **no tracked `.env` file** (`git ls-files | grep -E '^\.env'`
      must be empty — the CI job fails the build if any exists).

### Confirm the build contains what you think it does

```bash
pnpm build:extension
grep -c "<a string from your change>" packages/extension/.output/chrome-mv3/chunks/popup-*.js
```

- [ ] A string unique to this release's change is present in the bundle, and any string it
      replaced is at **zero** occurrences. Grepping the built artifact is the only check that
      proves source → bundle; a passing test suite does not.

---

## 2. Version and manifest mapping

The single most common silent failure. `package.json`'s version is **never** bumped in this
repo (no `@semantic-release/npm` plugin) — the git tag is the only source of truth, and CI
maps it through `packages/extension/scripts/manifestVersion.ts`.

- [ ] Expected mapping holds:

  | Tag | `version` | `version_name` |
  |---|---|---|
  | `v3.1.0` | `3.1.0` | `3.1.0` |
  | `v3.1.0-beta.3` | `3.1.0.3` | `3.1.0-beta.3` |

- [ ] MV3 only accepts 1–4 dot-separated integers in `version`. A prerelease suffix there is
      rejected by the store, which is the entire reason the mapping exists.
- [ ] A **local** build always shows `package.json`'s version (currently `3.0.0`) because
      `TABMERGER_MANIFEST_VERSION` is only exported in CI. Seeing `3.0.0` locally is correct
      and is **not** evidence of a stale build.

---

## 3. Manual UI sanity pass

Load the build unpacked: chrome://extensions → Developer mode → Load unpacked →
`packages/extension/.output/chrome-mv3`.

The dev build (`build:dev` → `.output/chrome-mv3-dev`) installs as **"TabMerger DEV"** with a
different name, so both can sit side by side. Use the production build for release checks —
the dev build points `externally_connectable` at `localhost:3000` and will fail every
web-app-dependent path unless `pnpm dev:web` is running.

### 3.1 Cold start

- [ ] Popup opens at **800×600** with **no outer scrollbars** in either axis. Any overflow
      here is a `min-w-0` propagation bug in a flex/grid ancestor chain — not something to fix
      with `overflow-x-auto` on an inner container.
- [ ] Sidebar/header seam lines up. `SidePanel`'s width and `Header`'s logo-column width must
      be numerically identical (240px). A mismatch is not cosmetic — it breaks the seam.
- [ ] No console errors on open (right-click popup → Inspect).
- [ ] Dark mode and light mode both render (toggle in Settings → General).

### 3.2 Core invariants

- [ ] **"Now Open" is index 0**, cannot be deleted, cannot be reordered away from the top.
- [ ] Its tab list reflects reality — open a new tab, confirm it appears.
- [ ] Right-click "Now Open" → there is **no** "Delete group".
- [ ] Create a group, rename it, add tabs, delete it. Undo restores it.
- [ ] Undo/redo buttons enable and disable correctly. (There is **no** Ctrl+Z — the header
      buttons are the only path. If that changes, update this line.)

### 3.3 Drag and drop

The highest-risk surface in the extension; it has broken in non-obvious ways repeatedly.

- [ ] Reorder groups in the sidebar via the **grip handle** (dnd-kit listeners are only on
      `[aria-label="Drag to reorder group"]`, not the whole row).
- [ ] Reorder windows within a group.
- [ ] Reorder tabs within a window.
- [ ] Drag a tab **across** windows.
- [ ] Drag a tab **across groups** (spring-open: hover a sidebar group to switch, then drop).
- [ ] Drag a tab onto "Drop here for a new window".
- [ ] Multi-select several tabs, drag the block — ordering is preserved, not reversed.
- [ ] Pinned/starred groups stay in their zone after any reorder.

### 3.4 Entitlements

Test as a **free** user (sign out) — the limits are what most installs actually hit.

- [ ] 6th group is blocked with an upgrade toast (free limit: 5 groups).
- [ ] 51st tab is locked with a padlock, not silently dropped (free limit: 50 tabs).
- [ ] AI actions show "Pro AI required — click to upgrade" rather than failing obscurely.
- [ ] Signed in as Pro: limits lift, cloud sync available.

### 3.5 Data safety

- [ ] Export produces a file; import round-trips it without loss.
- [ ] Signed in: edit a group, wait for sync, confirm it appears on a second device or after
      a reinstall.
- [ ] Run `/encrypt-status` — confirm the encrypted columns hold ciphertext
      (`{v:1,iv,ct}`), not plaintext, for every signed-in Pro row.

### 3.6 Whatever this release actually changed

- [ ] Exercise the specific change by hand. Tests prove the code path; only you can confirm
      the result is what a user would want.
- [ ] Exercise the **inverse** — the thing the change was supposed to leave alone. A scoped
      fix that quietly widens its blast radius passes every test written for the new path.

---

## 4. Cutting the release

- [ ] Confirm the branch. `ci.yml`'s release job is gated to `refs/heads/beta`. Pushing
      anywhere else runs the gates and stops — no tag, no release, no publish.
- [ ] **Workflow-file resolution differs by event type**, and this has burned us:
      - `push` → uses the workflow files **on the branch being pushed to**
      - `release` → uses the workflow files **on the default branch**

      So a CI fix must be on `beta` to affect the build, but on the default branch to affect
      publishing. Verify the fix you are relying on is on the branch that will actually run it.
- [ ] Preflight secrets check passes. It runs **before** semantic-release specifically so a
      missing secret is a clean retry rather than a stranded tag.

---

## 5. Store submission verification

**Check the Chrome Web Store dashboard, not the Actions checkmark.** A fully green pipeline
with nothing submitted has happened here more than once.

- [ ] Actions run green, and specifically the `publish-chrome-beta` job:
      - `Cancelling in-flight submission: {...}` **or** `No in-flight submission`
      - `Uploading tabmergerextension-beta-<version>-chrome.zip...`
      - `Publishing...`  ← **if this line is missing, the upload failed**
      - `Pending review`
- [ ] Dashboard → the item shows **Draft = the version you just cut**, with `version_name`
      carrying the prerelease suffix.
- [ ] Status is `Pending review`.
- [ ] Permissions list in the dashboard matches the previous release. A newly-added permission
      triggers a much slower review and may require justification — know before you're
      surprised by a week-long wait.

**Note:** `PENDING_REVIEW` is treated as *success* by the publish CLI, and the beta job
auto-publishes. Green means *submitted*, never *live*.

---

## 6. Post-publish

- [ ] Once review clears, install from the store listing (not unpacked) and repeat §3.1 and
      §3.2. A packaged build can differ from an unpacked one — CSP and resource loading
      especially.
- [ ] Upgrade path: install the **previous** version first, then update. Confirm existing
      IndexedDB data survives. A fresh install proves nothing about migrations.
- [ ] Web changelog at `/changelog` shows the new entry (built from repo-root `CHANGELOG.md`;
      prereleases are filtered out, so a beta will *not* appear — that's intended).
- [ ] Sentry: no new error signature in the hour after rollout.

---

## 7. Rollback

- [ ] Dashboard → **"Roll back to previous version"** acts on the published version.
- [ ] If a bad build is still in review: **cancel the submission** (Build → Status) rather
      than waiting it out.
- [ ] A store rollback does **not** revert git. Follow with a `revert` commit so the next
      release doesn't re-ship the same defect.

---

## Appendix — traps this pipeline has actually hit

Each of these cost real time. They are fixed; the point is to recognise the symptom fast if
it recurs.

| Symptom | Actual cause |
|---|---|
| `No files were found` on artifact upload | Glob used `tabmerger-`; WXT derives `{{name}}` from the **package** name → `tabmergerextension-` |
| `No files were found` *again*, identical message | `.output` is a dot-directory; `upload-artifact` v4.4+ skips hidden files unless `include-hidden-files: true` |
| `pnpm: command not found` (exit 127) | Publish jobs are separate runners with no checkout and no pnpm setup. `needs:` orders jobs, it does not share a toolchain |
| `Option "publisherId" is required` | `chrome-webstore-upload` v6 moved to CWS **API v2**, whose paths are `publishers/{id}/items/{id}` |
| `Permission denied on resource … (or it might not exist)` | Google masks NOT_FOUND as PERMISSION_DENIED. Wrong publisher ID, wrong owning account, or a read-only token scope — indistinguishable from the message alone |
| Release created but `publish.yml` never ran | Events created by the built-in `GITHUB_TOKEN` do not trigger workflows. Needs a PAT. **No trace is logged anywhere** |
| `Invalid username or token` in semantic-release | `persist-credentials: false` on checkout; the token must be passed to `actions/checkout` |
| `Resource not accessible by personal access token` | `@semantic-release/github` tried to comment on issues; disable `successComment`/`failComment`/`failTitle`/`releasedLabels` |
| Upload rejected while a review is pending | One in-flight submission per item. The beta job now cancels first; stable does not |
