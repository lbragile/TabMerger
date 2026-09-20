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
