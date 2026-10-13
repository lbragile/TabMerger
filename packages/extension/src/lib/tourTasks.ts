import { isTourDemoGroup } from '@tabmerger/shared';
import { DEFAULT_GROUP_TITLE, type Group } from './types';
import { TOUR_DEMO_MAIN_ID, TOUR_DEMO_TARGET_ID } from './tourDemo';
import { tourAnchorSelector, type TourStep, type TourTaskId } from './tour';
import { TOUR_ANCHORS, TOUR_READY_ATTR } from './tourSteps';

/**
 * The tour's interactive steps ("tasks"): what each one waits for, what it highlights and what
 * it lets the user operate. Pure functions over a snapshot of real app state, so a task is
 * complete when the STATE says so (a group exists, its colour differs, the saved theme
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
   * The colour being tried in the practice group's colour picker and not applied yet
   * (`uiStore.previewGroupColor`, for that group only), or `null`.
   */
  previewColor: string | null;
}

export interface TourTargets {
  /**
   * What to draw the ring around: lists of CSS selectors, most specific first. The first list
   * with at least one element on the page wins, and the ring goes around all of its elements
   * together (a dialog and the list box it opened, a row and its colour picker).
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
   * A drag step's destination, for the dashed "Drop here" marker: lists of CSS selectors, read
   * exactly like `action`. Stays up while the item is being dragged.
   */
  drop?: string[][];
  /**
   * True for a drag step. The unlocked controls are drag handles, and only what a drag needs
   * reaches them: a press, the drag itself and the Space key (which picks the item up for a
   * keyboard move). No click, no right-click menu, no other key.
   */
  dragOnly?: boolean;
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
  /** A modal (`uiStore.modal.type`) the tour stays on screen for, because the task opens it. */
  modal?: 'settings';
  /**
   * False = "done" is read from the state every time and never remembered. For a task whose
   * result can be taken back while the step is still up (a new group that is cancelled).
   */
  remember?: boolean;
  /** How many controls the task visits in a row (its sub-steps). Omit for a single control. */
  subSteps?: number;
}

const anchor = tourAnchorSelector;

/** Any dialog except the tour's own card. */
export const TOUR_FOREIGN_DIALOG = '[role="dialog"]:not([data-tour-card])';
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

/** The task with this id. */
export function tourTask(id: TourTaskId): TourTask {
  return (TOUR_DRAG_TASKS as Partial<Record<TourTaskId, TourTask>>)[id] ?? TOUR_TASKS[id as keyof typeof TOUR_TASKS];
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

  /** The practice group's colour dot, then Apply. Done when the stored colour differs. */
  'group-colour': {
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
      // A colour that differs from the stored one is being tried: "Apply" is what is left
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

  /** Open the search box and type. Done when there is a search query. */
  search: {
    subSteps: 2,
    available: () => true,
    baseline: () => true,
    isDone: (ctx) => ctx.searchFilter.trim().length > 0,
    targets: () => ({
      highlight: [[anchor(TOUR_ANCHORS.searchOverlay)], [anchor(TOUR_ANCHORS.search)]],
      // The field inside the search box once it is open, the "Open search" box until then
      action: [[`${anchor(TOUR_ANCHORS.searchOverlay)} input`], [anchor(TOUR_ANCHORS.search)]],
      actionSteps: [2, 1],
      allow: [anchor(TOUR_ANCHORS.search), anchor(TOUR_ANCHORS.searchOverlay)],
      lockRoots: []
    })
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
const TAB_GRIP = '[aria-label^="Drag to reorder tab"]';
const GROUP_GRIP = '[aria-label^="Drag to reorder group"]';
/** Any menu a press could still open is locked as a whole. */
const ANY_MENU = '[role="menu"]';

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
function tabDragTargets(source: string | null, drop: string | null, highlight: string[]): TourTargets {
  return {
    highlight: [highlight],
    // The ring goes on the exact handle to press, not on the whole row
    action: source ? [[`${source} ${TAB_GRIP}`]] : [],
    drop: drop ? [[drop]] : [],
    dragOnly: true,
    allow: [demoTabGrips(TOUR_DEMO_MAIN_ID), TOUR_MOVE_HOST],
    lockRoots: [ANY_MENU]
  };
}

export const TOUR_DRAG_TASKS: Pick<Record<TourTaskId, TourTask>, 'drag-tab-reorder' | 'drag-tab-window' | 'drag-tab-group' | 'drag-group-order'> = {
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
      if (!main || wi === -1) return tabDragTargets(null, null, [anchor(TOUR_ANCHORS.tabsPanel)]);
      const last = main.windows[wi].tabs.length - 1;
      return tabDragTargets(tourDemoTabRowSelector(main.id, wi, 0), tourDemoTabRowSelector(main.id, wi, last), [anchor(TOUR_ANCHORS.tabsPanel)]);
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
      if (!main || from === -1 || main.windows.length < 2) return tabDragTargets(null, null, [anchor(TOUR_ANCHORS.tabsPanel)]);
      const to = from === 0 ? 1 : 0;
      return tabDragTargets(tourDemoTabRowSelector(main.id, from, 0), tourDemoWindowSelector(main.id, to), [anchor(TOUR_ANCHORS.tabsPanel)]);
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
      if (!main || !target || from === -1) return tabDragTargets(null, null, highlight);
      return tabDragTargets(tourDemoTabRowSelector(main.id, from, 0), tourGroupRowSelector(target.id), highlight);
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
        drop: rows[1] ? [[rows[1]]] : [],
        dragOnly: true,
        allow: [...rows.map((row) => `${row} ${GROUP_GRIP}`), TOUR_MOVE_HOST],
        lockRoots: [ANY_MENU]
      };
    }
  }
};

/** The step's task when it can be offered to this user right now, else `null` (read-only step). */
export function activeTourTask(step: TourStep | null, ctx: TourTaskContext): TourTask | null {
  if (!step?.task) return null;
  const task = tourTask(step.task);
  return task.available(ctx) ? task : null;
}

/** What a read-only step highlights: its anchor and any extras, as one ring. */
export function readOnlyTargets(step: TourStep): TourTargets {
  const names = [step.anchor, ...(step.anchorExtra ?? [])].filter((name): name is string => !!name);
  return { highlight: names.length ? [names.map(anchor)] : [], action: [], allow: [], lockRoots: [] };
}
