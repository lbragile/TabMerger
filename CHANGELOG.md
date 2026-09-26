# [3.1.0-beta.5](https://github.com/lbragile/TabMerger/compare/v3.1.0-beta.4...v3.1.0-beta.5) (2026-09-26)


### Features

* **extension:** hide AI features until they launch ([6d8fe0d](https://github.com/lbragile/TabMerger/commit/6d8fe0d1a91abba01f3ff92bdafa2d6c8e173f65))
* **shared:** add the AI feature flag helper ([945e4f1](https://github.com/lbragile/TabMerger/commit/945e4f14c28e0833ae2dcf31dfb9e4ca4cd2e1d1))
* **web:** refuse AI requests and AI purchases while AI is off ([63cbf63](https://github.com/lbragile/TabMerger/commit/63cbf63cb37aa06e8fb37fc63bdcb41c1585cc31))
* **web:** show AI as coming soon on the site ([7dff2d3](https://github.com/lbragile/TabMerger/commit/7dff2d3d8cbee0944cbab3490423fec225aaa347))

# [3.1.0-beta.4](https://github.com/lbragile/TabMerger/compare/v3.1.0-beta.3...v3.1.0-beta.4) (2026-09-26)


### Bug Fixes

* **ci:** allow a manual CI run that deploys a web preview ([e345f2c](https://github.com/lbragile/TabMerger/commit/e345f2caa686de7b828109cf892baff6e3fba2e1))
* **ci:** build the web preview standalone so pnpm symlinks upload cleanly ([ab11416](https://github.com/lbragile/TabMerger/commit/ab11416c8a47345b6d7a1707f58fc6209246885b))
* **ci:** correct the Vercel token-scope hint in the preview deploy ([15bba0c](https://github.com/lbragile/TabMerger/commit/15bba0c786be00120c8036cccac2cfe07967c456))
* **ci:** deploy a web preview on every agentic-revamp push ([e0f72d4](https://github.com/lbragile/TabMerger/commit/e0f72d4619bad647d24954e7211d1fcdd6015267))
* **ci:** deploy the web preview only after CI passes, and fix release-config ([ddfca1b](https://github.com/lbragile/TabMerger/commit/ddfca1b3c8331c94222cfe38c5286abdb86bf6ea))
* **ci:** diagnose Vercel project-access failures in the preview deploy ([e521c45](https://github.com/lbragile/TabMerger/commit/e521c4567fdfd7385b0b0887fb47f8bd34f21576))
* **ci:** gate releases on builds and ship store builds with Supabase config ([ffdcfdc](https://github.com/lbragile/TabMerger/commit/ffdcfdc5b8171b89d6b2784c21bfaaec492ff37c))
* **ci:** log which revision the beta cancel withdrew ([71dd7c8](https://github.com/lbragile/TabMerger/commit/71dd7c8c4afeb1a477db0a0f7e6c3a84e6796def))
* **ci:** read the preview URL from the deploy CLI's JSON output ([548eee9](https://github.com/lbragile/TabMerger/commit/548eee9a8fb3964caf0999ef4038dfa3199ff17f))
* **ci:** stop an apostrophe from breaking the preview URL step ([af46657](https://github.com/lbragile/TabMerger/commit/af466575ace47b4d888adeb7aec9da1be1549083))
* **extension:** build beta and demo as production, not development ([bf6691f](https://github.com/lbragile/TabMerger/commit/bf6691f93434410c64a4bcab0238edbf8d89858c))
* **extension:** de-emphasize the encryption reset in Settings ([bc62fbd](https://github.com/lbragile/TabMerger/commit/bc62fbdc26ad9ee5225964466e02bd40c34a28e3))
* **extension:** make the auth modal's label-to-input gaps actually render ([15b780a](https://github.com/lbragile/TabMerger/commit/15b780a210eebcc88c336c5bafeeb2cb20cac65b))
* **extension:** show current groups in the right-click menu ([ff41f32](https://github.com/lbragile/TabMerger/commit/ff41f3270f1fb19caaa6a7f47dd4251e06986dbe))
* **publish:** keep beta store versions above the accidental 4.0.0.1 ([e1264df](https://github.com/lbragile/TabMerger/commit/e1264df0c005b5c4f63ff55eba292cc7813f2e89))
* **release:** only cut a major release for a keyword note with its colon ([95bab8a](https://github.com/lbragile/TabMerger/commit/95bab8a2afc2528a99d5550ad51d25603f0a2ec5))
* **web:** answer CORS preflights for the extension's /api calls ([dd6eb45](https://github.com/lbragile/TabMerger/commit/dd6eb4517db599dcde666aca183a43c07f32e93f))
* **web:** hide the review stats divider when the stats stack on mobile ([5139c02](https://github.com/lbragile/TabMerger/commit/5139c02890197a5ad98920bafd24aae5bbe63119))
* **web:** list v3.0.0 on the changelog page ([fe0ad2c](https://github.com/lbragile/TabMerger/commit/fe0ad2cf754eae0b4de2f6132b991d2931715359))
* **web:** replace invented changelog history with the real releases ([dabe68e](https://github.com/lbragile/TabMerger/commit/dabe68eec7561f9a7293cbff15b1c01240dbf113))
* **web:** resolve Stripe redirect URLs at runtime, per deployment ([934554d](https://github.com/lbragile/TabMerger/commit/934554d0306ebda3b1cd14724eff03f0bae61a01))
* **web:** route the pricing page's billing portal through absoluteUrl ([4d6222b](https://github.com/lbragile/TabMerger/commit/4d6222be9dab454ae0bb9507335f3d93ff706cf5))


### Features

* **ci:** link the web preview on its commit ([8505730](https://github.com/lbragile/TabMerger/commit/850573062a3f7a9dd23712b0b0467579b58740c1))
* **ci:** serve the web preview at a fixed URL ([06624c7](https://github.com/lbragile/TabMerger/commit/06624c79f7edb06bad2e6b78715e70511bca1aa0))
* **extension:** always show Archived and Sessions, and save sessions there ([5d3d065](https://github.com/lbragile/TabMerger/commit/5d3d065e2a60f682afcb628ac2f670b2d2cf6834))
* **extension:** consolidate group actions and add Now Open window controls ([96b604b](https://github.com/lbragile/TabMerger/commit/96b604bc118d4315b368239bbeb6b1f27a9be601))
* **release:** don't cut a version for scopes that can't change the extension ([6731758](https://github.com/lbragile/TabMerger/commit/6731758e50988944cfdfea5b487dd6aefbc33bfa))
* **web:** add the untagged v1.0.0-v1.1.3 releases to the changelog ([9f57275](https://github.com/lbragile/TabMerger/commit/9f572754a4f1699902ea8bdd9b88a4a0191b6835))
* **web:** add v1.1.1, v1.1.2, v1.3.1, v1.4.1 and v1.4.2 to the changelog ([9aa3d5d](https://github.com/lbragile/TabMerger/commit/9aa3d5de7bbcebc40658f9487094f21a94ef61ec))
* **web:** add Vercel Web Analytics and Speed Insights ([78d56b3](https://github.com/lbragile/TabMerger/commit/78d56b33020cb7f26db6fce731656497792f738c))
* **web:** censor profanity in store reviews shown on the site ([72d1048](https://github.com/lbragile/TabMerger/commit/72d1048a5ec2bc15f697a68bc7efd68e79cb6170))
* **web:** center the sign-in and sign-up forms and drop the button glow ([f6c6277](https://github.com/lbragile/TabMerger/commit/f6c62779e88cf2b8621b37e040d62381b84c80bd))
* **web:** let visitors step and swipe through the reviews ([6f8a99d](https://github.com/lbragile/TabMerger/commit/6f8a99da070cfbef2a754f8916cfd98a8469fb20))
* **web:** show real store reviews in place of invented testimonials ([4ad07ef](https://github.com/lbragile/TabMerger/commit/4ad07efe1909be5b4845dd42b64f33d8d1c935be))


### Reverts

* **release:** undo the accidental 4.0.0-beta.1 release commit ([617da09](https://github.com/lbragile/TabMerger/commit/617da09273d60fa5599f101ec250587e0f7e18cd))

# [3.1.0-beta.3](https://github.com/lbragile/TabMerger/compare/v3.1.0-beta.2...v3.1.0-beta.3) (2026-09-23)


### Bug Fixes

* **ci:** install nothing — use npx in the publish jobs ([a3caeb9](https://github.com/lbragile/TabMerger/commit/a3caeb9e38d03e064f1637a43d6c3abae9bdb184))
* **ci:** pass PUBLISHER_ID to the Chrome Web Store publish jobs ([be23033](https://github.com/lbragile/TabMerger/commit/be23033ba6184de040cd83bdd23e8624b7f50277))
* **ci:** upload artifacts from .output, a hidden directory ([c65b286](https://github.com/lbragile/TabMerger/commit/c65b28676651f57e2a5ea5915e4388825af4a6a8))
* **e2e:** finish the URL-rule fixture server, completing aa6c361 ([d1e649c](https://github.com/lbragile/TabMerger/commit/d1e649cdb2d65a8a6028a32e6831f83769ce445b)), closes [#4](https://github.com/lbragile/TabMerger/issues/4)
* **release:** stop @semantic-release/github commenting on issues ([aa6c361](https://github.com/lbragile/TabMerger/commit/aa6c361ecb828874361dc14c174ecb8f8a25dc67))


### Features

* **ci:** cancel an in-flight beta submission before uploading ([a659102](https://github.com/lbragile/TabMerger/commit/a65910264377698f1db061ddc142ac7205385dd6))

# [3.1.0-beta.2](https://github.com/lbragile/TabMerger/compare/v3.1.0-beta.1...v3.1.0-beta.2) (2026-09-21)


### Bug Fixes

* **ci:** give the release checkout the PAT instead of stripping credentials ([c439976](https://github.com/lbragile/TabMerger/commit/c43997604324f52ce0d8bef8f237160268897854))
* **ci:** match the zip filenames WXT actually produces ([94c2b1a](https://github.com/lbragile/TabMerger/commit/94c2b1a9028bc7a75859087ef4da4de5a9aa6107))
* **ci:** release with a PAT so publish.yml actually triggers ([d122ab8](https://github.com/lbragile/TabMerger/commit/d122ab8201154029c53c394069baa55fc306ab79))

# [3.1.0-beta.1](https://github.com/lbragile/TabMerger/compare/v3.0.0...v3.1.0-beta.1) (2026-09-20)


### Bug Fixes

* **ci:** export CHROME_EXTENSION_ID_BETA, not CHROME_EXTENSION_ID ([06e7f04](https://github.com/lbragile/TabMerger/commit/06e7f04029bcb869598f701a326148207785e354))
* **ci:** let packageManager drive the pnpm version ([585e3b7](https://github.com/lbragile/TabMerger/commit/585e3b7e7fd6e333ef737fdf668c55906ea5c34d))
* **deps:** bound brace-expansion overrides per major ([192e543](https://github.com/lbragile/TabMerger/commit/192e543e709c872d40795f9a4a5e1c166413b720))
* **deps:** clear all critical and high advisories ([e19daf1](https://github.com/lbragile/TabMerger/commit/e19daf1df35ad08868fa69300f1e8c51b5c2afc4))
* **extension:** clear the remaining lint warnings ([a78d075](https://github.com/lbragile/TabMerger/commit/a78d075ca3d4383d1854f9c84e2a57a210defb5f))
* **extension:** generate WXT types on install ([108191e](https://github.com/lbragile/TabMerger/commit/108191e1a9061a374ecd169f6ac784443849c45d))
* **extension:** restore icon assets dropped in ea8b0d5 ([1bef466](https://github.com/lbragile/TabMerger/commit/1bef4665d8a372d2eb1bc4e4567d32ff5d2f1f27))
* **extension:** stop the Supabase client crashing when env is absent ([d45989c](https://github.com/lbragile/TabMerger/commit/d45989ca6ee266b7729eb9cd8ce8f511ce4f0a3e))
* **payments:** upsert subscriptions on user_id, not id ([ad01730](https://github.com/lbragile/TabMerger/commit/ad0173033e2d5d602d64a7a2b07fe69a6f69ceca))
* **web:** 404 unknown share slugs, and retire dead landing-page tests ([9f5fb82](https://github.com/lbragile/TabMerger/commit/9f5fb82c4b6f6cc51c1814f13e18ac26bf3a5a7a))
* **web:** resolve react-hooks/set-state-in-effect across the app ([23dee44](https://github.com/lbragile/TabMerger/commit/23dee4482e6612effabf7de6e4cb4d5917d6c3fe))
* **web:** stop module-scope SDK clients crashing the build ([de838ee](https://github.com/lbragile/TabMerger/commit/de838ee9ff56a447089b36428ba9fd44533619bb))
* **web:** stop supabase/server.ts crashing every request without env ([ddfc945](https://github.com/lbragile/TabMerger/commit/ddfc9451d23ad4f7f5a19c77f08d8bc23a710c54))


### Features

* **extension:** finish popup drag and drop ([0f37973](https://github.com/lbragile/TabMerger/commit/0f37973340adc5e993d6e35b6f027a8f8658e932))
* **extension:** rebuild popup drag and drop on native HTML5 drag ([4b2a559](https://github.com/lbragile/TabMerger/commit/4b2a559e383fdc8fe5442414e5772a5f11a95287))
* **web:** drive the changelog page from generated CHANGELOG.md ([1fe126b](https://github.com/lbragile/TabMerger/commit/1fe126b98ecc3286950e267fb11bae85039c3508))
