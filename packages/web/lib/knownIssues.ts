/**
 * Known issues shown to beta testers on /beta, so they don't spend time reporting what we
 * already know about. KEEP THIS CURRENT (a CLAUDE.md rule): add an entry when a user-visible bug
 * is confirmed but not fixed in the same change, reword it when its scope or workaround changes,
 * and delete it in the change that fixes it. Describe what the tester sees, not the code.
 */
export type KnownIssue = {
  /** Stable id: used as the list key and in links (#known-issue-<id>). */
  id: string
  title: string
  /** Where it shows up. */
  area: 'Extension' | 'Sync' | 'Web app' | 'Billing' | 'Firefox' | 'Chrome'
  /** What the tester sees, and when. */
  details: string
  /** What to do meanwhile, if anything helps. */
  workaround?: string
}

export const KNOWN_ISSUES: KnownIssue[] = [
  {
    id: 'sync-reverts-edits',
    area: 'Sync',
    title: 'A change made while a sync is running can be undone',
    details:
      'With sync on, renaming, moving or creating a group at the moment a sync starts (syncs also start when a dialog opens or closes) can be reverted when that sync finishes, and a group created in that moment can disappear.',
    workaround:
      'If a change reverts, make it again: it sticks once the sync has finished. Pause for a couple of seconds after an edit before opening another dialog.',
  },
  {
    id: 'account-switch-leftover-groups',
    area: 'Sync',
    title: 'Switching accounts in one browser can bring back the previous account’s groups',
    details:
      'After signing out of one account and into another in the same browser profile, groups from the first account can reappear under the second one.',
    workaround: 'Use a separate browser profile for each TabMerger account during the beta.',
  },
  {
    id: 'sync-group-order',
    area: 'Sync',
    title: 'Group order can differ between devices',
    details:
      'Your groups, their names and their tabs sync to your other devices, but the order of groups in the sidebar may not: another device (or the web dashboard) can list the same groups in a different order.',
    workaround: 'Nothing is lost: every group and tab is there, only the order differs.',
  },
  {
    id: 'keyboard-drag-unreliable',
    area: 'Extension',
    title: 'Moving items with the keyboard doesn’t work well in every case',
    details:
      'Picking up a tab, window or group with Space and moving it with the arrow keys works for simple moves, but some combinations (moving between windows or groups, several selected items, the drop zones) can land in the wrong place or not move at all.',
    workaround:
      'Use the mouse, or right-click the item and choose “Move to group”. Tell us which keyboard move went wrong: it helps us fix it.',
  },
  {
    id: 'background-save-overwrites-popup',
    area: 'Extension',
    title: 'Saving tabs from outside the popup can overwrite a change made in it at the same moment',
    details:
      'Saving tabs with the right-click menu or a keyboard shortcut, or a URL rule moving a tab, while you are changing something in the open popup can occasionally undo that popup change.',
    workaround: 'If a popup change goes missing right after a background save, redo it.',
  },
  {
    id: 'chrome-beta-review-lag',
    area: 'Chrome',
    title: 'New Chrome beta versions arrive after Chrome Web Store review',
    details:
      'Each beta update is reviewed by the Chrome Web Store before it reaches testers, which can take from a few hours to a couple of days. Features described here may appear on the preview site before they reach your extension.',
  },
  {
    id: 'firefox-version-number',
    area: 'Firefox',
    title: 'Firefox shows a different version number',
    details:
      'about:addons lists the Firefox beta as 4.1.0.x (e.g. 4.1.0.8 for 3.1.0-beta.8). That is expected: Firefox can only show a numeric version.',
    workaround: 'When reporting a bug, give the version shown in TabMerger’s Settings instead.',
  },
  {
    id: 'subscription-currency-fixed',
    area: 'Billing',
    title: 'A subscription keeps the currency it started in',
    details:
      'Checkout shows the price in your local currency, but a subscription (and every plan change or renewal of it) stays in the currency it was first paid in. Accounts that subscribed before local pricing keep paying in US dollars. Renewals in a local currency are converted again each time, so the amount can shift slightly with exchange rates.',
    workaround: 'To test local pricing, use a new account (see “Paying in your local currency” above).',
  },
]
