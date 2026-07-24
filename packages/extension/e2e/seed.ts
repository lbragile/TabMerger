import type { Page } from '@playwright/test';

// ─── Fuller seed helpers — every seeded tab gets a favicon + preview image ────
// (values are arbitrary/random, not asserted on — they just make seeded state
// look like a real tab instead of a bare {id,title,url} stub.)

let picsumSeed = 0;
function randomFavIconUrl(): string {
  return `https://www.google.com/s2/favicons?domain=example${(picsumSeed += 1)}.com&sz=32`;
}
function randomOgImage(): string {
  return `https://picsum.photos/seed/tabmerger-${(picsumSeed += 1)}/400/225`;
}

export function tab(id: number, title: string, url: string) {
  return { id, title, url, favIconUrl: randomFavIconUrl(), ogImage: randomOgImage() };
}

// ─── Shared group seed data ───────────────────────────────────────────────────

export const NOW_OPEN = {
  id: 'nowopen0001',
  name: 'Now Open',
  permanent: true,
  color: 'rgba(128,128,128,1)',
  windows: [
    {
      id: 1,
      incognito: false,
      focused: true,
      tabs: [
        tab(1, 'Google', 'https://google.com'),
        tab(2, 'GitHub', 'https://github.com'),
      ],
    },
  ],
};

export const SAVED_GROUP = {
  id: 'savedgroup01',
  name: 'Work Stuff',
  color: 'rgba(59,130,246,1)',
  windows: [
    {
      id: 2,
      incognito: false,
      focused: false,
      tabs: [
        tab(3, 'Jira Board', 'https://jira.example.com'),
        tab(4, 'Confluence', 'https://confluence.example.com'),
      ],
    },
  ],
};

export const ANOTHER_GROUP = {
  id: 'anothergrp1',
  name: 'Reading List',
  color: 'rgba(16,185,129,1)',
  windows: [
    {
      id: 3,
      incognito: false,
      focused: false,
      tabs: [tab(5, 'Hacker News', 'https://news.ycombinator.com')],
    },
  ],
};

// Work group with two windows — used across group/tab/window/search/selection tests
export const WORK_GROUP = {
  id: 'workgrp0001',
  name: 'Work',
  color: 'rgba(59,130,246,1)',
  windows: [
    {
      id: 10,
      incognito: false,
      focused: false,
      tabs: [
        tab(10, 'Jira Board', 'https://jira.example.com'),
        tab(11, 'Confluence', 'https://confluence.example.com'),
      ],
    },
    {
      id: 11,
      incognito: false,
      focused: false,
      tabs: [tab(12, 'Slack', 'https://app.slack.com')],
    },
  ],
};

// ─── Settings helpers ─────────────────────────────────────────────────────────

/** Seed confirmOnDelete setting directly into IDB without opening the Settings modal. */
export async function seedConfirmOnDelete(page: Page, value: boolean) {
  await page.evaluate(async (val) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('tabmerger', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({ id: 'appSettings', value: { confirmOnDelete: val } });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, value);
}
