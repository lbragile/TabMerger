# Contributing to TabMerger

TabMerger is a pnpm monorepo (extension + web app + shared package). Developers of all
experience levels are welcome to contribute.

## Contributions and the license

Contributions are welcome, and [`LICENSE.md`](../LICENSE.md) gives you everything you need to make
one: you may fork the repository, clone it, and change and run your copy to develop, test, and
propose a pull request.

By opening a pull request you confirm that you have the right to submit your changes, and you
grant the copyright holder a perpetual, irrevocable license to use, change, and distribute them as
part of TabMerger. Contributing doesn't give you any other rights to the project: your fork and
your changes may be used only to prepare contributions, not published, redistributed, or built
into anything else. The pull request template asks you to confirm this.

## Setup

```bash
git clone https://github.com/lbragile/TabMerger.git
cd TabMerger
pnpm install
```

See the root [`README.md`](../README.md) for environment file setup and dev-server commands.

## Before opening a PR

Run the same checks CI runs:

```bash
pnpm lint         # ESLint across extension + web
pnpm type-check   # TypeScript check across all packages
pnpm test         # Vitest unit tests (extension, web, shared)
pnpm test:e2e     # Playwright E2E (web app)
pnpm scan-secrets # Check staged files for API keys / PII
```

For extension-specific changes, also run:

```bash
pnpm --filter @tabmerger/extension test:integration  # real IndexedDB round trips
pnpm --filter @tabmerger/extension test:e2e           # extension E2E (Playwright)
```

A pre-commit hook (Husky) runs the secret scan automatically — don't bypass it with
`git commit --no-verify`.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/), enforced by
commitlint (`@commitlint/config-conventional`) on every commit via a Husky hook, and consumed
by `semantic-release` to decide version bumps and release notes.

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert` (the full conventional-commit set — see `@commitlint/config-conventional`).

**Scopes** are not restricted to a fixed list, but by convention match the part of the repo
touched — e.g. `extension`, `web`, `shared`, `demo`, `ci`, `release`, `publish`, `e2e`, `dev`.
A few scopes have special meaning to the release pipeline (see `.releaserc.json`): commits
scoped `ci`, `release`, `publish`, `e2e`, `demo`, `dev`, or `web` never trigger a version bump
or release, regardless of type. Use them for anything that can't change what a user installs.

**Major versions are avoided.** Only make a change that needs one when it is truly
unavoidable, and agree it with the maintainer first. Then, and only then, add a commit
body/footer line that starts with `BREAKING CHANGE:` (with the colon) — the only thing that forces
a major release, and it does so even in an otherwise-suppressed scope. Don't use that phrase
anywhere else in a commit message: in September 2026 a sentence *about* the rule was read as the
rule and published an unintended 4.0.0 beta.

Examples:

```
feat(extension): add keyboard shortcut to save all other tabs
fix(web): correct Stripe webhook signature verification
docs: rewrite CONTRIBUTING for the monorepo layout
chore(deps): bump wxt to 0.20.28
```

## Pull requests

1. Fork or branch, make your change, and confirm the checks above pass locally.
2. Open a PR using the provided template — describe what changed and how you tested it.
3. CI (`.github/workflows/ci.yml`) runs type-check, lint, unit/integration/E2E tests, and a
   secret scan on every PR. All required checks must pass before merge.
4. A reviewer will either merge or ask for changes. Repeat until merged.

See [`docs/`](../docs/) for architecture notes, the release process, and integration guides.

## Working with Claude Code agents

The repo ships domain agents (`.claude/agents/`) and their accumulated learnings
(`.claude/agent-memory/<agent>/`, indexed by each folder's `MEMORY.md`), so your agents start from
the same project knowledge. If your work turns up a non-obvious gotcha, add it as a new note in
the matching folder and list it in that folder's `MEMORY.md`. It's reviewed like any other docs
change. Keep notes technical and neutral, with no personal data, tokens or unreleased plans.
Notes named `feedback_*`, `project_*` or `user_*` are maintainer-private and git-ignored, so
don't add those.

## Reporting issues

Use the [bug report](ISSUE_TEMPLATE/bug_report.md) or
[feature request](ISSUE_TEMPLATE/feature_request.md) templates when opening a new issue.

## Security issues

Do not open a public issue for a security vulnerability — see [`SECURITY.md`](SECURITY.md).
