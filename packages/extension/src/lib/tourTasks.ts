import { DEFAULT_GROUP_TITLE, type Group } from './types';
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

export const TOUR_TASKS: Record<TourTaskId, TourTask> = {
  /**
   * "Add Group", then type a name. Done once the practice group exists, has a name of its own
   * (not the placeholder a new group starts with) and that name is no longer being edited.
   * Cancelling the new group's name deletes it again (the app's own rule for a group that was
   * never named), which simply puts the step back to "not done": hence `remember: false`.
   */
  'make-group': {
    remember: false,
    available: (ctx) => findPracticeGroup(ctx) !== null || savedGroupIds(ctx.groups).length < ctx.maxGroups,
    baseline: (ctx) => savedGroupIds(ctx.groups),
    isDone: (ctx) => {
      const group = findPracticeGroup(ctx);
      return group !== null && group.name !== DEFAULT_GROUP_TITLE && !isRenaming(ctx, group);
    },
    targets: (ctx) => {
      const row = practiceRow(ctx);
      const addGroup = anchor(TOUR_ANCHORS.addGroup);
      if (!row) return { highlight: [[addGroup]], action: [[addGroup]], allow: [addGroup], lockRoots: [] };
      return {
        highlight: [[row]],
        // "Save" once a name of the user's own is in the field (GroupItem marks it), the field until then
        action: [
          [`${row} ${anchor(TOUR_ANCHORS.groupNameSave)}[${TOUR_READY_ATTR}]`],
          [`${row} ${anchor(TOUR_ANCHORS.groupNameInput)}`]
        ],
        allow: [`${row} ${anchor(TOUR_ANCHORS.groupName)}`],
        lockRoots: []
      };
    }
  },

  /** The practice group's colour dot, then Apply. Done when the stored colour differs. */
  'group-colour': {
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
    available: () => true,
    baseline: () => true,
    isDone: (ctx) => ctx.searchFilter.trim().length > 0,
    targets: () => ({
      highlight: [[anchor(TOUR_ANCHORS.searchOverlay)], [anchor(TOUR_ANCHORS.search)]],
      // The field inside the search box once it is open, the "Open search" box until then
      action: [[`${anchor(TOUR_ANCHORS.searchOverlay)} input`], [anchor(TOUR_ANCHORS.search)]],
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

/** The step's task when it can be offered to this user right now, else `null` (read-only step). */
export function activeTourTask(step: TourStep | null, ctx: TourTaskContext): TourTask | null {
  if (!step?.task) return null;
  const task = TOUR_TASKS[step.task];
  return task.available(ctx) ? task : null;
}

/** What a read-only step highlights: its anchor and any extras, as one ring. */
export function readOnlyTargets(step: TourStep): TourTargets {
  const names = [step.anchor, ...(step.anchorExtra ?? [])].filter((name): name is string => !!name);
  return { highlight: names.length ? [names.map(anchor)] : [], action: [], allow: [], lockRoots: [] };
}
