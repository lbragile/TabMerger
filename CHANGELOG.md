## [3.1.2](https://github.com/lbragile/TabMerger/compare/v3.1.1...v3.1.2) (2026-10-10)


### Bug Fixes

* validate and sanitize user input across the extension and web app ([1833397](https://github.com/lbragile/TabMerger/commit/183339757804e30d4960ba87121dd7e783c053d5))


### Features

* **web:** play the feature tour video in the landing page hero ([3da0a60](https://github.com/lbragile/TabMerger/commit/3da0a60e80cab3750123381c1206106ba6a9d5f2))

## [3.1.1](https://github.com/lbragile/TabMerger/compare/v3.1.0...v3.1.1) (2026-10-09)


### Bug Fixes

* **extension:** close a dragged Now Open window at the drop ([c4813f2](https://github.com/lbragile/TabMerger/commit/c4813f2bc937dfa17fa6749aec0887aa43fbda63))
* **extension:** keep a keyboard move on the picked-up item when groups change ([01f75f2](https://github.com/lbragile/TabMerger/commit/01f75f2ab8a13f04eeeec6fb9b367da730534a3c))
* **extension:** keep a Now Open window open when copying it to a group ([fd2538d](https://github.com/lbragile/TabMerger/commit/fd2538d1d7bb266ebeef99e71ed97a2454ba6a21))
* **extension:** keep saved groups independent of open browser tabs ([3d9b5ae](https://github.com/lbragile/TabMerger/commit/3d9b5ae95d2a052aa5cd0bd8e076d6eb57a5d0ec))
* **extension:** open selection bar group menus with a mouse click ([f3fe102](https://github.com/lbragile/TabMerger/commit/f3fe1027c9795ce2acc888ff7480ef863745d657))
* **web:** apply billing events by subscription and current state ([05239a6](https://github.com/lbragile/TabMerger/commit/05239a68067f56bb1c4d46dcaccdf90fdb8cd486))
* **web:** do not serve the beta tester guide on the production site ([ee0e75e](https://github.com/lbragile/TabMerger/commit/ee0e75e69b3fbd284d51877edec68f0e862b9cc5))
* **web:** keep one subscription per account at checkout ([41da29c](https://github.com/lbragile/TabMerger/commit/41da29c29377d0faecb0902d4ca443cfc61ab1f4))


### Features

* **web:** accept promotion codes at checkout ([60ed004](https://github.com/lbragile/TabMerger/commit/60ed00410fd2c2ac595ddd62d7f424977494ef0a))
* **web:** link to the beta builds on the preview site ([069852c](https://github.com/lbragile/TabMerger/commit/069852c68b1c6b17aa4b83f41b87fef994b0cbb6))
* **web:** show ratings and reviews from all three stores ([8e2d6b2](https://github.com/lbragile/TabMerger/commit/8e2d6b27679bdece398d9373dbc9acca570faa0a))
* **web:** show the monthly equivalent of yearly prices on the home page ([2e7da95](https://github.com/lbragile/TabMerger/commit/2e7da9544f5a4deb1d23076ce180c2c195993be0))

# [3.1.0](https://github.com/lbragile/TabMerger/compare/v3.0.0...v3.1.0) (2026-10-07)


### Bug Fixes

* **db:** require an active paid subscription to write synced data ([46711e4](https://github.com/lbragile/TabMerger/commit/46711e4467e926693a6c3a128c8722fdeeb07fad))
* **extension:** ask before removing all windows when confirm-on-delete is on ([9ac4a13](https://github.com/lbragile/TabMerger/commit/9ac4a13f64f93586b5c5b5dbfd14f7562a876248))
* **extension:** ask for the passphrase once when unlocking a device ([0fdce0b](https://github.com/lbragile/TabMerger/commit/0fdce0b366e225943f15ec204a9cb65d040bb204))
* **extension:** ask storage to commit a change in the same tick it is written ([5df90de](https://github.com/lbragile/TabMerger/commit/5df90de3f577a7c2fa20f0d8358f81369a043baa))
* **extension:** build beta and demo as production, not development ([d83d1ea](https://github.com/lbragile/TabMerger/commit/d83d1ea7e01f1cbec07713538ea179609527486a))
* **extension:** clear the remaining lint warnings ([847d85a](https://github.com/lbragile/TabMerger/commit/847d85a624e46e34eb31856432dd71218268c4a9))
* **extension:** de-emphasize the encryption reset in Settings ([2a92a77](https://github.com/lbragile/TabMerger/commit/2a92a77bbdb76511b7dfd46c4a261843ba4a3c2c))
* **extension:** don't copy the move-source marker onto the drag ghost ([a8d0103](https://github.com/lbragile/TabMerger/commit/a8d0103f7b8f355152c2e4cc14c4aed4944710d5))
* **extension:** enforce Free plan limits on import and in the data layer ([05e15b7](https://github.com/lbragile/TabMerger/commit/05e15b73dea37d86efa4a48084c342135d29020c))
* **extension:** generate WXT types on install ([05c7d4e](https://github.com/lbragile/TabMerger/commit/05c7d4eccdc99be910d081d982f3d762ea070a77))
* **extension:** keep sync safe across key resets and account changes ([e2e24ce](https://github.com/lbragile/TabMerger/commit/e2e24ced6567e7efadc2252798824027d853d0bb))
* **extension:** let the page-images setting turn on, and say when it's off ([e5f3eaf](https://github.com/lbragile/TabMerger/commit/e5f3eaf9aaeb8f0dbbd2aeb7c0f481f18a2413c7))
* **extension:** let the website reach Firefox, and restore the live Firefox add-on ID ([f4e9fb7](https://github.com/lbragile/TabMerger/commit/f4e9fb704885fc8d92e5c396fbd7bf2184cecc8c))
* **extension:** make the auth modal's label-to-input gaps actually render ([2ca52c5](https://github.com/lbragile/TabMerger/commit/2ca52c5eaf21fda92e5dd66d28afb1004c847b20))
* **extension:** make toasts clickable over dialogs, and show their countdown ([44a7db9](https://github.com/lbragile/TabMerger/commit/44a7db9d5f3946fd5523f24209da16ced646f881))
* **extension:** only paid subscriptions get Pro, and free sessions stay local ([0a6edae](https://github.com/lbragile/TabMerger/commit/0a6edaec24a79586c9eee40da71ef7a13b60998a))
* **extension:** reopen saved incognito windows as incognito ([1d9bf1b](https://github.com/lbragile/TabMerger/commit/1d9bf1bee2246ef77574104aa14e3571de2b42fd))
* **extension:** require Firefox 140 (Android 142) ([09297ef](https://github.com/lbragile/TabMerger/commit/09297ef3ad1725c9b15def7ff9551598d4b34ad7))
* **extension:** restore icon assets dropped in ea8b0d5 ([b78e961](https://github.com/lbragile/TabMerger/commit/b78e961ea0bb5ff43861bb36158c123292b52a95))
* **extension:** say that sync comes with Pro in the sign-in dialog ([f938fa3](https://github.com/lbragile/TabMerger/commit/f938fa33f6adedebb35be5c5161d20027438531a))
* **extension:** show current groups in the right-click menu ([6e2fcfb](https://github.com/lbragile/TabMerger/commit/6e2fcfb64ba56d2f48b343a0b16654bc76a145d2))
* **extension:** show the drop gap after spring-open switches the group mid-drag ([22ef523](https://github.com/lbragile/TabMerger/commit/22ef5233cdf0d366c0801a04bed201d30f51d645))
* **extension:** start keyboard drags from the focused row and step through real targets ([5fbd294](https://github.com/lbragile/TabMerger/commit/5fbd294c56e9cf7fd2e418690ce5a057a7fe9fb9))
* **extension:** stop sync losing edits, deletes and group order ([5e56723](https://github.com/lbragile/TabMerger/commit/5e56723cdb251ecca27e5181f10950358f3f2952))
* **extension:** stop the Supabase client crashing when env is absent ([05f84ec](https://github.com/lbragile/TabMerger/commit/05f84ec36872a6f24f93da2f39ec22eef082319d))
* **payments:** upsert subscriptions on user_id, not id ([6303a22](https://github.com/lbragile/TabMerger/commit/6303a2202ede5ffa79f96e5f0fb937d8ba78d385))
* **supabase:** make the seed work with the sign-up trigger ([b0cfb3d](https://github.com/lbragile/TabMerger/commit/b0cfb3da42efcc5eeeccd5ae83d38f7dc7e7e03c))
* **web:** 404 unknown share slugs, and retire dead landing-page tests ([0bc836b](https://github.com/lbragile/TabMerger/commit/0bc836b53df51672e4eac871e33b660568a56614))
* **web:** answer CORS preflights for the extension's /api calls ([f75188f](https://github.com/lbragile/TabMerger/commit/f75188f489d14e76a7cb29ccf3c3a06d176df0a5))
* **web:** ask for the new passphrase after a reset and mark locked items ([c205d77](https://github.com/lbragile/TabMerger/commit/c205d771dcbd7aec846f72909c59980212c168d4))
* **web:** disclose the favicon lookup and list shortcuts under Free ([497bf6c](https://github.com/lbragile/TabMerger/commit/497bf6c0e2fd39337fb821b8fe604de764b6b648))
* **web:** draw the toast dismiss button as a plain icon inside the toast ([c044fb3](https://github.com/lbragile/TabMerger/commit/c044fb32ed9872e4af527d37cd2d77f07e52f888))
* **web:** encrypt dashboard shares entirely in the browser ([c3cc9b8](https://github.com/lbragile/TabMerger/commit/c3cc9b84a5f1b385ab9c2b0bbd503393e9537e64))
* **web:** find page preview images on more sites ([ce68733](https://github.com/lbragile/TabMerger/commit/ce687336be6fad464dc59cdd4a3cab360655b90e))
* **web:** find preview images on more pages ([de27986](https://github.com/lbragile/TabMerger/commit/de2798628b51376bdffafb29d70cbbd3931cfa70))
* **web:** fit the signed-in header on phones ([f317585](https://github.com/lbragile/TabMerger/commit/f3175852ad21991f97ae13cdf5b34cb477b66a61))
* **web:** fold import and export into the beta Settings section ([b6baa2c](https://github.com/lbragile/TabMerger/commit/b6baa2c19120be810e8d121461d37bd79e095fc8))
* **web:** go straight in after sign-up when no email confirmation is needed ([24b1ead](https://github.com/lbragile/TabMerger/commit/24b1eadc55f66ef67d100001c6c7321e3e93f7ec))
* **web:** hide the review stats divider when the stats stack on mobile ([47db688](https://github.com/lbragile/TabMerger/commit/47db688a516f12bb1b57e6b7d50059981f95b7b4))
* **web:** list the beta page under Public in the footer ([7d7c466](https://github.com/lbragile/TabMerger/commit/7d7c4663a7f3f88db0eab170e3ee3b939976dd53))
* **web:** list v3.0.0 on the changelog page ([891133b](https://github.com/lbragile/TabMerger/commit/891133b07146ba9450d2662345436c509e363465))
* **web:** log why contact emails fail, and tidy the beta report buttons ([7af7fcd](https://github.com/lbragile/TabMerger/commit/7af7fcd99de3ae95ff9b6391243677ba7f37c484))
* **web:** make the contact form's sender and inbox configurable ([e37e542](https://github.com/lbragile/TabMerger/commit/e37e542370af6a245bf203d132ae713c53219c55))
* **web:** make the dashboard sync label live and accurate ([508badd](https://github.com/lbragile/TabMerger/commit/508badd97135c33bbd4ed77054cdecdff3ff5d6e))
* **web:** make the dashboard's per-group Share link work ([89c3ef2](https://github.com/lbragile/TabMerger/commit/89c3ef247a17674ac5cabef6da6434161300dabf))
* **web:** never move the dashboard's last-synced label backwards ([c5e01ea](https://github.com/lbragile/TabMerger/commit/c5e01ea603700594fe19224f82a7ccae8a328616))
* **web:** open the pricing toggle on Monthly and drop the "Billed" line ([d817fac](https://github.com/lbragile/TabMerger/commit/d817facb1fe37d53f649bf026338a0f7cb54f054))
* **web:** point the beta page at the tabmerger-beta-testers group ([448b18a](https://github.com/lbragile/TabMerger/commit/448b18accec7a8c845e6ca1c654a01cbe2622520))
* **web:** replace invented changelog history with the real releases ([bc2cdce](https://github.com/lbragile/TabMerger/commit/bc2cdcee163be465a2e6db48e3f59adf092951ba))
* **web:** resolve react-hooks/set-state-in-effect across the app ([2554b7e](https://github.com/lbragile/TabMerger/commit/2554b7ed0ed74196fb5fe03678c77865e51b3c86))
* **web:** resolve Stripe redirect URLs at runtime, per deployment ([93a6108](https://github.com/lbragile/TabMerger/commit/93a6108db35fa9fb5b5322150f1025c7522de010))
* **web:** route the pricing page's billing portal through absoluteUrl ([1a976f1](https://github.com/lbragile/TabMerger/commit/1a976f1be5ea5538dacff7145a764f18b44475be))
* **web:** show plain favicons and working previews on shared groups ([b7eec70](https://github.com/lbragile/TabMerger/commit/b7eec7093f0b9d02d95ebd6dabd6407c2e57e9c3))
* **web:** show the currency on Billing Portal prices ([4f2f93e](https://github.com/lbragile/TabMerger/commit/4f2f93e1fb0da1c56746444a88d636d24ab18754))
* **web:** stop module-scope SDK clients crashing the build ([e83dbc3](https://github.com/lbragile/TabMerger/commit/e83dbc3e8d40e51bdaf6ba5739509b68f2a90928))
* **web:** stop supabase/server.ts crashing every request without env ([e00ac18](https://github.com/lbragile/TabMerger/commit/e00ac18c289b0248103ab7408a65f6ff77744292))
* **web:** stop the organizer treating stored groups as Now Open ([68b2caf](https://github.com/lbragile/TabMerger/commit/68b2caf0f69c0865ad074beb14f495bf09480006))


### Features

* **extension:** add a custom colour picker with live preview ([a3115bc](https://github.com/lbragile/TabMerger/commit/a3115bc5e0dfd231f1839136e1514adf044027ba))
* **extension:** always show Archived and Sessions, and save sessions there ([7e22777](https://github.com/lbragile/TabMerger/commit/7e2277777829c8cd36e61de536e320bd401f832b))
* **extension:** consolidate group actions and add Now Open window controls ([a4854c6](https://github.com/lbragile/TabMerger/commit/a4854c65827df00abebb0f844fde207d89dc373f))
* **extension:** finish popup drag and drop ([edad192](https://github.com/lbragile/TabMerger/commit/edad1925c731d61a97e4e01bb442e9cbe590ef76))
* **extension:** Firefox beta self-updates, and asks before sending data on Firefox ([e8073b2](https://github.com/lbragile/TabMerger/commit/e8073b2efdf7431b9259a43b806948bfc8ed8398))
* **extension:** hide AI features until they launch ([27a11fc](https://github.com/lbragile/TabMerger/commit/27a11fc5820a1a60577b385ca04be8b6f05c004d))
* **extension:** make page images in previews an opt-in setting ([ab5d216](https://github.com/lbragile/TabMerger/commit/ab5d216105df34c0996ede1271e50fde6732c503))
* **extension:** mark plan prices as US dollars in Settings ([a02e97e](https://github.com/lbragile/TabMerger/commit/a02e97e1bc11b9c0253122694b811d9e97a93c89))
* **extension:** match the incognito strip to its group colour ([da7750c](https://github.com/lbragile/TabMerger/commit/da7750c1a238dfca4921087f8d6f3045f04bde66))
* **extension:** move tabs, windows and groups with a keyboard move mode ([a464534](https://github.com/lbragile/TabMerger/commit/a464534dca173ab710863f8fd7952ba53faa3f34))
* **extension:** open the colour picker straight into the custom picker, swatches included ([e424d2e](https://github.com/lbragile/TabMerger/commit/e424d2ecd25aa1cfe23772d313f02a000e4d39f3))
* **extension:** rebuild popup drag and drop on native HTML5 drag ([b7631b8](https://github.com/lbragile/TabMerger/commit/b7631b837ce0c08ac45f58bfacb02f4448244236))
* **extension:** show the version next to the Settings title ([a854215](https://github.com/lbragile/TabMerger/commit/a854215a04337eeb92f3e5daa1685e41c36a0967))
* **shared:** add the AI feature flag helper ([682948b](https://github.com/lbragile/TabMerger/commit/682948b9caf537cbee920a274ca3230d3e2e8920))
* show URL rule limits on every plan, from one shared definition ([e5e762b](https://github.com/lbragile/TabMerger/commit/e5e762baf93019c44eb68dd5a0060f072cf5fc78))
* **web:** add a /beta page for testers ([b1863c3](https://github.com/lbragile/TabMerger/commit/b1863c3ab344dd4c9091b36f4a707f29c798eda1))
* **web:** add a countdown to toasts and make them easier to read ([60d63ea](https://github.com/lbragile/TabMerger/commit/60d63eaffbcaaf28d488d337e539e0c82db6b327))
* **web:** add a social preview image to shared links ([de04980](https://github.com/lbragile/TabMerger/commit/de04980cb16b45fc95ef2950904697b156efba98))
* **web:** add non-personal diagnostics to contact emails ([73dd151](https://github.com/lbragile/TabMerger/commit/73dd151598a7fbcb2afe8dccac9564b26b7d77fe))
* **web:** add the untagged v1.0.0-v1.1.3 releases to the changelog ([5ad20f3](https://github.com/lbragile/TabMerger/commit/5ad20f348ae3a9e0578d458874c5c92e6186bfdc))
* **web:** add v1.1.1, v1.1.2, v1.3.1, v1.4.1 and v1.4.2 to the changelog ([0780132](https://github.com/lbragile/TabMerger/commit/07801326118522a11ac5ff34896386f8dc55a66b))
* **web:** add Vercel Web Analytics and Speed Insights ([da244b8](https://github.com/lbragile/TabMerger/commit/da244b8894ae2470f5c55c0aa862b3a9657751d2))
* **web:** censor profanity in store reviews shown on the site ([ed1b292](https://github.com/lbragile/TabMerger/commit/ed1b292f3e3ba0dc642995cc7462c2b8d9d3688e))
* **web:** center the sign-in and sign-up forms and drop the button glow ([9d61395](https://github.com/lbragile/TabMerger/commit/9d6139570e8641dfc178c38d3a7e2032210ed526))
* **web:** draw toasts with the app's theme and tokens ([4d13125](https://github.com/lbragile/TabMerger/commit/4d131252cd8d71b1d2cdbeaf44ee26c1dc4edb56))
* **web:** drive the changelog page from generated CHANGELOG.md ([1f36cd3](https://github.com/lbragile/TabMerger/commit/1f36cd3a21d925c9cb9044f5c38891233fe29fd6))
* **web:** drop the dashboard's New group button and let the upgrade banner be dismissed ([65143db](https://github.com/lbragile/TabMerger/commit/65143dbd5efbe3db16982f4c825800bbf0c2eb24))
* **web:** full beta test plan with sharp screenshots of every step ([b727be3](https://github.com/lbragile/TabMerger/commit/b727be33fc0360422a3c96e646b21a50765f8c68)), closes [hi#density](https://github.com/hi/issues/density)
* **web:** give each beta test steps and an example, and take reports on GitHub ([9585d1f](https://github.com/lbragile/TabMerger/commit/9585d1fe2603aee4e5b7a3393297228794d54731))
* **web:** hide sync-only parts of the dashboard and account page for free accounts ([99d69e9](https://github.com/lbragile/TabMerger/commit/99d69e9e5bc712d3d883d25631b54877218dd2f4))
* **web:** let customers pay in their local currency at checkout ([a7c723f](https://github.com/lbragile/TabMerger/commit/a7c723f30e70b3ac7e07d03e395a6b5508dcb425))
* **web:** let visitors step and swipe through the reviews ([7e3cf96](https://github.com/lbragile/TabMerger/commit/7e3cf96266f00a5e55f83215a01e3b8985af43af))
* **web:** make page previews opt-in and disclose them in the policy ([fbe975c](https://github.com/lbragile/TabMerger/commit/fbe975c8f9f8fe2462046d562a42f50e8f4b49b3))
* **web:** reach the extension from any store, with a Firefox fallback ([46df4fd](https://github.com/lbragile/TabMerger/commit/46df4fd0e766e98cf1871e08f477a7d194a21ee3))
* **web:** refuse AI requests and AI purchases while AI is off ([22cd614](https://github.com/lbragile/TabMerger/commit/22cd614d0b432fe2baa5293c9dd9042092f90c22))
* **web:** say that prices are in US dollars ([b5bfaa9](https://github.com/lbragile/TabMerger/commit/b5bfaa939a155ed4b253e72599ac2d49a44f8f5d))
* **web:** serve the Firefox beta add-on from the beta site ([88bd8a5](https://github.com/lbragile/TabMerger/commit/88bd8a50132f632bd5a51426eb44c7c397408d75))
* **web:** show AI as coming soon on the site ([4d859ef](https://github.com/lbragile/TabMerger/commit/4d859efe526acfcf6fd4fe1cb775fbe1f4f4d567))
* **web:** show real store reviews in place of invented testimonials ([7efebb2](https://github.com/lbragile/TabMerger/commit/7efebb26555401e2c2aebec8f3dd234812dd5cbc))
* **web:** show the monthly equivalent and saving under yearly prices ([6943fb0](https://github.com/lbragile/TabMerger/commit/6943fb0ecacae01c9f71181eb90934ee06ed6cce))
* **web:** switch a paid plan between monthly and yearly billing ([11c6b67](https://github.com/lbragile/TabMerger/commit/11c6b67a972865fe72ec8280a760f533d7761a09))
* **web:** turn the beta guide into a checklist with screenshots, Pro markers and known issues ([2cf0ad3](https://github.com/lbragile/TabMerger/commit/2cf0ad3cec0650a93edc48f3505939a42cdf9908))

# [3.1.0-beta.1](https://github.com/lbragile/TabMerger/compare/v3.0.0...v3.1.0-beta.1) (2026-09-20)


### Bug Fixes

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
