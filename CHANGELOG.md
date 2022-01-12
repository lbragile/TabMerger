# Change Log

All notable changes to TabMerger will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and TabMerger adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased](https://github.com/lbragile/TabMerger/compare/v2.0.0...HEAD) (11 January 2022)

### Added

- Color Picker [`e3af217`](https://github.com/lbragile/TabMerger/commit/e3af2178d456e106e304186abec5082ad7ee43a9)
- Import Functionality [`7fc174c`](https://github.com/lbragile/TabMerger/commit/7fc174c8f031b3874b8c781d93ac37ce7e90caa7)
- HTML export logic - note about downloads folder & copy indicator [`3423a6d`](https://github.com/lbragile/TabMerger/commit/3423a6dee2753259dc4001ce83046d80f63ceb1c)
- Dynamic link to extension settings page [`7d1796b`](https://github.com/lbragile/TabMerger/commit/7d1796b508f65145a923776be3d53eb2739a4f98)
- Duplicate, merge, replace, and unite functionality to groups [`35cb0c8`](https://github.com/lbragile/TabMerger/commit/35cb0c8d70a03754c7dce77d7398dd36999ffee3)
- Window favorite and incognito [`4fa8c8b`](https://github.com/lbragile/TabMerger/commit/4fa8c8bb1e531daea444190670382b7eba8b8a85)
- Settings dropdown along with basic functionality for its items [`3fe0e87`](https://github.com/lbragile/TabMerger/commit/3fe0e87f066f5477a6649c521570086a1a467c06)
- Close window and tab functionality [`07005dc`](https://github.com/lbragile/TabMerger/commit/07005dcb13b74eb8571e62923f96071a4e4b8a44)
- Logic to remove empty source windows on dnd [`fb386c7`](https://github.com/lbragile/TabMerger/commit/fb386c76494c74ac94904f51a49cdf097d42f88f)
- Logic to determine drag over a group & ability to drop windows and tabs into group [`fa2bb1c`](https://github.com/lbragile/TabMerger/commit/fa2bb1c806916841f5510c1717f56ba268ebddbf)
- Popup to window context menu [`790d803`](https://github.com/lbragile/TabMerger/commit/790d80344c43ac250170fba542fca140a9a853f9)
- Search functionality along with highlighting [`f0953f9`](https://github.com/lbragile/TabMerger/commit/f0953f97b93f58cc2965a3bf286c392f90a66e4e)
- `Windows` with `Tabs` to the main area [`1910ec5`](https://github.com/lbragile/TabMerger/commit/1910ec5c04a9fa24579d04c9ec07c8c9640bb44b)
- `SidePanel` with containers [`f468f25`](https://github.com/lbragile/TabMerger/commit/f468f259f1a51d90ee5e4f1a9ab3f18a12f31a2b)
- Group icon since now an extra group is shown when a tab/window is dragged [`d6a79cb`](https://github.com/lbragile/TabMerger/commit/d6a79cb5659db51c52b67454794746d515850ece)
- Extra window on tab drag & Cleanup logic to remove empty groups/windows [`d6a79cb`](https://github.com/lbragile/TabMerger/commit/d6a79cb5659db51c52b67454794746d515850ece)

### Fixed

- Tab and window delete logic [`4fa8c8b`](https://github.com/lbragile/TabMerger/commit/4fa8c8bb1e531daea444190670382b7eba8b8a85)
- Color picker issues [`2dc7057`](https://github.com/lbragile/TabMerger/commit/2dc70577fb0fa9f2d119a61caf71bc2c1f05dbdf)
- Settings dropdown styling & used outside click to hide window context menu [`3df317e`](https://github.com/lbragile/TabMerger/commit/3df317e5a0cb58c72df1c407a996c89a8c01f398)
- First group not populating properly on initial open [`3df317e`](https://github.com/lbragile/TabMerger/commit/3df317e5a0cb58c72df1c407a996c89a8c01f398)
- Dnd issues [`863dabb`](https://github.com/lbragile/TabMerger/commit/863dabbd1fece82f61e4f5d538924bd04f0a0d4b)
- Drag auto scroll for groups & allow combining for tabs / windows in group drop [`82db9f0`](https://github.com/lbragile/TabMerger/commit/82db9f05f8789318e2f506f28fb4ab947a9e8f49)
- Persistance by creating `useStorage` custom hook [`7b6ace0`](https://github.com/lbragile/TabMerger/commit/7b6ace0aea906bf90596572a9efc19aa97c166c9)
- Group color updates [`7b6ace0`](https://github.com/lbragile/TabMerger/commit/7b6ace0aea906bf90596572a9efc19aa97c166c9)
- Tab create & update and window create & focus logic [`83684a3`](https://github.com/lbragile/TabMerger/commit/83684a3a4216c843f432bcad86d83f42ec95acc1)
- Group delete logic [`4b8f0b1`](https://github.com/lbragile/TabMerger/commit/4b8f0b196ae272c29603f8f05114eb05b65274cb)
- Popup overflow text [`857465c`](https://github.com/lbragile/TabMerger/commit/857465c18d963bfc2805a940cbe0bd260c2e17ce)
- Bug where dragging out of last group leaving it blank caused a crash [`f229e6d`](https://github.com/lbragile/TabMerger/commit/f229e6d7398bc9cb89bad03591b4f8a5e9231414)
- Dnd into group where extra tabs remained & active drag group did not change [`8bbbd5e`](https://github.com/lbragile/TabMerger/commit/8bbbd5eec0405e2ce1d6cd07f71fc7c7389c20ab)

### Changed

- Position of close icon in window & shape in tab [`8bbbd5e`](https://github.com/lbragile/TabMerger/commit/8bbbd5eec0405e2ce1d6cd07f71fc7c7389c20ab)
- Visibility of tabs on window drag [`fb386c7`](https://github.com/lbragile/TabMerger/commit/fb386c76494c74ac94904f51a49cdf097d42f88f)
- Improved element keyboard focus [`4fa8c8b`](https://github.com/lbragile/TabMerger/commit/4fa8c8bb1e531daea444190670382b7eba8b8a85)
- Split `updateWindows` reducer to distinguish between side panel and in same group dnd [`cf04d63`](https://github.com/lbragile/TabMerger/commit/cf04d638bad3b02a93acf382c83816255aad363a)
- Improved same group window dnd logic [`cf04d63`](https://github.com/lbragile/TabMerger/commit/cf04d638bad3b02a93acf382c83816255aad363a)
- Styling of window [`060fb8c`](https://github.com/lbragile/TabMerger/commit/060fb8c61a6911c94edc62b64ad26c3681ab5641)
- Icon for search with a button toggle. Tab count for each window within a group [`060fb8c`](https://github.com/lbragile/TabMerger/commit/060fb8c61a6911c94edc62b64ad26c3681ab5641)

<!-- auto-changelog-above -->

## [v2.0.0](https://github.com/lbragile/TabMerger/compare/v1.6.2...v2.0.0) (06 March 2021)

### Added

- Automatic backup for JSON & Sync
- Group color randomizing
- Tooltips can be hidden/shown in settings
- SaveAs menu for JSON Export to allow you to pick location (Can be turned off in settings)

### Fixed

- Firefox external (Keyboard Shortcuts / Right Click Menu) merging
- Settings page design with extra convenient functionality

### Changed

- Text style now adjusts for all text in the extension page
- Confirmation boxes with sleek notification menus
- Extra details on main page that are relevant to each user

## [v1.6.2](https://github.com/lbragile/TabMerger/compare/v1.6.1...v1.6.2) (16 February 2021)

### Added

- Tab title weight & font can be adjusted in settings
- Hovering over a tab title shows it's URL (popup beside mouse pointer)
- Search filter can now also use `@` to search for groups

### Fixed

- Right click menu & keyboard shortcut merging logic
- Better button popup placement to avoid obstruction of other buttons

### Changed

- Merge button icons to remove confusion on direction of merging and popup text

## [v1.6.1](https://github.com/lbragile/TabMerger/compare/v1.6.0...v1.6.1) (06 February 2021)

### Fixed

- Bugs in tutorial/walk-through

### Removed

- Hidden/empty (no tab) groups from the print friendly PDF

## [v1.6.0](https://github.com/lbragile/TabMerger/compare/v1.5.0...v1.6.0) (04 February 2021)

### Added

- Undo a destructive action
- Delete All & Open All action confirmation
- Badge icon information (configurable in settings)
- Walk-through/tour
- Group Drag & Drop
- Persistent hiding/showing of group
- Group locking/unlocking
- Group starring/un-starring
- Drag & Drop from URL address bar lock icon directly into the extension page
- Edit tab title (with Middle click)

### Fixed

- Pin tab(s) merging behavior

### Changed

- Much longer group titles
- Color picker has preset colors and positioned better
- Better background & text contrast (automatically adjusting)
- Tab pin/unpin directly from inside the extension page
- Merge behavior setting (keep tab open or close it)
- Better UI in setting page
- Page UI improvements
- Fail safe JSON property names to allow better imports from similarly structured JSON files generated by other applications

## [v1.5.0](https://github.com/lbragile/TabMerger/compare/v1.4.3...v1.5.0) (08 January 2021)

### Changed

- Better and cleaner User Interface
- Responsive design for smaller devices across all browsers
- User friendly PDF generation via a print button
- Scroll to bottom upon adding group
- New homepage website which loads much faster, providing better User Experience

## [v1.4.1 - v1.4.3](https://github.com/lbragile/TabMerger/compare/v1.4.0...v1.4.3) (22 December 2020)

### Fixed

- Bugs in sync & incognito operation (stable as of v1.4.3)

## [v1.4.0](https://github.com/lbragile/TabMerger/compare/v1.3.0...v1.4.0) (21 December 2020)

### Changed

- Better & more compact user interface
- Search filter combined into 1 Regular Expression based filter
- Improved merge on open functionality

### Removed

- Deprecated PDF Export

## [v1.3.0 - v1.3.1](https://github.com/lbragile/TabMerger/compare/v1.2.1...v1.3.0) (14 December 2020)

### Added

- Sync configuration across devices!
- Incognito (private) browser mode

### Fixed

- Improved merging & restoring logic to avoid duplicates
- Better drag and drop functionality scrolls the page while dragging
- Cleaner & more readable Export JSON output

### Changed

- Can restore settings back to default

## [v1.2.1](https://github.com/lbragile/TabMerger/compare/v1.2.0...v1.2.1) (06 December 2020)

## Added

- Ability to Import & Export JSON version and Export PDF of current extension page
- [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn) support
- Keyboard shortcut commands

## Changed

- Improvements in logic to reduce redundant page reloads
- Better UI for both FireFox and Chrome versions
- Further support for languages added

## [v1.2.0](https://github.com/lbragile/TabMerger/compare/bd7f947...v1.2.0) (03 December 2020)

### Added

- Filters to quickly find items within a given group

### Changed

- New tab merging functionality allows user to merge within each group directly
- Better logic for merging prevents extension page from "moving around"

## [v1.1.3](https://github.com/lbragile/TabMerger/compare/20533f0...bd7f947) (01 December 2020)

### Fixed

- Issue where extension icon click caused items to close without being merged in FireFox
- Group title change persistence

## [v1.1.0 - v1.1.2](https://github.com/lbragile/TabMerger/compare/f61488f...20533f0) (30 November 2020)

### Added

- Dark Mode
- [FireFox](https://addons.mozilla.org/en-CA/firefox/addon/tabmerger/) support

## [v1.0.1](https://github.com/lbragile/TabMerger/compare/bae006f...f61488f) (28 November 2020)

### Added

- Demo video and improved UI
- Broader language support

## [v1.0.0](https://github.com/lbragile/TabMerger/compare/5ffab12...bae006f) (28 November 2020)

- Initial release includes core merging, grouping, restoring functionality
