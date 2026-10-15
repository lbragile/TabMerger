/** Runtime message sent after every groups write so OTHER extension contexts can react (menu rebuild in the worker, refetch in open popups). */
export const GROUPS_CHANGED_MESSAGE = 'TM_GROUPS_CHANGED';

/**
 * Why a groups write happened, when the receiver needs to tell it apart from an unrelated change.
 * `url-rule`: the service worker saved the live tab `tabId` at `url` because it matched a URL rule.
 * When the popup itself just opened that tab (a drop into Now Open, an Undo reopening tabs), the save is a
 * consequence of the popup's own action, so it must not wipe the popup's undo history.
 */
export type GroupsChangeCause = { kind: 'url-rule'; tabId: number; url: string };

/** The message body: `{ type: GROUPS_CHANGED_MESSAGE, cause? }`. */
export interface GroupsChangedMessage {
  type: typeof GROUPS_CHANGED_MESSAGE;
  cause?: GroupsChangeCause;
}
