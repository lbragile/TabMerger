---
name: changelog-entry
description: Draft a commit message that passes this repo's commitlint config before committing.
disable-model-invocation: true
---

# Changelog entry

TabMerger uses `@commitlint/config-conventional` (see root `package.json`) and `semantic-release`
to generate the changelog from commit messages. A commit that doesn't match conventional-commit
format fails the `commit-msg` Husky hook and never lands.

## Format

```
<type>(<scope>): <subject>

[optional body]
```

- **type**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **scope**: optional, lowercase — e.g. `extension`, `web`, `ai`, `payments`, `db`
- **subject**: imperative mood, no trailing period, under ~72 chars
- `feat`/`fix` drive the semver bump (minor/patch); `BREAKING CHANGE:` in the body forces major

## Steps

1. Look at the staged diff (`git diff --staged`) to determine the real `type` and `scope` — don't guess from the branch name.
2. Draft the subject line summarizing *why*, not a file list.
3. Check it against the format above before handing it to `git commit`.
4. If unsure whether a change is `feat` vs `fix` vs `chore`, prefer the narrower/more accurate type — it affects the version bump.
