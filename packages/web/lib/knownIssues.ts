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
    id: 'change-lost-if-popup-closes-instantly',
    area: 'Extension',
    title: 'A change made the instant before the popup closes may not be saved',
    details:
      'A change (a new colour, a rename, a move, a note) takes a split second to be stored. If the popup closes within that moment, for example by pressing Enter and then Escape straight away, or on a slow or busy computer, the change can be missing when you reopen TabMerger. Nothing else is affected.',
    workaround: 'Reopen TabMerger and make the change again. After an edit, give the popup a moment before closing it.',
  },
  {
    id: 'tab-address-cut-off',
    area: 'Extension',
    title: 'A long web address in a tab row is cut off without “…”',
    details:
      'When a tab’s address is too long for its column, it stops abruptly, sometimes in the middle of a letter, instead of ending in “…”. On a narrow row it can also run up against the “renamed” label. Only the display is affected; the saved address is complete.',
    workaround: 'Hover the tab to see its full address.',
  },
  {
    id: 'subscription-currency-fixed',
    area: 'Billing',
    title: 'A subscription keeps the currency it started in',
    details:
      'Checkout shows the price in your local currency, but a subscription (and every plan change or renewal of it) stays in the currency it was first paid in. Accounts that subscribed before local pricing keep paying in US dollars. Renewals in a local currency are converted again each time, so the amount can shift slightly with exchange rates.',
    workaround: 'To test local pricing, use a new account (see “Paying in your local currency” above).',
  },
  {
    id: 'dashboard-sync-time-new-browser',
    area: 'Web app',
    title: 'The dashboard’s “Synced” time can be older than your last sync',
    details:
      'In a browser that has not seen a sync yet (a new browser, or after clearing site data), the sync label in the dashboard header shows when your groups last changed, not when a device last synced. While the dashboard is open, a sync from another device that changed nothing, or that only deleted a group, does not move the time either.',
    workaround:
      'Press the refresh button on the label. The extension in that browser syncs and the time updates.',
  },
  {
    id: 'dashboard-locked-after-passphrase-reset',
    area: 'Web app',
    title: 'Some groups or sessions show as “(locked)” after a passphrase reset',
    details:
      'After you reset your encryption passphrase, the dashboard asks for the new one. Anything that was saved with the earlier passphrase and has not been uploaded again since still cannot be read, even though the new passphrase is correct: it shows as “(locked)” with a short explanation on the item, and it cannot be shared or restored (a locked session can still be deleted). A device listed in Account shows the same explanation instead of its window and tab count.',
    workaround:
      'Open the extension on the device that has those groups or sessions, unlock it with the new passphrase and let it sync. It uploads them again and the dashboard can read them after a refresh.',
  },
]
