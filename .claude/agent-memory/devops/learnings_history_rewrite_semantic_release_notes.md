---
name: history-rewrite-semantic-release-notes
description: Rewriting history (git filter-repo) drops semantic-release's per-tag channel notes; prerelease tags then look unreleased and the next beta re-computes an existing version
metadata:
  type: project
---

semantic-release records each release's channel in a **git note** on the tagged commit, one notes
ref per tag: `refs/notes/semantic-release-<tag>` containing `{"channels":["beta"]}` for prereleases
(no note = the default channel). It reads them to decide which tags belong to a branch's channel.

After a history rewrite (e.g. `git filter-repo`, which changes commit SHAs and also strips GPG
signatures), the old notes point at commits that no longer exist, and a mirror built from scratch
doesn't carry `refs/notes/*` at all. Result on the first release from the rewritten repo: only the
stable tag (`v3.0.0`) is associated with `beta`, the analyzer computes `3.1.0-beta.1` again, the
`@semantic-release/git` prepare step **pushes the release commit**, and then `git tag` fails with
"tag already exists". So a failed run still leaves a stray `chore(release): …` commit on the branch.

**How to apply when rewriting history (or moving a repo):**
- Recreate the notes for every prerelease tag on its **new** commit, then push them:
  `git notes --ref semantic-release-<tag> add -f -m '{"channels":["beta"]}' <tag>` and
  `git push <remote> 'refs/notes/semantic-release-*:refs/notes/semantic-release-*'`.
  Verify each tag's commit matches the remote before writing (`git ls-remote`).
- Add "notes refs present for every prerelease tag" to the pre-push checks, next to
  fast-forward / tags / secret scans.
- `--partial` with a `^<last public commit>` ref keeps already-published history byte-identical
  (a full filter rewrites signed commits even when their trees are unchanged).
- If a release run fails after the prepare step, check the branch for a stray release commit and
  remove it before the next run.
