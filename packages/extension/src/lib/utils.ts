import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { nanoid } from 'nanoid';
import type { Group, Window, Tab } from './types';
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE, DEFAULT_WINDOW_TITLE, FIRST_GROUP_TITLE } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function createGroup(
  id: string = nanoid(10),
  name: string = DEFAULT_GROUP_TITLE,
  color: string = DEFAULT_GROUP_COLOR
): Group {
  return {
    id,
    name,
    color,
    updatedAt: Date.now(),
    windows: [],
    permanent: false,
    info: formatGroupCounts(0, 0),
    pendingSync: true
  };
}

export function createNowOpenGroup(): Group {
  return {
    id: nanoid(10),
    name: FIRST_GROUP_TITLE,
    color: DEFAULT_GROUP_COLOR,
    updatedAt: Date.now(),
    windows: [],
    permanent: true,
    info: formatGroupCounts(0, 0),
    pendingSync: false
  };
}

export function createWindow(
  tabs: Tab[] = [],
  name: string = DEFAULT_WINDOW_TITLE,
  incognito = false,
  starred = false
): Window {
  return {
    id: Date.now() + Math.floor(Math.random() * 10000),
    tabs,
    incognito,
    focused: false,
    starred,
    name
  };
}

export function createTab(title = 'New Tab', url = 'https://www.google.com'): Tab {
  return {
    id: Date.now() + Math.floor(Math.random() * 10000),
    title,
    url,
    favIconUrl: getFaviconUrl(url),
    pinned: false
  };
}

export function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://s2.googleusercontent.com/s2/favicons?domain_url=${u.origin}`;
  } catch {
    return 'https://www.google.com/favicon.ico';
  }
}

export function getGroupTabCount(group: Group): number {
  return group.windows.reduce((acc, w) => acc + w.tabs.length, 0);
}

/**
 * Format window and tab counts as full singular/plural words.
 * e.g. formatGroupCounts(1, 3) → "1 Window | 3 Tabs"
 */
export function formatGroupCounts(windowCount: number, tabCount: number): string {
  return `${windowCount} ${pluralize(windowCount, 'Window')} ◆ ${tabCount} ${pluralize(tabCount, 'Tab')}`;
}

export function getGroupInfo(group: Group): string {
  const tabCount = getGroupTabCount(group);
  const winCount = group.windows.length;
  return formatGroupCounts(winCount, tabCount);
}

export function sortWindowsByStarred(windows: Window[]): Window[] {
  return [...windows.filter((w) => w.starred), ...windows.filter((w) => !w.starred)];
}

/** Returns true if all characters of query appear in text in order (case-insensitive). */
export function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const t = text.toLowerCase(), q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Parse a search query supporting group:, window:, and tag: prefixes with optional quoted values.
 * Prefixes are only recognized at the start of the string or after whitespace.
 * Unquoted values consume until the next recognized prefix or end of string.
 * e.g. 'group:"My Group" open tabs' → { groupFilter: "My Group", windowFilter: "", tagFilter: "", tabQuery: "open tabs" }
 * e.g. 'window:Morning'             → { groupFilter: "", windowFilter: "Morning", tagFilter: "", tabQuery: "" }
 * e.g. 'xyz_group:work'             → { groupFilter: "", windowFilter: "", tagFilter: "", tabQuery: "xyz_group:work" }
 */
export function parseSearchQuery(query: string): { groupFilter: string; windowFilter: string; tagFilter: string; tabQuery: string } {
  const PREFIX_RE = /group:|window:|tag:/i;
  let groupFilter = '';
  let windowFilter = '';
  let tagFilter = '';
  const plainParts: string[] = [];
  let pos = 0;
  let plainStart = 0; // start of the current uninterrupted plain-text run

  while (pos < query.length) {
    const slice = query.slice(pos);
    const m = slice.match(PREFIX_RE);

    if (!m || m.index === undefined) {
      const tail = query.slice(plainStart).trim();
      if (tail) plainParts.push(tail);
      break;
    }

    const absMatchPos = pos + m.index;
    // Only treat as a prefix if at the start of the string or preceded by whitespace
    if (absMatchPos > 0 && !/\s/.test(query[absMatchPos - 1])) {
      // Not a word boundary — skip past the pseudo-prefix and keep accumulating plain text
      pos += m.index + m[0].length;
      continue;
    }

    // Flush any plain text accumulated before this real prefix
    const plainText = query.slice(plainStart, absMatchPos).trim();
    if (plainText) plainParts.push(plainText);

    const prefix = m[0].toLowerCase();
    pos = absMatchPos + m[0].length;

    let value: string;
    if (query[pos] === '"') {
      pos++; // skip opening quote
      const closing = query.indexOf('"', pos);
      if (closing === -1) { value = query.slice(pos).trim(); pos = query.length; }
      else { value = query.slice(pos, closing); pos = closing + 1; }
    } else {
      const rest = query.slice(pos);
      const next = rest.match(PREFIX_RE);
      if (!next || next.index === undefined) { value = rest.trim(); pos = query.length; }
      else { value = rest.slice(0, next.index).trim(); pos += next.index; }
    }

    if (prefix === 'group:') groupFilter = value;
    else if (prefix === 'window:') windowFilter = value;
    else tagFilter = value;
    plainStart = pos; // resume plain-text accumulation after the consumed value
  }

  return { groupFilter, windowFilter, tagFilter, tabQuery: plainParts.filter(Boolean).join(' ') };
}

export function pluralize(amount: number, baseStr: string): string {
  return amount === 1 ? baseStr : baseStr + 's';
}

export function relativeTimeStr(previous: number, current = Date.now()): string {
  const MS_PER_MINUTE = 60 * 1000;
  const MS_PER_HOUR = 60 * MS_PER_MINUTE;
  const MS_PER_DAY = 24 * MS_PER_HOUR;
  const MS_PER_MONTH = 30 * MS_PER_DAY;
  const MS_PER_YEAR = 365 * MS_PER_DAY;

  const elapsed = current - previous;

  if (elapsed < MS_PER_MINUTE) return '< 1 min';
  if (elapsed < MS_PER_HOUR) return `${Math.round(elapsed / MS_PER_MINUTE)} ${pluralize(Math.round(elapsed / MS_PER_MINUTE), 'min')}`;
  if (elapsed < MS_PER_DAY) return `${Math.round(elapsed / MS_PER_HOUR)} ${pluralize(Math.round(elapsed / MS_PER_HOUR), 'hour')}`;
  if (elapsed < MS_PER_MONTH) return `${Math.round(elapsed / MS_PER_DAY)} ${pluralize(Math.round(elapsed / MS_PER_DAY), 'day')}`;
  if (elapsed < MS_PER_YEAR) return `${Math.round(elapsed / MS_PER_MONTH)} ${pluralize(Math.round(elapsed / MS_PER_MONTH), 'month')}`;
  return `${Math.round(elapsed / MS_PER_YEAR)} ${pluralize(Math.round(elapsed / MS_PER_YEAR), 'year')}`;
}
