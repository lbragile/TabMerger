/**
 * Whether a runtime message came from one of this extension's OWN pages (the popup, an extension
 * page open in a tab) and not from a content script. A content script's message also carries this
 * extension's id, so the id alone proves nothing: on Firefox the web-bridge content script runs on
 * the web app's origin and relays what that page posts. A content script's `sender.url` is the
 * web page it runs in; every page of this extension (the popup, which has no tab, an extension
 * page open in a tab, the worker or background page itself) has a URL under this extension's own
 * origin, `chrome-extension://<id>/` in Chrome and Edge, `moz-extension://<uuid>/` in Firefox,
 * which is exactly what `runtime.getURL('')` returns in each.
 *
 * So the URL is REQUIRED and must be under that origin, with or without a tab. "No tab" alone is
 * not accepted: it says the sender is not in a tab, not that it is this extension's page, and a
 * sender without a URL cannot be placed at all.
 *
 * Internal messages that DO something (alarms, sign-in, backups) must pass this check. Messages
 * from the web app go through `parseBridgeMessage` and their own origin check instead.
 */
export function isOwnExtensionPage(sender: chrome.runtime.MessageSender | undefined): boolean {
  if (!sender || typeof chrome === 'undefined' || !chrome.runtime?.id || sender.id !== chrome.runtime.id) return false;
  const ownOrigin = typeof chrome.runtime.getURL === 'function' ? chrome.runtime.getURL('') : '';
  // `getURL('')` ends with "/", so `chrome-extension://<id>.evil/` or a longer id cannot match
  if (!/^[a-z-]+:\/\/[^/]+\/$/.test(ownOrigin)) return false;
  return typeof sender.url === 'string' && sender.url.startsWith(ownOrigin);
}

/** Reminder alarms are named `reminder-<tab>-<group>-<window>-<tab index>` by the popup. */
const REMINDER_ALARM_NAME = /^reminder-[A-Za-z0-9_-]{1,120}$/;

/**
 * The only alarm names the popup may create or clear through the worker: reminders. Any other
 * name (the automatic backup alarm in particular) is refused.
 */
export function isReminderAlarmName(name: unknown): name is string {
  return typeof name === 'string' && REMINDER_ALARM_NAME.test(name);
}

/** A usable alarm delay: a finite number of minutes greater than zero. */
export function isAlarmDelayMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
