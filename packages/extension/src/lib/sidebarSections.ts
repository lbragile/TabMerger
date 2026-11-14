/**
 * The collapsible sections at the bottom of the sidebar. They are an accordion: at most one is
 * open (`uiStore.openSidebarSection`). Kept out of the store module so components (and tests that
 * replace the store with a mock) can name a section without importing the store.
 */
export const SIDEBAR_SECTION = Object.freeze({
  autoSaved: 'autoSaved',
  archived: 'archived',
  sessions: 'sessions'
} as const);

export type SidebarSectionId = (typeof SIDEBAR_SECTION)[keyof typeof SIDEBAR_SECTION];
