# ![tabmerger logo](./public/images/logo-full-rescale.PNG)

[![Build](https://img.shields.io/github/workflow/status/lbragile/TabMerger/Unit_Testing/master)](https://github.com/lbragile/TabMerger/actions) [![Coverage](https://img.shields.io/codecov/c/github/lbragile/TabMerger/master)](https://codecov.io/gh/lbragile/TabMerger/commits) [![Issues](https://img.shields.io/github/issues/lbragile/TabMerger)](https://github.com/lbragile/TabMerger/issues) [![Forks](https://img.shields.io/github/forks/lbragile/TabMerger)](https://github.com/lbragile/TabMerger) [![Stars](https://img.shields.io/github/stars/lbragile/TabMerger)](https://github.com/lbragile/TabMerger) [![contributions welcome](https://img.shields.io/badge/contrib-welcome-brightgreen.svg?style=flat)](https://github.com/lbragile/TabMerger) [![Active Development](https://img.shields.io/badge/maint-active-brightgreen.svg)](https://github.com/lbragile/TabMerger) [![License](https://img.shields.io/github/license/lbragile/TabMerger)](https://github.com/lbragile/TabMerger/blob/master/LICENSE)

### Merges your tabs into one location to save memory usage and increase your productivity.

<img src="https://media.giphy.com/media/cOb0OPXlIHtnZcQC75/giphy.gif" alt="TabMerger v1.2.0 Example Use Case Available In Chrome & FireFox" width="640" height="360"/>

## Description 🖋

Tired of searching through squished tab icons to find that one tab you are sure is there?
With TabMerger you can simplify this clutter while greatly increasing productivity in a highly organized and customizable fashion!

With a single click, you can have all your tabs in a single place, where you can then re-arrange them into appropriate groups, delete extra/unwanted tabs, customize group colors, and so much more. All tabs that are merged into TabMerger are stored internally for you to use at a later time, even when you close the browser window. Lots of analytics are provided to keep you informed about the state of your tabs.

In addition to reducing the heavy tab clutter, TabMerger significantly reduces the memory usage of your machine as on average each chrome tab can use **25MB-100MB of RAM**. These add up quickly if left open and can significantly slow down your machine, but with TabMerger you simply have a list of tabs which can be re-opened when you really need them.

## CONTRIBUTING 🤗

Please refer to the <a href="https://github.com/lbragile/TabMerger/blob/master/CONTRIBUTING.md"/>CONTRIBUTING.md</a> file for guidelines.

## Download 🔽

Visit the <a href="https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/">Chrome Web Store</a> or <a href="https://addons.mozilla.org/en-CA/firefox/addon/tabmerger/"> Firefox Browser Add-ons</a>.

## Leave A Review ⭐⭐⭐⭐⭐

Was TabMerger useful to you?
If so, consider leaving a positive & meaningful review (<a href="https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/reviews">Chrome</a> | <a href="https://addons.mozilla.org/en-CA/firefox/addon/tabmerger/">Firefox</a>)

👉 It would also mean a lot if you could 🌟 this repository on GitHub! 👈

## TODO ✅

The following lists the items which need to be crossed off of TabMerger's bucket (and some that were recently completed/highlights) list since the release of v1.2.1.

#### HIGH PRIORITY :exclamation::exclamation:

- [ ] Integrate syncing across devices with Chrome Storage API so that a user does not need to share a link with themselves to regain access to their tab list. Will store items as groups and monitor item storage and global storage limits, warning users as necessary.
- [ ] Incognito mode - should work with Syncing to remember data.
- [ ] Better merge and restore functionality. Avoid duplicates when merging, avoid creating tabs if they already are open in the window.
- [ ] Integrate testing with Cypress? ◀= I couldn't figure out how to test Chrome API since Cypress does not seem to allow redirection to `chrome://` URLs.

#### MEDIUM PRIORITY :exclamation:

- [ ] Pinned tab information =▶ settings options (by default DO NOT merge pinned tabs)
- [ ] Undo deleted tabs (store all relevant details for up to 5 tabs). Only apply to single tab removal?
- [ ] Better drag and drop - allow scrolling?
- [ ] Combine tab and group filters into one filter (use RegEx to figure out which one is requested)
- [ ] Hide tabs in groups with persistence.
- [ ] Format PDF output well for multi-page groups. Add tab icons for each tab regardless of icon extension type.

#### LOW PRIORITY :grey_exclamation:

- [ ] Translate settings page with Google Translate API
- [ ] Redirect to survey URL upon uninstall event.
- [ ] Let user add tags that can be clicked to search tab categories?

#### DONE

- [x] Make available on other browsers (Firefox).
- [x] Move global merge button within groups. This will allow a user to merge tabs directly into a group rather than always into the top group (`id: group-0`).
- [x] Implement search functionality (group search to filter groups & tab search to filter within a group for a specific tab).
- [x] Major refactoring to simplify the logic and avoid redundant reloading of the page.

📩 If you have any more suggestions please send me a message on GitHub, lbragile@gmail.com, or <a href="https://www.linkedin.com/in/liorbragilevsky/">LinkedIn</a>.
