import type { Group, ExtWindow, Tab } from '@tabmerger/shared'
import { PRESET_COLORS, DEFAULT_GROUP_COLOR, FIRST_GROUP_TITLE } from '@tabmerger/shared'

// ponytail: real popup shows the browser-provided favicon, not a color+initial avatar —
// google's s2 service gives a real-looking favicon from the tab's domain for this static demo
export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
}

export function groupTabCount(group: Group): number {
  return group.windows.reduce((acc, w) => acc + w.tabs.length, 0)
}

let tabIdCounter = 1000
export function nextTabId(): number {
  return tabIdCounter++
}

// ponytail: demo-only id, not a real nanoid — good enough for local React state keys
export function nextGroupId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function tab(title: string, domain: string, urlPath = ''): Tab {
  return { id: nextTabId(), title, url: `https://${domain}${urlPath}`, favIconUrl: undefined }
}

function win(id: number, tabs: Tab[], opts: Partial<ExtWindow> = {}): ExtWindow {
  return { id, tabs, incognito: false, focused: false, starred: false, ...opts }
}

export const INITIAL_GROUPS: Group[] = [
  {
    id: 'now-open',
    name: FIRST_GROUP_TITLE,
    color: DEFAULT_GROUP_COLOR,
    updatedAt: Date.now(),
    permanent: true,
    windows: [
      win(1, [
        tab('Gmail — Inbox', 'mail.google.com'),
        tab('Google Calendar', 'calendar.google.com'),
        tab('Slack — #general', 'app.slack.com'),
        tab('Google Docs — Q3 Roadmap', 'docs.google.com'),
      ]),
    ],
  },
  {
    id: 'work',
    name: 'Work',
    color: PRESET_COLORS[4], // cyan
    updatedAt: Date.now(),
    starred: true,
    windows: [
      win(2, [
        tab('GitHub — Pull Requests', 'github.com', '/pulls'),
        tab('Linear — Project Board', 'linear.app'),
        tab('Notion — Design Docs', 'notion.so'),
        tab('Figma — Dashboard Redesign', 'figma.com'),
        tab('Vercel — Deployments', 'vercel.com'),
      ], { starred: true }),
      win(3, [
        tab('Slack — #eng-standup', 'app.slack.com'),
        tab('Zoom — Daily Standup', 'zoom.us'),
        tab('Confluence — Sprint Notes', 'confluence.atlassian.com'),
      ]),
    ],
  },
  {
    id: 'research',
    name: 'Research',
    color: PRESET_COLORS[6], // indigo
    updatedAt: Date.now(),
    windows: [
      win(4, [
        tab('MDN — CSS Grid Guide', 'developer.mozilla.org'),
        tab('Stack Overflow', 'stackoverflow.com'),
        tab('React Docs — useEffect', 'react.dev'),
        tab('Can I Use — Container Queries', 'caniuse.com'),
        tab('web.dev — Core Web Vitals', 'web.dev'),
        tab('TypeScript Handbook', 'www.typescriptlang.org'),
      ]),
    ],
  },
  {
    id: 'shopping',
    name: 'Shopping',
    color: PRESET_COLORS[8], // pink
    updatedAt: Date.now(),
    windows: [
      win(5, [
        tab('Amazon — Order History', 'amazon.com'),
        tab('REI — Hiking Boots', 'rei.com'),
        tab('Best Buy — Monitors', 'bestbuy.com'),
        tab('Target — Cart', 'target.com'),
      ]),
      win(6, [
        tab('Zillow — Saved Homes', 'zillow.com'),
        tab('Airbnb — Trip to Banff', 'airbnb.com'),
      ]),
    ],
  },
]
