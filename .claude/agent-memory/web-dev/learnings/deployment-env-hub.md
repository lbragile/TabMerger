---
name: deployment-env-hub
description: lib/deployment.ts is the only reader of host variables (DEPLOY_ENV/VERCEL_ENV, commit SHA, DEPLOY_PLATFORM); how NEXT_PUBLIC_DEPLOY_ENV is derived in next.config env, empty-string-as-unset, isHostedDeployment for dev-only gates
metadata:
  type: reference
---

`lib/deployment.ts` is the hub for "where does this run". Nothing else reads `VERCEL_*` (or any
host's names); a grep for `VERCEL` outside tests and that file should only hit comments.

- **Server env:** `deployEnv()` = `DEPLOY_ENV || VERCEL_ENV || NEXT_PUBLIC_DEPLOY_ENV`, normalised
  to `production | preview | development`. Use `||`, not `??`: tests stub variables to `''`.
- **Browser env:** `clientDeployEnv()` reads `process.env.NEXT_PUBLIC_DEPLOY_ENV`, which
  `next.config.ts` defines in `env` from `deployEnv()` at build time (`buildTimeEnv()`). The
  access must stay a literal `process.env.NAME` member expression for Next to inline it, so it
  lives inside the helper and is not built from a variable key. Deriving it in config means a
  deploy sets one variable; before this, the deployed bundles had no `NEXT_PUBLIC_VERCEL_ENV` at
  all and every client `environment` tag was `development`.
- **next.config `env` inlines non-public keys too**, into server and client code wherever the name
  appears. `DEPLOY_COMMIT_SHA` / `DEPLOY_COMMIT_REF` are added only when set at build, so with
  nothing set the expression stays and the runtime fallback (`VERCEL_GIT_COMMIT_*`) still works.
- **Dev-only gates** (AI mock) use `isHostedDeployment()`: any of `DEPLOY_ENV`, `DEPLOY_PLATFORM`,
  `VERCEL_ENV`, `VERCEL` set, or a build-time env other than `development`. Every local build
  defines `NEXT_PUBLIC_DEPLOY_ENV=development`, so presence of that one can't be the test.
- **Tests:** stub every variable in the chain to `''` in `beforeEach` (a developer's shell could
  otherwise leak a value in). Old tests stubbing only `VERCEL_ENV` keep passing via the fallback.
- `getMetadataBase()` dropped the `VERCEL_URL` fallback: `NEXT_PUBLIC_APP_URL` is set everywhere
  (Stripe redirects already throw without it); a per-deployment host lacks the site's cookies.

Related: [[deployment-dependent-links]], [[production-deployment-gate]], [[platform-trusted-headers]].
