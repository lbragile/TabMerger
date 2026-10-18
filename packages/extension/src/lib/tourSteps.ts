import type { TourChapter, TourStep } from './tour';
import { t } from './i18n';

/**
 * The tour's steps, in the order they are shown. Their copy lives in the catalog
 * (src/locales/en/tour.json, `tour.chapters.<id>` and `tour.steps.<id>`), read through getters so it is
 * always in the active language; the rules below apply to that copy.
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
    get title() { return t('tour.chapters.basics.title'); },
    get description() { return t('tour.chapters.basics.description'); }
  },
  {
    id: 'groups',
    get title() { return t('tour.chapters.groups.title'); },
    get description() { return t('tour.chapters.groups.description'); }
  },
  {
    id: 'drag',
    get title() { return t('tour.chapters.drag.title'); },
    get description() { return t('tour.chapters.drag.description'); }
  },
  {
    id: 'tabs',
    get title() { return t('tour.chapters.tabs.title'); },
    get description() { return t('tour.chapters.tabs.description'); }
  },
  {
    id: 'find',
    get title() { return t('tour.chapters.find.title'); },
    get description() { return t('tour.chapters.find.description'); }
  },
  {
    id: 'later',
    get title() { return t('tour.chapters.later.title'); },
    get description() { return t('tour.chapters.later.description'); }
  },
  {
    id: 'settings',
    get title() { return t('tour.chapters.settings.title'); },
    get description() { return t('tour.chapters.settings.description'); }
  }
];

export const TOUR_STEPS: readonly TourStep[] = [
  // ── The basics ────────────────────────────────────────────────────────────────────────
  {
    id: 'welcome',
    chapter: 'basics',
    anchor: null,
    placement: 'center',
    get title() { return t('tour.steps.welcome.title'); },
    get body() { return t('tour.steps.welcome.body'); }
  },
  {
    id: 'now-open',
    chapter: 'basics',
    anchor: TOUR_ANCHORS.nowOpen,
    activate: 'now-open',
    placement: 'right',
    get title() { return t('tour.steps.now-open.title'); },
    get body() { return t('tour.steps.now-open.body'); }
  },
  {
    id: 'main-panel',
    chapter: 'basics',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'now-open',
    placement: 'left',
    get title() { return t('tour.steps.main-panel.title'); },
    get body() { return t('tour.steps.main-panel.body'); }
  },

  // ── Groups ────────────────────────────────────────────────────────────────────────────
  {
    id: 'make-group',
    chapter: 'groups',
    anchor: TOUR_ANCHORS.addGroup,
    placement: 'right',
    task: 'make-group',
    get title() { return t('tour.steps.make-group.title'); },
    get body() { return t('tour.steps.make-group.body'); },
    get doneText() { return t('tour.steps.make-group.doneText'); },
    get fallbackBody() { return t('tour.steps.make-group.fallbackBody'); }
  },
  {
    id: 'group-color',
    chapter: 'groups',
    anchor: TOUR_ANCHORS.groups,
    placement: 'right',
    task: 'group-color',
    get title() { return t('tour.steps.group-color.title'); },
    get body() { return t('tour.steps.group-color.body'); },
    get doneText() { return t('tour.steps.group-color.doneText'); },
    get fallbackBody() { return t('tour.steps.group-color.fallbackBody'); }
  },
  {
    id: 'group-pin',
    chapter: 'groups',
    anchor: TOUR_ANCHORS.groups,
    placement: 'right',
    task: 'group-pin',
    get title() { return t('tour.steps.group-pin.title'); },
    get body() { return t('tour.steps.group-pin.body'); },
    get doneText() { return t('tour.steps.group-pin.doneText'); },
    get fallbackBody() { return t('tour.steps.group-pin.fallbackBody'); }
  },
  {
    id: 'group-menu',
    chapter: 'groups',
    anchor: TOUR_ANCHORS.groups,
    placement: 'right',
    get title() { return t('tour.steps.group-menu.title'); },
    get body() { return t('tour.steps.group-menu.body'); }
  },

  // ── Dragging (on the tour's own practice groups) ──────────────────────────────────────
  {
    id: 'drag-tab-reorder',
    chapter: 'drag',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    task: 'drag-tab-reorder',
    get title() { return t('tour.steps.drag-tab-reorder.title'); },
    get body() { return t('tour.steps.drag-tab-reorder.body'); },
    get subStepText() { return [t('tour.steps.drag-tab-reorder.subStepText.1'), t('tour.steps.drag-tab-reorder.subStepText.2'), t('tour.steps.drag-tab-reorder.subStepText.3')]; },
    get subStepKeys() { return [t('tour.steps.drag-tab-reorder.subStepKeys.1'), t('tour.steps.drag-tab-reorder.subStepKeys.2'), t('tour.steps.drag-tab-reorder.subStepKeys.3')]; },
    get doneText() { return t('tour.steps.drag-tab-reorder.doneText'); },
    get fallbackBody() { return t('tour.steps.drag-tab-reorder.fallbackBody'); }
  },
  {
    id: 'drag-tab-window',
    chapter: 'drag',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    task: 'drag-tab-window',
    get title() { return t('tour.steps.drag-tab-window.title'); },
    get body() { return t('tour.steps.drag-tab-window.body'); },
    get subStepText() { return [t('tour.steps.drag-tab-window.subStepText.1'), t('tour.steps.drag-tab-window.subStepText.2'), t('tour.steps.drag-tab-window.subStepText.3')]; },
    get subStepKeys() { return [t('tour.steps.drag-tab-window.subStepKeys.1'), t('tour.steps.drag-tab-window.subStepKeys.2'), t('tour.steps.drag-tab-window.subStepKeys.3')]; },
    get doneText() { return t('tour.steps.drag-tab-window.doneText'); },
    get fallbackBody() { return t('tour.steps.drag-tab-window.fallbackBody'); }
  },
  {
    id: 'drag-tab-group',
    chapter: 'drag',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    task: 'drag-tab-group',
    get title() { return t('tour.steps.drag-tab-group.title'); },
    get body() { return t('tour.steps.drag-tab-group.body'); },
    get subStepText() { return [t('tour.steps.drag-tab-group.subStepText.1'), t('tour.steps.drag-tab-group.subStepText.2'), t('tour.steps.drag-tab-group.subStepText.3')]; },
    get subStepKeys() { return [t('tour.steps.drag-tab-group.subStepKeys.1'), t('tour.steps.drag-tab-group.subStepKeys.2'), t('tour.steps.drag-tab-group.subStepKeys.3')]; },
    get doneText() { return t('tour.steps.drag-tab-group.doneText'); },
    get fallbackBody() { return t('tour.steps.drag-tab-group.fallbackBody'); }
  },
  {
    id: 'drag-group-order',
    chapter: 'drag',
    anchor: TOUR_ANCHORS.groups,
    placement: 'right',
    task: 'drag-group-order',
    get title() { return t('tour.steps.drag-group-order.title'); },
    get body() { return t('tour.steps.drag-group-order.body'); },
    get subStepText() { return [t('tour.steps.drag-group-order.subStepText.1'), t('tour.steps.drag-group-order.subStepText.2'), t('tour.steps.drag-group-order.subStepText.3')]; },
    get subStepKeys() { return [t('tour.steps.drag-group-order.subStepKeys.1'), t('tour.steps.drag-group-order.subStepKeys.2'), t('tour.steps.drag-group-order.subStepKeys.3')]; },
    get doneText() { return t('tour.steps.drag-group-order.doneText'); },
    get fallbackBody() { return t('tour.steps.drag-group-order.fallbackBody'); }
  },

  // ── Tabs and windows ──────────────────────────────────────────────────────────────────
  {
    id: 'save-tabs',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'now-open',
    placement: 'left',
    task: 'save-tabs',
    get title() { return t('tour.steps.save-tabs.title'); },
    get body() { return t('tour.steps.save-tabs.body'); },
    get subStepText() { return [t('tour.steps.save-tabs.subStepText.1'), t('tour.steps.save-tabs.subStepText.2'), t('tour.steps.save-tabs.subStepText.3')]; },
    get subStepKeys() { return [t('tour.steps.save-tabs.subStepKeys.1'), t('tour.steps.save-tabs.subStepKeys.2'), t('tour.steps.save-tabs.subStepKeys.3')]; },
    get doneText() { return t('tour.steps.save-tabs.doneText'); },
    get fallbackBody() { return t('tour.steps.save-tabs.fallbackBody'); }
  },
  {
    id: 'open-tabs',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    task: 'open-tabs',
    get title() { return t('tour.steps.open-tabs.title'); },
    get body() { return t('tour.steps.open-tabs.body'); },
    get subStepText() { return [t('tour.steps.open-tabs.subStepText.1'), t('tour.steps.open-tabs.subStepText.2')]; },
    get doneText() { return t('tour.steps.open-tabs.doneText'); },
    get fallbackBody() { return t('tour.steps.open-tabs.fallbackBody'); }
  },
  {
    id: 'tab-extras',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.tabsPanel,
    activate: 'tour-demo',
    placement: 'left',
    get title() { return t('tour.steps.tab-extras.title'); },
    get body() { return t('tour.steps.tab-extras.body'); }
  },
  {
    id: 'tidy-up',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.groupOptions,
    activate: 'tour-demo',
    placement: 'left',
    task: 'tidy-up',
    get title() { return t('tour.steps.tidy-up.title'); },
    get body() { return t('tour.steps.tidy-up.body'); },
    get modalBody() { return t('tour.steps.tidy-up.modalBody'); },
    get subStepText() { return [t('tour.steps.tidy-up.subStepText.1'), t('tour.steps.tidy-up.subStepText.2'), t('tour.steps.tidy-up.subStepText.3')]; },
    get doneText() { return t('tour.steps.tidy-up.doneText'); },
    get fallbackBody() { return t('tour.steps.tidy-up.fallbackBody'); }
  },
  {
    id: 'select-items',
    chapter: 'tabs',
    anchor: TOUR_ANCHORS.selectItems,
    activate: 'tour-demo',
    placement: 'bottom',
    task: 'select-items',
    get title() { return t('tour.steps.select-items.title'); },
    get body() { return t('tour.steps.select-items.body'); },
    get subStepText() { return [t('tour.steps.select-items.subStepText.1'), t('tour.steps.select-items.subStepText.2')]; },
    get doneText() { return t('tour.steps.select-items.doneText'); },
    get fallbackBody() { return t('tour.steps.select-items.fallbackBody'); }
  },

  // ── Find and undo ─────────────────────────────────────────────────────────────────────
  {
    id: 'search',
    chapter: 'find',
    anchor: TOUR_ANCHORS.search,
    activate: 'tour-demo',
    placement: 'bottom',
    task: 'search',
    get title() { return t('tour.steps.search.title'); },
    get body() { return t('tour.steps.search.body'); },
    get subStepText() { return [t('tour.steps.search.subStepText.1'), t('tour.steps.search.subStepText.2')]; },
    get doneText() { return t('tour.steps.search.doneText'); },
    get fallbackBody() { return t('tour.steps.search.fallbackBody'); }
  },
  {
    id: 'search-filters',
    chapter: 'find',
    anchor: TOUR_ANCHORS.search,
    activate: 'tour-demo',
    placement: 'bottom',
    task: 'search-filters',
    get title() { return t('tour.steps.search-filters.title'); },
    get body() { return t('tour.steps.search-filters.body'); },
    get subStepText() { return [t('tour.steps.search-filters.subStepText.1'), t('tour.steps.search-filters.subStepText.2'), t('tour.steps.search-filters.subStepText.3'), t('tour.steps.search-filters.subStepText.4')]; },
    get doneText() { return t('tour.steps.search-filters.doneText'); },
    get fallbackBody() { return t('tour.steps.search-filters.fallbackBody'); }
  },
  {
    id: 'undo',
    chapter: 'find',
    anchor: TOUR_ANCHORS.undo,
    anchorExtra: [TOUR_ANCHORS.redo],
    activate: 'tour-demo',
    placement: 'bottom',
    task: 'undo',
    get title() { return t('tour.steps.undo.title'); },
    get body() { return t('tour.steps.undo.body'); },
    get subStepText() { return [t('tour.steps.undo.subStepText.1'), t('tour.steps.undo.subStepText.2'), t('tour.steps.undo.subStepText.3')]; },
    get doneText() { return t('tour.steps.undo.doneText'); },
    get fallbackBody() { return t('tour.steps.undo.fallbackBody'); }
  },

  // ── Save for later ────────────────────────────────────────────────────────────────────
  {
    id: 'sessions',
    chapter: 'later',
    anchor: TOUR_ANCHORS.sessions,
    placement: 'right',
    get title() { return t('tour.steps.sessions.title'); },
    get body() { return t('tour.steps.sessions.body'); }
  },
  {
    id: 'archived',
    chapter: 'later',
    anchor: TOUR_ANCHORS.archived,
    placement: 'right',
    get title() { return t('tour.steps.archived.title'); },
    get body() { return t('tour.steps.archived.body'); }
  },
  {
    id: 'quick-save',
    chapter: 'later',
    anchor: null,
    placement: 'center',
    get title() { return t('tour.steps.quick-save.title'); },
    get body() { return t('tour.steps.quick-save.body'); }
  },

  // ── Settings and account ──────────────────────────────────────────────────────────────
  {
    id: 'theme',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.accountMenu,
    placement: 'bottom',
    task: 'theme',
    get title() { return t('tour.steps.theme.title'); },
    get body() { return t('tour.steps.theme.body'); },
    get modalBody() { return t('tour.steps.theme.modalBody'); },
    get doneText() { return t('tour.steps.theme.doneText'); }
  },
  {
    id: 'settings-more',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.accountMenu,
    placement: 'bottom',
    get title() { return t('tour.steps.settings-more.title'); },
    get body() { return t('tour.steps.settings-more.body'); }
  },
  {
    id: 'account',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.accountMenu,
    placement: 'bottom',
    get title() { return t('tour.steps.account.title'); },
    get body() { return t('tour.steps.account.body'); }
  },
  {
    id: 'ai',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.aiActions,
    when: 'ai',
    placement: 'bottom',
    get title() { return t('tour.steps.ai.title'); },
    get body() { return t('tour.steps.ai.body'); }
  },
  {
    id: 'finish',
    chapter: 'settings',
    anchor: TOUR_ANCHORS.help,
    placement: 'bottom',
    get title() { return t('tour.steps.finish.title'); },
    get body() { return t('tour.steps.finish.body'); }
  }
];
