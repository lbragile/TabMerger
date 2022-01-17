import { GOOGLE_HOMEPAGE } from "~/constants/urls";
import { IGroupItemState } from "~/store/reducers/groups";

export function pluralize(amount: number, baseStr: string): string {
  return amount === 1 ? baseStr : baseStr + "s";
}

/**
 * Format a string that indicates the relative time given the current and previous values in milliseconds
 * @param previous
 * @param current
 * @see https://stackoverflow.com/a/6109105/4298115
 * @example 1 sec, 10 secs, 1 min, 10 mins, 1 hour, 10 hours, etc.
 * @returns A pluralized relative timestamp
 */
export function relativeTimeStr(previous: number, current = Date.now()): string {
  const MS_PER_MINUTE = 60 * 1000;
  const MS_PER_HOUR = 60 * MS_PER_MINUTE;
  const MS_PER_DAY = 24 * MS_PER_HOUR;
  const MS_PER_WEEK = 7 * MS_PER_DAY;
  const MS_PER_MONTH = 30 * MS_PER_DAY;
  const MS_PER_YEAR = 365 * MS_PER_DAY;

  const elapsed = current - previous;
  let [val, type] = [0, "sec"];

  if (elapsed < MS_PER_MINUTE) {
    [val, type] = [elapsed / 1000, "sec"];
  } else if (elapsed < MS_PER_HOUR) {
    [val, type] = [elapsed / MS_PER_MINUTE, "min"];
  } else if (elapsed < MS_PER_DAY) {
    [val, type] = [elapsed / MS_PER_HOUR, "hour"];
  } else if (elapsed < MS_PER_WEEK) {
    [val, type] = [elapsed / MS_PER_DAY, "week"];
  } else if (elapsed < MS_PER_MONTH) {
    [val, type] = [elapsed / MS_PER_DAY, "day"];
  } else if (elapsed < MS_PER_YEAR) {
    [val, type] = [elapsed / MS_PER_MONTH, "month"];
  } else {
    [val, type] = [elapsed / MS_PER_YEAR, "year"];
  }

  val = Math.round(val);

  return type === "sec" ? "< 1 min" : `${val} ${pluralize(val, type)}`;
}

export function getReadableTimestamp(timestamp = Date.now()): string {
  const parts = new Date(timestamp).toString().split(" ");

  return `${parts.slice(1, 4).join(" ")} ${parts[4]}`;
}

/**
 * While dragging a window, this hides its tabs to provide a consistent UI/UX regardless ...
 * ... of the number of tabs in the window.
 * Upon dragend, the tabs are re-shown
 */
export const toggleWindowTabsVisibility = (draggableId: string, show: boolean): void => {
  const droppableId = draggableId.split("-").slice(0, 2).join("-");

  const elem = document.querySelector(
    `[data-rbd-draggable-id*="${draggableId}"] [data-rbd-droppable-id^="${droppableId}"]`
  ) as HTMLDivElement | null;

  if (elem) {
    elem.style.display = show ? "flex" : "none";
  }
};

export function sortWindowsByFocus(windows: chrome.windows.Window[]): {
  sortedWindows: chrome.windows.Window[];
  hasFocused: boolean;
} {
  const focused = windows.filter((w) => w.focused);
  const notFocused = windows.filter((w) => !w.focused);

  return { sortedWindows: focused.concat(notFocused), hasFocused: focused.length > 0 };
}

export const generateFavIconFromUrl = (url: string | undefined) =>
  `https://s2.googleusercontent.com/s2/favicons?domain_url=${url ?? GOOGLE_HOMEPAGE}`;

export function createActiveTab(url: string) {
  chrome.tabs.create({ url, active: true }, () => "");
}

export const createTabFromTitleAndUrl = (title: string | undefined, url: string | undefined): chrome.tabs.Tab => ({
  title: title ?? "New",
  url: url ?? GOOGLE_HOMEPAGE,
  favIconUrl: generateFavIconFromUrl(url),
  active: false,
  audible: false,
  autoDiscardable: true,
  discarded: false,
  groupId: -1,
  highlighted: false,
  incognito: false,
  index: 0,
  pinned: false,
  selected: false,
  windowId: 1
});

export const createWindowWithTabs = (
  tabs: chrome.tabs.Tab[],
  name = "Window",
  incognito = false,
  starred = false
): chrome.windows.Window & { starred: boolean; name: string } => ({
  alwaysOnTop: false,
  focused: false,
  incognito,
  starred,
  name,
  state: "maximized",
  type: "normal",
  tabs
});

export const createGroup = (id: string, name = "New", color = "rgba(128, 128, 128, 1)"): IGroupItemState => ({
  name,
  id,
  color,
  updatedAt: Date.now(),
  windows: [],
  permanent: false,
  info: "0T | 0W"
});

/**
 * Replaces all <tag> instances with &lt;tag&gt; to avoid breaking document ...
 * ... structure in exported markdown & html files
 */
export const formatHtml = (str?: string) => str?.replace(/<([^>]*)>/g, "&lt;$1&gt;");
