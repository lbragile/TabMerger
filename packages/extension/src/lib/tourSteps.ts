import type { TourChapter, TourStep } from './tour';

/**
 * The tour's copy, in the order it is shown. Edit text here: nothing else needs to change.
 *
 * Rules for the copy: plain language for people who are not technical, a short title, a few
 * short sentences, say what the thing is and what to do with it. The spotlight and the action
 * ring (the tight ring on the control to press next) are invisible to a screen reader, so never
 * write "click here", "this button" or "the highlighted group": name each control the way its
 * accessible name does (its visible text or `aria-label`, quoted exactly), and say where it is.
 * An interactive step names its controls in the order the action ring visits them.
 *
 * Keyboard shortcuts: do NOT mention one unless the code proves it exists, works inside the
 * popup and is the same on Windows, macOS and Linux. The only key instructions kept are
 * "press Enter" to save a typed group name (GroupItem.tsx, the rename input's `onKeyDown`) and
 * the keyboard way to move a row, which every "drag" step must give: Space on a focused row
 * picks it up (`startMoveOnSpace` in lib/keyboardMoveEntry.ts), the arrow keys move it and
 * Space drops it (`useKeyboardMove.ts`). A drag step gives it per sub-step in `subStepKeys`,
 * shown as its own line.
 *
 * A read-only step is a look, not something to try: the app underneath is locked while it is
 * up. Its text therefore DESCRIBES ("the menu has…") and never instructs ("right-click…"), and
 * says the user can try it after the tour where that helps. Browser-level shortcuts (the manifest's suggested keys,
 * Ctrl+K) are left out: a browser may not assign them, and they differ per platform.
 *
 * Only describe controls every user can see. A read-only step whose `anchor` is not on the
 * page is skipped automatically, a step behind a feature flag carries `when`, and anything that
 * needs a paid plan says so in plain words.
 *
 * `anchor` is the value of a `data-tour` attribute on the real control ({@link TOUR_ANCHORS}).
 * A step with a `task` is interactive: see `tourTasks.ts` for what it watches and unlocks.
 */
export const TOUR_ANCHORS = {
  nowOpen: 'now-open',
  addGroup: 'add-group',
  groups: 'groups',
  /** Inside a group's row: the name (and its rename field), the color dot, the pin star. */
  groupName: 'group-name',
  /** While a group is being named: the "Group name" field and its "Save" button. */
  groupNameInput: 'group-name-input',
  groupNameSave: 'group-name-save',
  groupColor: 'group-color',
  groupPin: 'group-pin',
  /** The color picker a group's color dot opens (a popover outside the app root). */
  colorPicker: 'color-picker',
  /** Inside any color picker: the grid of round color swatches, and "Apply". */
  colorSwatches: 'color-swatches',
  colorApply: 'color-apply',
  tabsPanel: 'tabs-panel',
  groupOptions: 'group-options',
  search: 'search',
  searchOverlay: 'search-overlay',
  selectItems: 'select-items',
  undo: 'undo',
  redo: 'redo',
  aiActions: 'ai-actions',
  archived: 'archived',
  sessions: 'sessions',
  accountMenu: 'account-menu',
  accountMenuContent: 'account-menu-content',
  menuSettings: 'menu-settings',
  /** The Theme row in Settings, and the control in it that opens the list of themes. */
  settingsTheme: 'settings-theme',
  settingsThemeTrigger: 'settings-theme-trigger',
  /** The "Save changes" button in Settings. */
  settingsSaveButton: 'settings-save-button',
  help: 'help'
} as const;

/**
 * Attribute a control carries while it is the thing to press next, where no selector could
 * tell otherwise (the "Save" button of a group name, once a name of the user's own is typed).
 */
export const TOUR_READY_ATTR = 'data-tour-ready';

/**
 * The chapters, in order. Each has a header shown at the top of the card: a clear `title`, and
 * a one-sentence `description` of what the chapter covers and what the user will try in it.
 * The description is shown on the chapter's first step and announced once per chapter.
 */
export const TOUR_CHAPTERS: readonly TourChapter[] = [
  {
    id: 'basics',
    title: 'Getting to know TabMerger',
    description: 'A look around: where your open tabs appear and how the window is laid out. Nothing to try yet.'
  },
  {
    id: 'groups',
    title: 'Organize with groups',
    description: 'Groups are where saved tabs live. You will make one, name it, give it a color and pin it to the top.'
  },
  {
    id: 'drag',
    title: 'Move things by dragging',
    description: 'You will move tabs and groups around, on two practice groups the tour adds: "Tour demo" and "Tour demo 2". They hold sample tabs, not yours.'
  },
  {
    id: 'tabs',
    title: 'Save and reopen tabs',
    description: 'How to move open tabs into a group, bring them back later and tidy what you saved. You will try each on the practice groups and on a spare tab the tour opens: none of your own tabs is saved, opened or closed.'
  },
  {
    id: 'find',
    title: 'Find things and undo mistakes',
    description: 'Search every tab and group at once, and step back when you change your mind. You will try a search, "Undo" and "Redo" on the practice groups.'
  },
  {
    id: 'later',
    title: 'Keep things for later',
    description: 'Save all your groups in one go, put a group away without deleting it, and save from any web page. This chapter only explains.'
  },
  {
    id: 'settings',
    title: 'Settings and your account',
    description: 'Change how TabMerger looks, see what else Settings offers and what signing in adds. You will try switching the theme.'
  }
];

export const TOUR_STEPS: readonly TourStep[] = [
  // ── The basics ────────────────────────────────────────────────────────────────────────
  {
    id: 'welcome',
    chapter: 'basics',
    anchor: null,
    placement: 'center',
    title: 'Welcome to TabMerger',
    body: 'TabMerger tidies up your browser. Save the tabs you have open into named groups, close them, and bring them back whenever you need them. This tour has seven short chapters, each named at the top of this card. Some steps ask you to try something yourself: an orange ring then marks the control to use next, and the text names it. For those steps the tour adds two practice groups with sample tabs, "Tour demo" and "Tour demo 2", and removes them again by itself. You can skip a step, a chapter or the whole tour at any time.'
  },
  {
    id: 'now-open',
    chapter: 'basics',
    anchor: TOUR_ANCHORS.nowOpen,
    activate: 'now-open',
    placement: 'right',
    title: 'Now Open',
    body: '"Now Open", at the top of the list on the left, is a live list of every tab open in your browser right now. It is always first and cannot be deleted.'
  },
  {
    id: 'main-panel',
    chapter: 'basics',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'now-open',
    placement: 'left',
    title: 'Windows and tabs',
    body: 'The main panel shows what is inside the group you picked on the left: its windows, and the tabs in each window. For Now Open these are your real browser windows.'
  },

  // ── Groups ────────────────────────────────────────────────────────────────────────────
  {
    id: 'make-group',
    chapter: 'groups',
    anchor: TOUR_ANCHORS.addGroup,
    placement: 'right',
    task: 'make-group',
    title: 'Make a group',
    body: 'A group is a named place for saved tabs, for example "Work" or "Holiday plans". Try it: select "Add Group", below your groups. A new group appears with its "Group name" field ready, showing "temp group". Type a name of your own, such as "Practice", then press Enter or select "Save" next to the field.',
    doneText: 'Nice, your group is ready. The next steps use it.',
    fallbackBody: 'A group is a named place for saved tabs, for example "Work" or "Holiday plans". "Add Group", below your groups, makes one. You already have as many groups as your plan allows, so this step is only shown, not tried.'
  },
  {
    id: 'group-color',
    chapter: 'groups',
    anchor: TOUR_ANCHORS.groups,
    placement: 'right',
    task: 'group-color',
    title: 'Give it a color',
    body: 'Colors make groups easy to tell apart. Try it: in the group you just made, select the round "Change group color" dot in front of its name. Pick one of the round color swatches, then select "Apply".',
    doneText: 'Nice, color changed.',
    fallbackBody: 'Colors make groups easy to tell apart. Every group has a round "Change group color" dot in front of its name: select it, pick a color, then select "Apply".'
  },
  {
    id: 'group-pin',
    chapter: 'groups',
    anchor: TOUR_ANCHORS.groups,
    placement: 'right',
    task: 'group-pin',
    title: 'Pin a group to the top',
    body: 'Pinned groups stay above the others. Try it: in the group you just made, select the star at the end of its row. It is named "Pin group", or "Unpin group" when the group is already pinned.',
    doneText: 'Nice. Select the star again whenever you want to change it back.',
    fallbackBody: 'Pinned groups stay above the others. Every group has a star at the end of its row, named "Pin group": select it to pin the group, and again to unpin it.'
  },
  {
    id: 'group-menu',
    chapter: 'groups',
    anchor: TOUR_ANCHORS.groups,
    placement: 'right',
    title: 'More for each group',
    body: 'Every saved group has a right-click menu. It holds "Rename", "Add note", "Duplicate", "Merge with current" to add your open windows to the group, "Archive group" to hide it, and "Delete group". This step is just a look: the list is locked while the tour is open, so try the menu after the tour.'
  },

  // ── Dragging (on the tour's own practice groups) ──────────────────────────────────────
  {
    id: 'drag-tab-reorder',
    chapter: 'drag',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    task: 'drag-tab-reorder',
    title: 'Reorder tabs',
    body: 'The main panel shows the practice group "Tour demo". Every tab has a dotted handle in front of it, named "Drag to reorder tab". Move the first tab of the window "Reading" to the end of that window.',
    subStepText: [
      'Press and hold the handle of the first tab.',
      'Move it down to the line under the last tab, marked "Drop below this tab".',
      'Let go to drop it.'
    ],
    subStepKeys: [
      'press Tab to reach the handle, then Space to pick the tab up.',
      'press the Down arrow key until the tab is at the line marked "Drop below this tab".',
      'press Space to drop it.'
    ],
    doneText: 'Nice, the tab moved.',
    fallbackBody: 'Every saved tab has a dotted handle in front of it, named "Drag to reorder tab". Dragging it moves the tab up or down in its window. This step is just a look.'
  },
  {
    id: 'drag-tab-window',
    chapter: 'drag',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    task: 'drag-tab-window',
    title: 'Move a tab to another window',
    body: 'A tab can also go into another window of the same group. Move the first tab into the other window of "Tour demo".',
    subStepText: [
      'Press and hold the handle of the first tab.',
      'Move it onto the other window, marked "Drop in this window".',
      'Let go to drop it.'
    ],
    subStepKeys: [
      'press Tab to reach the handle, then Space to pick the tab up.',
      'press the Down arrow key until the tab is inside the window marked "Drop in this window".',
      'press Space to drop it.'
    ],
    doneText: 'Nice, the tab is in the other window.',
    fallbackBody: 'Dragging a tab by its handle onto another window of the same group moves it there. This step is just a look.'
  },
  {
    id: 'drag-tab-group',
    chapter: 'drag',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    task: 'drag-tab-group',
    title: 'Move a tab to another group',
    body: 'Dropping a tab on a group in the list on the left moves it into that group. Move the first tab into the practice group "Tour demo 2".',
    subStepText: [
      'Press and hold the handle of the first tab.',
      'Move it onto "Tour demo 2" in the list on the left, marked "Drop on this group".',
      'Let go to drop it.'
    ],
    subStepKeys: [
      'press Tab to reach the handle, then Space to pick the tab up.',
      'press the Left arrow key to go to the list of groups, then the Down arrow key until you reach "Tour demo 2", marked "Drop on this group".',
      'press Space to drop it.'
    ],
    doneText: 'Nice, the tab is in "Tour demo 2" now.',
    fallbackBody: 'Dragging a tab by its handle onto a group in the list on the left moves it into that group. This step is just a look.'
  },
  {
    id: 'drag-group-order',
    chapter: 'drag',
    anchor: TOUR_ANCHORS.groups,
    placement: 'right',
    task: 'drag-group-order',
    title: 'Put groups in order',
    body: 'Groups have a dotted handle too, at the start of their row, named "Drag to reorder group". Swap the two practice groups. Your own groups move the same way.',
    subStepText: [
      'Press and hold the handle of the upper practice group.',
      'Move it down to the line under the other practice group, marked "Drop below this group".',
      'Let go to drop it.'
    ],
    subStepKeys: [
      'press Tab to reach the handle, then Space to pick the group up.',
      'press the Down arrow key once, so the group is at the line marked "Drop below this group".',
      'press Space to drop it.'
    ],
    doneText: 'Nice, the groups changed places.',
    fallbackBody: 'Every saved group has a dotted handle at the start of its row, named "Drag to reorder group". Dragging it moves the group up or down the list. This step is just a look.'
  },

  // ── Tabs and windows ──────────────────────────────────────────────────────────────────
  {
    id: 'save-tabs',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'now-open',
    placement: 'left',
    task: 'save-tabs',
    title: 'Save tabs into a group',
    body: 'A tab dragged from Now Open onto a group is saved in that group and closed in your browser. So that none of your own tabs is closed, the tour opened a spare tab named "Tour practice tab": it is the only tab you can move in this step. Save it into the practice group "Tour demo".',
    subStepText: [
      'Press and hold the dotted handle in front of "Tour practice tab".',
      'Move it onto "Tour demo" in the list on the left, marked "Drop on this group".',
      'Let go to drop it.'
    ],
    subStepKeys: [
      'press Tab to reach the handle, then Space to pick the tab up.',
      'press the Left arrow key to go to the list of groups, then the Down arrow key until you reach "Tour demo", marked "Drop on this group".',
      'press Space to drop it.'
    ],
    doneText: 'Nice. The practice tab is saved in "Tour demo" and closed in your browser. Whole windows are saved the same way.',
    fallbackBody: 'A tab, or a whole window, dragged from Now Open onto a group on the left is saved in that group and closed in your browser. The tour could not open a spare tab to try this with, so this step is just a look: none of your tabs is touched.'
  },
  {
    id: 'open-tabs',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    task: 'open-tabs',
    title: 'Open your tabs again',
    body: 'In a saved group, selecting the name of a tab opens that tab again, and "Open in browser" in the menu of a window opens the whole window. Try that menu on the window "Reading" of "Tour demo". The sample tabs are not real pages, so nothing is opened during the tour.',
    subStepText: [
      'Select "More window options", the three dots at the end of the row "Reading".',
      'Choose "Open in browser" in the menu.'
    ],
    doneText: 'Nice. After the tour, that opens the window with its tabs in your browser. Nothing was opened now.',
    fallbackBody: 'In a saved group, selecting the name of a tab opens that tab again. "More window options" on a window has "Open in browser" for the whole window, and the right-click menu of a group has "Open all in new window". This step is just a look: nothing is opened during the tour.'
  },
  {
    id: 'tab-extras',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    title: 'Notes, reminders and names',
    body: 'A saved tab has a right-click menu with more: "Move to group", "Add note" to write something down, "Remind me…" to be reminded about it later, "Rename tab" to give it your own title, and "Remove tab". This step is just a look: the list is locked while the tour is open, so try the menu after the tour.'
  },
  {
    id: 'tidy-up',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.groupOptions,
    activate: 'tour-demo',
    placement: 'left',
    task: 'tidy-up',
    title: 'Tidy a group',
    body: '"More group options", at the top right of the main panel, can sort the tabs by title or address, remove repeats with "Deduplicate tabs", and "Unite windows" into one or "Split windows" apart. "Tour demo" holds the tab "Sample: books" twice: remove the repeat.',
    modalBody: 'The dialog "Remove duplicates" lists the repeated tab. Select "Remove 1 duplicate".',
    subStepText: [
      'Select "More group options", the three dots at the top right of the main panel.',
      'Choose "Deduplicate tabs" in the menu.',
      'In the dialog "Remove duplicates", select "Remove 1 duplicate".'
    ],
    doneText: 'Nice, the repeated tab is gone.',
    fallbackBody: '"More group options", at the top right of the main panel, can sort the tabs by title or address, remove repeats with "Deduplicate tabs", and "Unite windows" into one or "Split windows" apart. This step is just a look.'
  },
  {
    id: 'select-items',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.selectItems,
    activate: 'tour-demo',
    placement: 'bottom',
    task: 'select-items',
    title: 'Work on several at once',
    body: '"Select items", in the header, shows a checkbox on every tab, window and group. With some selected, a bar appears at the bottom that acts on all of them together, for example to delete them. Sharing selected groups as a link needs a Pro plan. Try selecting a sample tab.',
    subStepText: [
      'Select "Select items" in the header.',
      'Select the checkbox in front of the first sample tab.'
    ],
    doneText: 'Nice. The bar at the bottom acts on what you selected. The tour turns selecting off again when you move on.',
    fallbackBody: '"Select items", in the header, shows a checkbox on every tab, window and group. With some selected, a bar appears at the bottom that acts on all of them together, for example to delete them. Sharing selected groups as a link needs a Pro plan. This step is just a look.'
  },

  // ── Find and undo ─────────────────────────────────────────────────────────────────────
  {
    id: 'search',
    chapter: 'find',
    anchor: TOUR_ANCHORS.search,
    activate: 'tour-demo',
    placement: 'bottom',
    task: 'search',
    title: 'Find anything',
    body: 'The search box at the top, which reads "Search tabs and groups…", looks through every tab and group at once. Matches appear as you type. Try it on the sample tabs.',
    subStepText: ['Select the search box at the top.', 'Type the word sample.'],
    doneText: 'Nice. Every tab that matches is listed under the search box. Selecting one takes you to its group.',
    fallbackBody: 'The search box at the top, which reads "Search tabs and groups…", looks through every tab and group at once. Matches appear as you type, and selecting one takes you to its group.'
  },
  {
    id: 'search-filters',
    chapter: 'find',
    anchor: TOUR_ANCHORS.search,
    activate: 'tour-demo',
    placement: 'bottom',
    task: 'search-filters',
    title: 'Narrow a search',
    body: 'Start a search with group: or window: to look inside one group or one window, or with tag: to filter by a browser tab group label. The search box lists these under "Try these searches". Try group: on the practice group, then clear the search.',
    subStepText: [
      'Select the search box at the top.',
      'Type group:tour with no spaces. A list named "Pick a group" appears.',
      'Choose "Tour demo" in that list. The search now looks inside that group only.',
      'Select "Clear search", the × at the end of the search field. A search stays until you clear it.'
    ],
    doneText: 'Nice, the search is cleared.',
    fallbackBody: 'Start a search with group: or window: to look inside one group or one window, or with tag: to filter by a browser tab group label. The search box lists these under "Try these searches".'
  },
  {
    id: 'undo',
    chapter: 'find',
    anchor: TOUR_ANCHORS.undo,
    anchorExtra: [TOUR_ANCHORS.redo],
    activate: 'tour-demo',
    placement: 'bottom',
    task: 'undo',
    title: 'Changed your mind?',
    body: '"Undo" and "Redo", in the header, step back and forward through your last 10 changes to groups and tabs. They are grayed out until there is something to undo. Try them on a small change to the sample window "Reading".',
    subStepText: [
      'Select the star at the end of the row "Reading", named "Star window".',
      'Select "Undo" in the header. That takes the star away again.',
      'Select "Redo", next to "Undo". That brings the star back.'
    ],
    doneText: 'Nice. "Undo" and "Redo" work the same way on your own groups and tabs.',
    fallbackBody: '"Undo" and "Redo", in the header, step back and forward through your last 10 changes to groups and tabs. They are grayed out until there is something to undo.'
  },

  // ── Save for later ────────────────────────────────────────────────────────────────────
  {
    id: 'sessions',
    chapter: 'later',
    anchor: TOUR_ANCHORS.sessions,
    placement: 'right',
    title: 'Save everything at once',
    body: 'A session is a saved copy of all your groups as they are right now. In the "Sessions" section at the bottom left, "Save current session" makes one. "Restore session", next to a saved session, brings it back: it asks first, because it closes your open windows.'
  },
  {
    id: 'archived',
    chapter: 'later',
    anchor: TOUR_ANCHORS.archived,
    placement: 'right',
    title: 'Put a group away',
    body: 'Archiving hides a group without deleting it. Archived groups wait in the "Archived" section at the bottom left, where you can restore or delete them. They still count toward the number of groups in your plan.'
  },
  {
    id: 'quick-save',
    chapter: 'later',
    anchor: null,
    placement: 'center',
    title: 'Save without opening TabMerger',
    body: 'Right-click any web page and choose "Save to TabMerger". Pick what to save, for example "Save this tab" or "Save all other tabs", and then the group to put it in.'
  },

  // ── Settings and account ──────────────────────────────────────────────────────────────
  {
    id: 'theme',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.accountMenu,
    placement: 'bottom',
    task: 'theme',
    title: 'Light or dark',
    body: 'Try it: open the menu in the top right corner, named "Settings menu" (or "Account menu" once you are signed in), and choose "Settings". Open the "Theme" list, pick a different theme, then select "Save changes".',
    modalBody: 'In Settings: open the "Theme" list, pick a different theme, then select "Save changes".',
    doneText: 'Nice, theme changed. Close Settings, or select Next, to carry on.'
  },
  {
    id: 'settings-more',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.accountMenu,
    placement: 'bottom',
    title: 'More in Settings',
    body: 'Settings has more on its "General" tab: "Confirm before deleting" asks before anything is removed, and "URL rules" link web addresses to a group. On the "Data" tab, "Export" saves all your groups to a file and "Import" loads a file back. Automatic backups, on the same tab, need a Pro plan.'
  },
  {
    id: 'account',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.accountMenu,
    placement: 'bottom',
    title: 'Your account',
    body: 'TabMerger works without an account: everything is kept on this device. Signing in, from the same menu, with a Pro plan keeps your groups in step across your devices. Synced data is locked on your device before it is sent, so only you can read it.'
  },
  {
    id: 'ai',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.aiActions,
    when: 'ai',
    placement: 'bottom',
    title: 'AI actions',
    body: '"AI actions", in the header, can sort your open tabs into groups for you. It needs a Pro AI plan.'
  },
  {
    id: 'finish',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.help,
    placement: 'bottom',
    title: 'You are all set',
    body: 'Want to see this again? "Take the tour", the question mark in the top right corner, replays it any time.'
  }
];
