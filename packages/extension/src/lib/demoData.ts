import { nanoid } from 'nanoid';
import type { GroupsState, Group, Tab } from './types';

// ponytail: demo-only fixture, not wired into any production data path

function tab(id: number, title: string, url: string, savedAt?: number): Tab {
  return {
    id,
    title,
    url,
    favIconUrl: `https://s2.googleusercontent.com/s2/favicons?domain_url=${new URL(url).origin}`,
    ...(savedAt !== undefined ? { savedAt } : {})
  };
}

// ponytail: 40 days ago so these demo tabs cross the default 30-day stale threshold
const STALE_SAVED_AT = Date.now() - 40 * 24 * 60 * 60 * 1000;

const work: Group = {
  id: nanoid(10),
  name: 'Work',
  color: 'rgba(168, 85, 247, 1)',
  updatedAt: Date.now(),
  windows: [
    {
      id: 1000,
      incognito: false,
      focused: false,
      tabs: [
        tab(1, 'Inbox (14) — jane.doe@example.com — Gmail', 'https://mail.google.com/mail/u/0/#inbox'),
        tab(2, 'Q3 Planning — Google Calendar', 'https://calendar.google.com/calendar/u/0/r/week'),
        tab(3, '#product-team — Slack', 'https://app.slack.com/client'),
        tab(4, 'lbragile/TabMerger — Pull requests — GitHub', 'https://github.com/lbragile/TabMerger/pulls'),
        tab(5, 'Sprint Notes — Notion', 'https://www.notion.so/Sprint-Notes')
      ]
    }
  ]
};

const research: Group = {
  id: nanoid(10),
  name: 'Research',
  color: 'rgba(59, 130, 246, 1)',
  updatedAt: Date.now(),
  windows: [
    {
      id: 1001,
      incognito: false,
      focused: false,
      tabs: [
        tab(6, 'Attention Is All You Need — arXiv', 'https://arxiv.org/abs/1706.03762'),
        tab(7, 'React Docs — useEffect', 'https://react.dev/reference/react/useEffect'),
        tab(8, 'MDN — IndexedDB API', 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API'),
        tab(9, 'WXT — Getting Started', 'https://wxt.dev/guide/installation.html')
      ]
    }
  ]
};

const shopping: Group = {
  id: nanoid(10),
  name: 'Shopping',
  color: 'rgba(34, 197, 94, 1)',
  updatedAt: Date.now(),
  windows: [
    {
      id: 1002,
      incognito: false,
      focused: false,
      tabs: [
        tab(10, 'Standing Desk — Amazon.com', 'https://www.amazon.com/s?k=standing+desk'),
        tab(11, 'Mechanical Keyboard — Best Buy', 'https://www.bestbuy.com/site/searchpage.jsp?st=mechanical+keyboard'),
        tab(12, '4K Monitor — Amazon.com', 'https://www.amazon.com/s?k=4k+monitor')
      ]
    }
  ]
};

const readingList: Group = {
  id: nanoid(10),
  name: 'Reading List',
  color: 'rgba(249, 115, 22, 1)',
  updatedAt: Date.now(),
  windows: [
    {
      id: 1003,
      incognito: false,
      focused: false,
      tabs: [
        tab(13, 'The Pragmatic Programmer — Notes', 'https://en.wikipedia.org/wiki/The_Pragmatic_Programmer', STALE_SAVED_AT),
        tab(14, 'A Philosophy of Software Design', 'https://web.stanford.edu/~ouster/cgi-bin/book.php', STALE_SAVED_AT),
        tab(15, 'Building a Second Brain — YouTube', 'https://www.youtube.com/results?search_query=building+a+second+brain', STALE_SAVED_AT),
        tab(16, 'Hacker News', 'https://news.ycombinator.com/', STALE_SAVED_AT),
        tab(17, 'CSS Tricks — A Guide to Flexbox', 'https://css-tricks.com/snippets/css/a-guide-to-flexbox/', STALE_SAVED_AT)
      ]
    }
  ]
};

const nowOpen: Group = {
  id: nanoid(10),
  name: 'Now Open',
  color: 'rgba(128, 128, 128, 1)',
  updatedAt: Date.now(),
  windows: [],
  permanent: true
};

export const demoData: GroupsState = {
  active: { id: nowOpen.id, index: 0 },
  available: [nowOpen, work, research, shopping, readingList]
};
