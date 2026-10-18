import { isTourDemoGroup } from '@tabmerger/shared';
import { dndGripSelector } from './dndGrip';
import { lazyMessages } from './i18n';
import { DEFAULT_GROUP_TITLE, type Group } from './types';
import { findDuplicateTabs } from './deduplication';
import { TOUR_DEMO_FIRST_WINDOW_NAME, TOUR_DEMO_MAIN_ID, TOUR_DEMO_TARGET_ID } from './tourDemo';
import { TOUR_APP_DIALOG } from './tourDom';
import { TOUR_SIGNALS } from './tourSandbox';
import { tourAnchorSelector, type TourStep, type TourTaskId } from './tour';
import { TOUR_ANCHORS, TOUR_READY_ATTR } from './tourSteps';
import { parseSearchQuery } from './utils';

/**
 * The tour's interactive steps ("tasks"): what each one waits for, what it highlights and what
 * it lets the user operate. Pure functions over a snapshot of real app state, so a task is
 * complete when the STATE says so (a group exists, its color differs, the saved theme
 * changed), however the user got there: mouse, keyboard, or a menu the tour never mentions.
 *
 * Safety rules these tasks follow:
 *  - They only ever ask the user to act on the PRACTICE group: the group the user makes in the
 *    "make a group" step, tracked by id. A task whose practice group is missing is not offered
 *    (the step falls back to its read-only text), so the tour never asks for a change to a
 *    group the user already had.
 *  - No task can close a browser tab, delete anything or reach a paid action: the allow-list of
 *    each task names single controls, and everything else stays locked.
 *  - At the Free plan's group limit "make a group" is not offered at all, so the tour never
 *    runs into the upgrade prompt.
 *  - The DRAG tasks only ever involve the tour's own practice groups ("Tour demo", see
 *    `tourDemo.ts`). Only their drag handles are unlocked (`dragOnly`: a press, a drag and the
 *    Space key, nothing else), a drag can therefore never start from "Now Open" or from a group
 *    of the user's, and the drag engine refuses every target that is not practice data
 *    (`canDrop` in `dndMove.ts`), so a drop anywhere else changes nothing.
 *  - The steps on saving, reopening, tidying, selecting, searching and undoing also work on the
 *    practice groups only. "Open in browser" opens nothing while they are up
 *    (`isTourOpenBlocked`), "Undo" and "Redo" run on a history of the practice data alone
 *    (`uiStore.tourHistory`), and search shows the practice groups only during the two search
 *    steps (`isHiddenFromSearch`).
 */

export interface TourTaskContext {
  /** `groupsState.available`: Now Open first, then every saved group (archived ones included). */
  groups: readonly Group[];
  /** Id of the group made during the tour, or `null`. It may name a group that no longer exists. */
  practiceGroupId: string | null;
  /** Most saved groups the plan allows (`Infinity` on paid plans). */
  maxGroups: number;
  /** Index (in `groups`) of the group whose name is being edited, or `null`. */
  renamingGroupIndex: number | null;
  searchFilter: string;
  /** The SAVED theme setting, or `null` while settings are still loading. */
  theme: string | null;
  /** `uiStore.modal.type`: the modal that is open, or `null`. */
  modalType: string | null;
  /**
   * The color being tried in the practice group's color picker and not applied yet
   * (`uiStore.previewGroupColor`, for that group only), or `null`.
   */
  previewColor: string | null;
  /**
   * The spare browser tab of the "save a tab" step (`hooks/useTourPracticeTab.ts`): its browser
   * tab id, the address of the practice page, and where opening it stands.
   */
  practiceTab: { id: number | null; url: string; state: 'off' | 'pending' | 'ready' | 'failed' };
  /** `uiStore.tourSignals`: counts of things that leave no trace in the data (an undo, a refused "open"). */
  signals: Readonly<Record<string, number>>;
  /** `uiStore.selectionMode` and the ids of `uiStore.selectedItems` (`tab-{g}-{w}-{t}` …). */
  selectionMode: boolean;
  selectedIds: readonly string[];
}

export interface TourTargets {
  /**
   * What to draw the ring around: lists of CSS selectors, most specific first. The first list
   * with at least one element on the page wins, and the ring goes around all of its elements
   * together (a dialog and the list box it opened, a row and its color picker).
   */
  highlight: string[][];
  /**
   * The ONE control to act on next, for the tight "action ring": lists of CSS selectors, the
   * furthest point of the task first. The first list with something visible wins, exactly like
   * `highlight`, so the ring moves on by itself as the user gets further ("Add Group", then
   * the name field, then "Save"). Each list is built from real state, or names something that
   * is only on the page at that point (an open menu, a button that is no longer disabled).
   * Empty for a read-only step. Not drawn once the task is done.
   */
  action: string[][];
  /**
   * For a task with several controls in a row: which sub-step (1-based) each list in `action`
   * stands for, in the same order. The card shows "2 of 3" from the list that won.
   */
  actionSteps?: number[];
  /**
   * A drag step's destination, for the drop marker: lists of CSS selectors, read exactly like
   * `action`. Up from the moment the step opens until the item is dropped.
   */
  drop?: string[][];
  /**
   * How the destination is marked. `onto` (default): the item goes INTO the element, which gets
   * a dashed box. `below`: the item goes into the gap right UNDER the element (the end of a
   * list, the place after a row), which gets a line along its bottom edge instead, so the
   * marker never reads as "drop on this row".
   */
  dropKind?: 'onto' | 'below';
  /** The words on the drop marker. The step's sub-step text quotes them exactly. */
  dropLabel?: string;
  /**
   * True when the destination is inside the group shown in the main panel: hovering another
   * group in the list must not switch the panel while the item is being dragged.
   */
  keepPanel?: boolean;
  /**
   * True for a drag step. The unlocked controls are drag handles, and only what a drag needs
   * reaches them: a press, the drag itself and the Space key (which picks the item up for a
   * keyboard move). No click, no right-click menu, no other key.
   */
  dragOnly?: boolean;
  /**
   * True when the card should be the wide, low one docked along the bottom of the main panel
   * (as on a drag step), because what the step is about fills the middle of the popup: the
   * search box and its list of matches.
   */
  lowCard?: boolean;
  /**
   * More that the card must not cover, besides the action ring's control: lists of CSS
   * selectors read like `action` (the label of the setting the user is changing).
   */
  keepClear?: string[][];
  /** Selectors of the only controls the user may operate. Everything else in a locked root is inert. */
  allow: string[];
  /**
   * Selectors of surfaces outside the app root (a menu, a dialog) that are locked the same way:
   * inside them only `allow` is usable. Surfaces not listed here are usable as a whole.
   */
  lockRoots: string[];
}

export interface TourTask {
  /** False = the step is shown read-only with its `fallbackBody`. */
  available(ctx: TourTaskContext): boolean;
  /** Snapshot taken when the step is entered; `null` = not ready to take one yet. */
  baseline(ctx: TourTaskContext): unknown;
  isDone(ctx: TourTaskContext, baseline: unknown): boolean;
  targets(ctx: TourTaskContext): TourTargets;
  /**
   * True when what is left of the practice data cannot serve the step (its duplicate tab is
   * already gone, say): a fresh set is then put in place when the step opens. Unlike
   * `available` it is only asked on entering the step, so finishing the task (which may make it
   * true) does not turn the step read-only.
   */
  needsFresh?(ctx: TourTaskContext): boolean;
  /**
   * For a task whose end state looks like its start state (a search that is typed and then
   * cleared again): the name of a signal (`TOUR_SIGNALS`) while the task's halfway point holds,
   * else `null`. `Tour.tsx` counts the signal each time the halfway point is reached, and
   * `isDone` compares the count with its baseline.
   */
  milestone?(ctx: TourTaskContext): string | null;
  /** A modal (`uiStore.modal.type`) the tour stays on screen for, because the task opens it. */
  modal?: 'settings' | 'deduplicateGroup';
  /**
   * False = "done" is read from the state every time and never remembered. For a task whose
   * result can be taken back while the step is still up (a new group that is canceled).
   */
  remember?: boolean;
  /** How many controls the task visits in a row (its sub-steps). Omit for a single control. */
  subSteps?: number;
}

const anchor = tourAnchorSelector;

/** Any dialog of the app (an `alertdialog` included), never the tour's own card. */
export const TOUR_FOREIGN_DIALOG = TOUR_APP_DIALOG;
/** The list a select opens (the Theme choices). */
const LISTBOX = '[role="listbox"]';

/** Escapes a value for use inside a double-quoted CSS attribute selector. */
const quoted = (value: string) => value.replace(/["\\]/g, '\\$&');

/** The sidebar row of the saved group with this id. */
export function tourGroupRowSelector(groupId: string): string {
  return `[data-sidebar-group-index][data-tm-dnd-id="${quoted(groupId)}"]`;
}

/** The practice group, when it still exists as a normal (not archived) group. */
export function findPracticeGroup(ctx: Pick<TourTaskContext, 'groups' | 'practiceGroupId'>): Group | null {
  if (!ctx.practiceGroupId) return null;
  return ctx.groups.find((g) => g.id === ctx.practiceGroupId && !g.permanent && !g.archived) ?? null;
}

/** Ids of the saved groups, for the "make a group" baseline. */
export function savedGroupIds(groups: readonly Group[]): string[] {
  return groups.filter((g) => !g.permanent).map((g) => g.id);
}

/** The saved group that was not there when the step was entered, or `null`. */
export function findNewGroup(groups: readonly Group[], baselineIds: readonly string[]): Group | null {
  return groups.find((g) => !g.permanent && !g.archived && !baselineIds.includes(g.id)) ?? null;
}

const practiceRow = (ctx: TourTaskContext): string | null => {
  const group = findPracticeGroup(ctx);
  return group ? tourGroupRowSelector(group.id) : null;
};

const isRenaming = (ctx: TourTaskContext, group: Group): boolean =>
  ctx.renamingGroupIndex !== null && ctx.groups[ctx.renamingGroupIndex]?.id === group.id;

/** The task with this id, or `undefined` for an id no task was written for (the step is then read-only). */
export function tourTask(id: TourTaskId): TourTask | undefined {
  return (TOUR_DRAG_TASKS as Partial<Record<TourTaskId, TourTask>>)[id] ?? (TOUR_TASKS as Partial<Record<TourTaskId, TourTask>>)[id];
}

export const TOUR_TASKS: Record<Exclude<TourTaskId, keyof typeof TOUR_DRAG_TASKS>, TourTask> = {
  /**
   * "Add Group", then type a name. Done once the practice group exists, has a name of its own
   * (not the placeholder a new group starts with) and that name is no longer being edited.
   * Cancelling the new group's name deletes it again (the app's own rule for a group that was
   * never named), which simply puts the step back to "not done": hence `remember: false`.
   */
  'make-group': {
    remember: false,
    subSteps: 3,
    available: (ctx) => findPracticeGroup(ctx) !== null || savedGroupIds(ctx.groups).length < ctx.maxGroups,
    baseline: (ctx) => savedGroupIds(ctx.groups),
    isDone: (ctx) => {
      const group = findPracticeGroup(ctx);
      return group !== null && group.name !== DEFAULT_GROUP_TITLE && !isRenaming(ctx, group);
    },
    targets: (ctx) => {
      const row = practiceRow(ctx);
      const addGroup = anchor(TOUR_ANCHORS.addGroup);
      if (!row) return { highlight: [[addGroup]], action: [[addGroup]], actionSteps: [1], allow: [addGroup], lockRoots: [] };
      return {
        highlight: [[row]],
        // "Save" once a name of the user's own is in the field (GroupItem marks it), the field until then
        action: [
          [`${row} ${anchor(TOUR_ANCHORS.groupNameSave)}[${TOUR_READY_ATTR}]`],
          [`${row} ${anchor(TOUR_ANCHORS.groupNameInput)}`]
        ],
        actionSteps: [3, 2],
        allow: [`${row} ${anchor(TOUR_ANCHORS.groupName)}`],
        lockRoots: []
      };
    }
  },

  /** The practice group's color dot, then Apply. Done when the stored color differs. */
  'group-color': {
    subSteps: 3,
    available: (ctx) => findPracticeGroup(ctx) !== null,
    baseline: (ctx) => findPracticeGroup(ctx)?.color ?? null,
    isDone: (ctx, baseline) => {
      const group = findPracticeGroup(ctx);
      return group !== null && baseline !== null && group.color !== baseline;
    },
    targets: (ctx) => {
      const row = practiceRow(ctx) ?? anchor(TOUR_ANCHORS.groups);
      const picker = anchor(TOUR_ANCHORS.colorPicker);
      const group = findPracticeGroup(ctx);
      // A color that differs from the stored one is being tried: "Apply" is what is left
      const picked = group !== null && ctx.previewColor !== null && ctx.previewColor !== group.color;
      return {
        highlight: [[row, picker]],
        action: [
          ...(picked ? [[`${picker} ${anchor(TOUR_ANCHORS.colorApply)}`]] : []),
          [`${picker} ${anchor(TOUR_ANCHORS.colorSwatches)}`],
          [`${row} ${anchor(TOUR_ANCHORS.groupColor)}`]
        ],
        actionSteps: picked ? [3, 2, 1] : [2, 1],
        allow: [`${row} ${anchor(TOUR_ANCHORS.groupColor)}`, picker],
        lockRoots: []
      };
    }
  },

  /** The practice group's star. Done when its pinned state differs, either way. */
  'group-pin': {
    available: (ctx) => findPracticeGroup(ctx) !== null,
    baseline: (ctx) => {
      const group = findPracticeGroup(ctx);
      return group ? !!group.starred : null;
    },
    isDone: (ctx, baseline) => {
      const group = findPracticeGroup(ctx);
      return group !== null && baseline !== null && !!group.starred !== baseline;
    },
    targets: (ctx) => {
      const row = practiceRow(ctx) ?? anchor(TOUR_ANCHORS.groups);
      const star = `${row} ${anchor(TOUR_ANCHORS.groupPin)}`;
      return { highlight: [[row]], action: [[star]], allow: [star], lockRoots: [] };
    }
  },

  /**
   * "Open in browser" on the first window of "Tour demo". Done when the request was made
   * (`TOUR_SIGNALS.openWindow`): nothing is really opened while the tour's practice chapters are
   * up (`isTourOpenBlocked`), because the sample tabs are not real pages. Only the window's
   * "More window options" button and that one menu item are unlocked.
   */
  'open-tabs': {
    subSteps: 2,
    available: (ctx) => !!demoMain(ctx)?.windows[0]?.tabs.length,
    needsFresh: (ctx) => demoMain(ctx)?.windows[0]?.name !== TOUR_DEMO_FIRST_WINDOW_NAME,
    baseline: (ctx) => ctx.signals[TOUR_SIGNALS.openWindow] ?? 0,
    isDone: (ctx, baseline) => typeof baseline === 'number' && (ctx.signals[TOUR_SIGNALS.openWindow] ?? 0) > baseline,
    targets: () => {
      const win = tourDemoWindowSelector(TOUR_DEMO_MAIN_ID, 0);
      const trigger = `${win} ${windowControls.menu}`;
      const item = anchor(TOUR_ANCHORS.windowOpen);
      return {
        highlight: [[anchor(TOUR_ANCHORS.tabsPanel), ANY_MENU]],
        action: [[item], [trigger]],
        actionSteps: [2, 1],
        keepClear: [[ANY_MENU], [win]],
        allow: [trigger, item],
        lockRoots: [ANY_MENU]
      };
    }
  },

  /**
   * "More group options" → "Deduplicate tabs" → confirm, on "Tour demo" (which holds the same
   * sample page twice). Done when the group has no repeated address left. In the menu only that
   * item works, and in the dialog only its confirm button and its close button.
   */
  'tidy-up': {
    modal: 'deduplicateGroup',
    subSteps: 3,
    available: (ctx) => !!demoMain(ctx),
    needsFresh: (ctx) => {
      const main = demoMain(ctx);
      return !!main && findDuplicateTabs(main.windows).length === 0;
    },
    baseline: (ctx) => {
      const main = demoMain(ctx);
      return main ? findDuplicateTabs(main.windows).length : null;
    },
    isDone: (ctx, baseline) => {
      const main = demoMain(ctx);
      return !!main && typeof baseline === 'number' && baseline > 0 && findDuplicateTabs(main.windows).length === 0;
    },
    targets: (ctx) => {
      const trigger = anchor(TOUR_ANCHORS.groupOptions);
      const item = anchor(TOUR_ANCHORS.groupDeduplicate);
      const confirm = `${TOUR_FOREIGN_DIALOG} ${anchor(TOUR_ANCHORS.dedupConfirm)}`;
      const open = ctx.modalType === 'deduplicateGroup';
      return {
        highlight: [[TOUR_FOREIGN_DIALOG], [anchor(TOUR_ANCHORS.tabsPanel), ANY_MENU]],
        action: open ? [[confirm]] : [[item], [trigger]],
        actionSteps: open ? [3] : [2, 1],
        keepClear: [[ANY_MENU]],
        allow: [...(open ? [] : [trigger]), item, confirm, `${TOUR_FOREIGN_DIALOG} > button`],
        lockRoots: [ANY_MENU, TOUR_FOREIGN_DIALOG]
      };
    }
  },

  /**
   * "Select items" in the header, then the checkbox of a sample tab. Done while selecting is on
   * and a tab of "Tour demo" is selected. Only the header button and the checkboxes of the
   * sample tabs are unlocked: the bar that acts on the selection stays locked, and the tour
   * turns selecting off again when the step is left (`Tour.tsx`).
   */
  'select-items': {
    subSteps: 2,
    available: (ctx) => !!demoMain(ctx)?.windows[0]?.tabs.length,
    baseline: () => true,
    isDone: (ctx) => {
      const index = ctx.groups.findIndex((g) => g.id === TOUR_DEMO_MAIN_ID);
      return index > 0 && ctx.selectionMode && ctx.selectedIds.some((id) => id.startsWith(`tab-${index}-`));
    },
    targets: (ctx) => {
      const toggle = anchor(TOUR_ANCHORS.selectItems);
      const boxes = `[data-tab-index][data-tm-dnd-id^="${TOUR_DEMO_MAIN_ID}::w"] [role="checkbox"]`;
      const first = `${tourDemoTabRowSelector(TOUR_DEMO_MAIN_ID, 0, 0)} [role="checkbox"]`;
      return {
        highlight: [[anchor(TOUR_ANCHORS.tabsPanel), toggle]],
        action: ctx.selectionMode ? [[first], [toggle]] : [[toggle]],
        actionSteps: ctx.selectionMode ? [2, 1] : [1],
        allow: [toggle, boxes],
        lockRoots: []
      };
    }
  },

  /**
   * Open the search box and type a word that is in the sample tabs. Done when the plain words
   * of the query (three letters or more) are in the title of a sample tab. The practice groups
   * are searchable only while this step and the next are up (`isHiddenFromSearch`).
   */
  search: {
    subSteps: 2,
    available: (ctx) => !!demoMain(ctx),
    baseline: () => true,
    isDone: (ctx) => {
      const words = parseSearchQuery(ctx.searchFilter).tabQuery.trim().toLowerCase();
      if (words.length < 3) return false;
      return demoGroups(ctx).some((g) => g.windows.some((w) => w.tabs.some((t) => (t?.title ?? '').toLowerCase().includes(words))));
    },
    targets: () => ({
      highlight: [[anchor(TOUR_ANCHORS.searchOverlay)], [anchor(TOUR_ANCHORS.search)]],
      // The field inside the search box once it is open, the "Open search" box until then
      action: [[`${anchor(TOUR_ANCHORS.searchOverlay)} input`], [anchor(TOUR_ANCHORS.search)]],
      actionSteps: [2, 1],
      lowCard: true,
      allow: [anchor(TOUR_ANCHORS.search), anchor(TOUR_ANCHORS.searchOverlay)],
      lockRoots: []
    })
  },

  /**
   * Narrow a search to one group, then clear it: type `group:tour`, pick "Tour demo" from the
   * list of groups the search box offers, then use "Clear search". The halfway point is a query
   * whose `group:` filter is the name of a practice group; done once that was reached and the
   * search box is empty again. Clearing is part of the task because a search stays until it is
   * cleared: the user leaves the step knowing the control that ends one.
   */
  'search-filters': {
    subSteps: 4,
    available: (ctx) => !!demoMain(ctx),
    milestone: (ctx) => (filtersOnDemoGroup(ctx) ? TOUR_SIGNALS.searchNarrowed : null),
    baseline: (ctx) => ctx.signals[TOUR_SIGNALS.searchNarrowed] ?? 0,
    isDone: (ctx, baseline) =>
      typeof baseline === 'number' && (ctx.signals[TOUR_SIGNALS.searchNarrowed] ?? 0) > baseline && ctx.searchFilter.trim() === '',
    targets: (ctx) => {
      const overlay = anchor(TOUR_ANCHORS.searchOverlay);
      const input = `${overlay} input`;
      const clear = anchor(TOUR_ANCHORS.searchClear);
      // "Clear search" inside the open search box, or next to the closed one in the header
      const clears = [`${overlay} ${clear}`, `header ${clear}`];
      // The list of groups the search box offers: its rows are the only buttons in there without
      // an accessible name, and it is up while the query ends in an unfinished `group:word`. The
      // whole list is ringed, not one row: the rows carry no name a selector could use (their
      // text is split up to mark the letters typed).
      const pick = `${overlay} button:not([aria-label])`;
      const picking = /(^|\s)group:(?!")[^"\s]*$/i.test(ctx.searchFilter);
      const narrowed = filtersOnDemoGroup(ctx);
      return {
        highlight: [[overlay], [anchor(TOUR_ANCHORS.search), `header ${clear}`]],
        action: narrowed ? [[clears[0]], [clears[1]]] : [...(picking ? [[pick]] : []), [input], [anchor(TOUR_ANCHORS.search)]],
        actionSteps: narrowed ? [4, 4] : picking ? [3, 2, 1] : [2, 1],
        lowCard: true,
        allow: [anchor(TOUR_ANCHORS.search), overlay, clears[1]],
        lockRoots: []
      };
    }
  },

  /**
   * Make a small change to the sample data (the star of the first window of "Tour demo"), then
   * "Undo", then "Redo". Done when both were used since the step opened. While the practice
   * chapters are up the two buttons run on a history of the practice data alone
   * (`uiStore.tourHistory`), emptied when this step opens, so each button is enabled exactly
   * when it is the next thing to use and nothing here touches the user's own history.
   */
  undo: {
    subSteps: 3,
    available: (ctx) => !!demoMain(ctx)?.windows.length,
    needsFresh: (ctx) => {
      const first = demoMain(ctx)?.windows[0];
      return !first || !!first.starred || first.name !== TOUR_DEMO_FIRST_WINDOW_NAME;
    },
    baseline: (ctx) => ({ undo: ctx.signals[TOUR_SIGNALS.undo] ?? 0, redo: ctx.signals[TOUR_SIGNALS.redo] ?? 0 }),
    isDone: (ctx, baseline) => {
      const start = baseline as { undo?: number; redo?: number } | null;
      if (!start || typeof start.undo !== 'number' || typeof start.redo !== 'number') return false;
      return (ctx.signals[TOUR_SIGNALS.undo] ?? 0) > start.undo && (ctx.signals[TOUR_SIGNALS.redo] ?? 0) > start.redo;
    },
    targets: () => {
      const star = `${tourDemoWindowSelector(TOUR_DEMO_MAIN_ID, 0)} ${windowControls.star}`;
      const undo = anchor(TOUR_ANCHORS.undo);
      const redo = anchor(TOUR_ANCHORS.redo);
      return {
        highlight: [[anchor(TOUR_ANCHORS.tabsPanel), undo, redo]],
        // "Redo" once there is something to redo, "Undo" once there is something to undo, the star until then
        action: [[`${redo}:not([disabled])`], [`${undo}:not([disabled])`], [star]],
        actionSteps: [3, 2, 1],
        allow: [star, undo, redo],
        lockRoots: []
      };
    }
  },

  /**
   * Account menu → Settings → Theme → Save changes. Done when the SAVED theme differs. The
   * menu and the Settings dialog are locked down to exactly that path: in the menu only
   * "Settings" works (not "Sign out", not "Upgrade", which would open a web page and close the
   * popup), and in Settings only the Theme row, "Save changes" and the close button (not
   * "Restore defaults", "Clear all data", import, or anything on another tab).
   */
  theme: {
    modal: 'settings',
    // The menu, "Settings", the Theme control, the list of themes, "Save changes"
    subSteps: 5,
    available: () => true,
    baseline: (ctx) => ctx.theme,
    isDone: (ctx, baseline) => ctx.theme !== null && baseline !== null && ctx.theme !== baseline,
    targets: (ctx) => ({
      highlight: [
        [TOUR_FOREIGN_DIALOG, LISTBOX],
        [anchor(TOUR_ANCHORS.accountMenuContent), anchor(TOUR_ANCHORS.accountMenu)],
        [anchor(TOUR_ANCHORS.accountMenu)]
      ],
      action:
        ctx.modalType === 'settings'
          ? [
              // The open list of themes; then "Save changes" once it is no longer disabled (Theme
              // is the only setting unlocked, so an enabled button means a different theme is
              // waiting to be saved); else the Theme control itself
              [LISTBOX],
              [`${anchor(TOUR_ANCHORS.settingsSaveButton)}:not([disabled])`],
              [anchor(TOUR_ANCHORS.settingsThemeTrigger)]
            ]
          : [[anchor(TOUR_ANCHORS.menuSettings)], [anchor(TOUR_ANCHORS.accountMenu)]],
      actionSteps: ctx.modalType === 'settings' ? [4, 5, 3] : [2, 1],
      // The whole Theme row, so its label stays readable next to the card
      keepClear: [[anchor(TOUR_ANCHORS.settingsTheme)]],
      allow: [
        // Not while Settings is open: the menu button is behind the dialog then
        ...(ctx.modalType === 'settings' ? [] : [anchor(TOUR_ANCHORS.accountMenu)]),
        anchor(TOUR_ANCHORS.menuSettings),
        anchor(TOUR_ANCHORS.settingsTheme),
        anchor(TOUR_ANCHORS.settingsSaveButton),
        `${TOUR_FOREIGN_DIALOG} > button`
      ],
      lockRoots: [anchor(TOUR_ANCHORS.accountMenuContent), TOUR_FOREIGN_DIALOG]
    })
  }
};

// ── Drag steps: the practice groups ──────────────────────────────────────────────────────

/** The element that holds focus during a keyboard move (`KeyboardMoveHost`): it must stay usable. */
export const TOUR_MOVE_HOST = '[data-testid="keyboard-move-host"]';
const TAB_GRIP = dndGripSelector('tab');
const GROUP_GRIP = dndGripSelector('group');
/** Any menu a press could still open is locked as a whole. */
const ANY_MENU = '[role="menu"]';
/** On a window card: the button that opens its menu, and its star. By anchor, never by name: names are translated. */
const windowControls = {
  menu: anchor(TOUR_ANCHORS.windowMenu),
  star: anchor(TOUR_ANCHORS.windowStar)
};

/**
 * The visible text of the menu items the steps name. The step text in `tourSteps.ts` quotes the
 * same words, and a unit test checks the two against each other. The tour finds the items by
 * their `data-tour` anchors, never by this text.
 */
export const TOUR_MENU_LABELS = lazyMessages({
  openWindow: 'window.openInBrowser',
  deduplicate: 'groupMenu.deduplicate'
});

/** True while the search query's `group:` filter is the name of a practice group. */
const filtersOnDemoGroup = (ctx: TourTaskContext): boolean => {
  const filter = parseSearchQuery(ctx.searchFilter).groupFilter.trim().toLowerCase();
  return filter !== '' && demoGroups(ctx).some((g) => g.name.toLowerCase() === filter);
};

/** Every practice group on the list. */
const demoGroups = (ctx: TourTaskContext): Group[] => ctx.groups.filter((g) => isTourDemoGroup(g) && !g.permanent && !g.archived);

const demoGroup = (ctx: TourTaskContext, id: string): Group | null =>
  ctx.groups.find((g) => g.id === id && isTourDemoGroup(g) && !g.permanent && !g.archived) ?? null;
const demoMain = (ctx: TourTaskContext) => demoGroup(ctx, TOUR_DEMO_MAIN_ID);
const demoTarget = (ctx: TourTaskContext) => demoGroup(ctx, TOUR_DEMO_TARGET_ID);

/** The tab row at this position of a practice group, in the main panel (only there while that group is shown). */
export function tourDemoTabRowSelector(groupId: string, windowIndex: number, tabIndex: number): string {
  return `[data-tab-index][data-tm-dnd-id="${quoted(groupId)}::w${windowIndex}::t${tabIndex}"]`;
}
/** The window card at this position of a practice group, in the main panel. */
export function tourDemoWindowSelector(groupId: string, windowIndex: number): string {
  return `[data-tm-dnd-id="${quoted(groupId)}::w${windowIndex}"]`;
}
/** Every tab drag handle of a practice group. */
const demoTabGrips = (groupId: string) => `[data-tab-index][data-tm-dnd-id^="${quoted(groupId)}::w"] ${TAB_GRIP}`;

/** Addresses of a group's tabs, window by window. The sample tabs all have different addresses. */
const tabUrls = (group: Group): string[][] => group.windows.map((w) => w.tabs.map((t) => t.url));
const sameMembers = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** What the three "drag a tab" steps share: the panel, the handles, the lock. */
function tabDragTargets(
  source: string | null,
  drop: string | null,
  highlight: string[],
  marker: Pick<TourTargets, 'dropKind' | 'dropLabel' | 'keepPanel'>
): TourTargets {
  return {
    highlight: [highlight],
    // The ring goes on the exact handle to press, not on the whole row
    action: source ? [[`${source} ${TAB_GRIP}`]] : [],
    drop: drop ? [[drop]] : [],
    ...marker,
    // The row being picked up stays readable next to the card
    keepClear: source ? [[source]] : [],
    dragOnly: true,
    // Only the handle the step asks for: the item picked up is then never the marked destination
    allow: [...(source ? [`${source} ${TAB_GRIP}`] : [demoTabGrips(TOUR_DEMO_MAIN_ID)]), TOUR_MOVE_HOST],
    lockRoots: [ANY_MENU]
  };
}

/** The words on each drop marker (quoted by the sub-step text in `tourSteps.ts`). */
export const TOUR_DROP_LABELS = lazyMessages({
  /** On the line under the last tab of a window: the tab goes into the gap below that tab. */
  belowTab: 'tour.drop.belowTab',
  window: 'tour.drop.window',
  group: 'tour.drop.group',
  /** On the line under the lower practice group. */
  belowGroup: 'tour.drop.belowGroup'
});

/** Where the practice tab is in "Now Open" right now, or `null` while it is not on the list. */
function practiceTabPlace(ctx: TourTaskContext): { groupId: string; windowIndex: number; tabIndex: number } | null {
  const nowOpen = ctx.groups.find((g) => g.permanent);
  if (!nowOpen || ctx.practiceTab.id === null) return null;
  for (const [windowIndex, win] of nowOpen.windows.entries()) {
    const tabIndex = win.tabs.filter(Boolean).findIndex((t) => t.id === ctx.practiceTab.id);
    if (tabIndex !== -1) return { groupId: nowOpen.id, windowIndex, tabIndex };
  }
  return null;
}

export const TOUR_DRAG_TASKS: Pick<
  Record<TourTaskId, TourTask>,
  'drag-tab-reorder' | 'drag-tab-window' | 'drag-tab-group' | 'drag-group-order' | 'save-tabs'
> = {
  /**
   * Save an open tab: drag the tour's OWN spare browser tab from "Now Open" onto the practice
   * group "Tour demo". Done when a practice group holds the practice page and the browser tab
   * is gone from Now Open (saving closes it). Only that tab's handle is unlocked, and the drag
   * engine refuses every other move while the step is up (`lib/tourSandbox.ts`), so no tab of
   * the user's can be saved or closed here. Not offered when the browser would not open the tab.
   */
  'save-tabs': {
    subSteps: 3,
    available: (ctx) => !!demoMain(ctx) && ctx.practiceTab.state !== 'failed',
    baseline: () => true,
    isDone: (ctx) => {
      if (ctx.practiceTab.id === null || !ctx.practiceTab.url) return false;
      const saved = ctx.groups.some((g) => isTourDemoGroup(g) && g.windows.some((w) => w.tabs.some((t) => t?.url === ctx.practiceTab.url)));
      return saved && practiceTabPlace(ctx) === null;
    },
    targets: (ctx) => {
      const main = demoMain(ctx);
      const place = practiceTabPlace(ctx);
      const highlight = [anchor(TOUR_ANCHORS.tabsPanel), anchor(TOUR_ANCHORS.groups)];
      const row = place ? tourDemoTabRowSelector(place.groupId, place.windowIndex, place.tabIndex) : null;
      return {
        highlight: [highlight],
        action: row ? [[`${row} ${TAB_GRIP}`]] : [],
        drop: main ? [[tourGroupRowSelector(main.id)]] : [],
        dropKind: 'onto',
        dropLabel: TOUR_DROP_LABELS.group,
        keepClear: row ? [[row]] : [],
        dragOnly: true,
        // The one handle, by position: no other row of Now Open is ever unlocked
        allow: [...(row ? [`${row} ${TAB_GRIP}`] : []), TOUR_MOVE_HOST],
        lockRoots: [ANY_MENU]
      };
    }
  },

  /**
   * Move a tab to another place in ITS OWN window. Done when a window of "Tour demo" holds the
   * same tabs as when the step was entered, in a different order.
   */
  'drag-tab-reorder': {
    subSteps: 3,
    available: (ctx) => !!demoMain(ctx)?.windows.some((w) => w.tabs.length >= 2),
    baseline: (ctx) => {
      const main = demoMain(ctx);
      return main ? tabUrls(main) : null;
    },
    isDone: (ctx, baseline) => {
      const main = demoMain(ctx);
      if (!main || !Array.isArray(baseline)) return false;
      const before = baseline as string[][];
      return tabUrls(main).some((now, i) => !!before[i] && now.length >= 2 && sameMembers(now, before[i]) && now.join('\n') !== before[i].join('\n'));
    },
    targets: (ctx) => {
      const main = demoMain(ctx);
      const wi = main ? main.windows.findIndex((w) => w.tabs.length >= 2) : -1;
      const marker = { dropKind: 'below', dropLabel: TOUR_DROP_LABELS.belowTab, keepPanel: true } as const;
      if (!main || wi === -1) return tabDragTargets(null, null, [anchor(TOUR_ANCHORS.tabsPanel)], marker);
      const last = main.windows[wi].tabs.length - 1;
      // The gap under the LAST tab of the window: that is where "the end" is
      return tabDragTargets(tourDemoTabRowSelector(main.id, wi, 0), tourDemoTabRowSelector(main.id, wi, last), [anchor(TOUR_ANCHORS.tabsPanel)], marker);
    }
  },

  /** Move a tab into the OTHER window of "Tour demo". Done when a tab is in a different window than before. */
  'drag-tab-window': {
    subSteps: 3,
    available: (ctx) => {
      const main = demoMain(ctx);
      return !!main && main.windows.length >= 2 && main.windows.some((w) => w.tabs.length >= 1);
    },
    baseline: (ctx) => {
      const main = demoMain(ctx);
      return main ? tabUrls(main) : null;
    },
    isDone: (ctx, baseline) => {
      const main = demoMain(ctx);
      if (!main || !Array.isArray(baseline)) return false;
      const before = baseline as string[][];
      return tabUrls(main).some((now, i) => now.some((url) => before.some((urls, j) => j !== i && urls.includes(url))));
    },
    targets: (ctx) => {
      const main = demoMain(ctx);
      const from = main ? main.windows.findIndex((w) => w.tabs.length >= 1) : -1;
      const marker = { dropKind: 'onto', dropLabel: TOUR_DROP_LABELS.window, keepPanel: true } as const;
      if (!main || from === -1 || main.windows.length < 2) return tabDragTargets(null, null, [anchor(TOUR_ANCHORS.tabsPanel)], marker);
      const to = from === 0 ? 1 : 0;
      return tabDragTargets(tourDemoTabRowSelector(main.id, from, 0), tourDemoWindowSelector(main.id, to), [anchor(TOUR_ANCHORS.tabsPanel)], marker);
    }
  },

  /** Drag a tab onto "Tour demo 2" in the list on the left. Done when that group holds a tab it did not have. */
  'drag-tab-group': {
    subSteps: 3,
    available: (ctx) => !!demoTarget(ctx) && !!demoMain(ctx)?.windows.some((w) => w.tabs.length >= 1),
    baseline: (ctx) => {
      const target = demoTarget(ctx);
      return target ? tabUrls(target).flat() : null;
    },
    isDone: (ctx, baseline) => {
      const target = demoTarget(ctx);
      if (!target || !Array.isArray(baseline)) return false;
      return tabUrls(target).flat().some((url) => !(baseline as string[]).includes(url));
    },
    targets: (ctx) => {
      const main = demoMain(ctx);
      const target = demoTarget(ctx);
      const highlight = [anchor(TOUR_ANCHORS.tabsPanel), anchor(TOUR_ANCHORS.groups)];
      const from = main ? main.windows.findIndex((w) => w.tabs.length >= 1) : -1;
      const marker = { dropKind: 'onto', dropLabel: TOUR_DROP_LABELS.group } as const;
      if (!main || !target || from === -1) return tabDragTargets(null, null, highlight, marker);
      return tabDragTargets(tourDemoTabRowSelector(main.id, from, 0), tourGroupRowSelector(target.id), highlight, marker);
    }
  },

  /** Drag one practice group past the other in the list on the left. Done when their order is the other way round. */
  'drag-group-order': {
    subSteps: 3,
    available: (ctx) => {
      const main = demoMain(ctx);
      const target = demoTarget(ctx);
      return !!main && !!target && !!main.starred === !!target.starred;
    },
    baseline: (ctx) => {
      const ids = ctx.groups.filter((g) => g.id === TOUR_DEMO_MAIN_ID || g.id === TOUR_DEMO_TARGET_ID).map((g) => g.id);
      return ids.length === 2 ? ids : null;
    },
    isDone: (ctx, baseline) => {
      const ids = ctx.groups.filter((g) => g.id === TOUR_DEMO_MAIN_ID || g.id === TOUR_DEMO_TARGET_ID).map((g) => g.id);
      return Array.isArray(baseline) && ids.length === 2 && ids[0] !== (baseline as string[])[0];
    },
    targets: (ctx) => {
      const rows = ctx.groups.filter((g) => (g.id === TOUR_DEMO_MAIN_ID || g.id === TOUR_DEMO_TARGET_ID) && isTourDemoGroup(g)).map((g) => tourGroupRowSelector(g.id));
      return {
        highlight: [[anchor(TOUR_ANCHORS.groups)]],
        action: rows[0] ? [[`${rows[0]} ${GROUP_GRIP}`]] : [],
        // The upper practice group goes into the gap UNDER the lower one
        drop: rows[1] ? [[rows[1]]] : [],
        dropKind: 'below',
        dropLabel: TOUR_DROP_LABELS.belowGroup,
        keepClear: rows[0] ? [[rows[0]]] : [],
        dragOnly: true,
        // Only the upper group's handle: the group picked up is then never the marked one
        allow: [...(rows[0] ? [`${rows[0]} ${GROUP_GRIP}`] : []), TOUR_MOVE_HOST],
        lockRoots: [ANY_MENU]
      };
    }
  }
};

/** The step's task when it can be offered to this user right now, else `null` (read-only step). */
export function activeTourTask(step: TourStep | null, ctx: TourTaskContext): TourTask | null {
  if (!step?.task) return null;
  const task = tourTask(step.task);
  return task?.available(ctx) ? task : null;
}

/** What a read-only step highlights: its anchor and any extras, as one ring. */
export function readOnlyTargets(step: TourStep): TourTargets {
  const names = [step.anchor, ...(step.anchorExtra ?? [])].filter((name): name is string => !!name);
  return { highlight: names.length ? [names.map(anchor)] : [], action: [], allow: [], lockRoots: [] };
}
