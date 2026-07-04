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
    info: '0T | 0W',
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
    info: '0T | 0W',
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

export function getGroupInfo(group: Group): string {
  const tabCount = getGroupTabCount(group);
  const winCount = group.windows.length;
  return `${tabCount}T | ${winCount}W`;
}

export function sortWindowsByStarred(windows: Window[]): Window[] {
  return [...windows.filter((w) => w.starred), ...windows.filter((w) => !w.starred)];
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
