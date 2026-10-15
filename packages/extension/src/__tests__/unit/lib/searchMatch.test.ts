import { describe, it, expect } from 'vitest';
import {
  MATCH_RANK,
  bestRank,
  groupSearchState,
  matchRank,
  matchRanges,
  searchResultMessage,
  snippetAroundMatch,
  sortByRank,
  textMatches,
  urlPrefixLength
} from '@/lib/searchMatch';
import { parseSearchQuery } from '@/lib/utils';
import type { Group } from '@/lib/types';

describe('matchRanges', () => {
  it('returns one run for a contiguous match, ignoring case', () => {
    expect(matchRanges('Jira Board - Sprint 12', 'board')).toEqual([[5, 10]]);
  });

  it('prefers the contiguous match over an earlier scattered one', () => {
    // "ab" also matches as a subsequence from index 0 ("a...b"), but "ab" exists whole at 4.
    expect(matchRanges('a-x-ab', 'ab')).toEqual([[4, 6]]);
  });

  it('never matches letters picked out one by one: only the text as typed, in sequence', () => {
    expect(matchRanges('GitHub Pull Requests', 'ghpr')).toEqual([]);
    expect(matchRanges('abcXd', 'abd')).toEqual([]);
    expect(matchRanges('Jira', 'jra')).toEqual([]);
    expect(matchRanges('Jira', 'jir')).toEqual([[0, 3]]);
  });

  it('ignores case in both the text and the query', () => {
    expect(matchRanges('JIRA board', 'jira')).toEqual([[0, 4]]);
    expect(matchRanges('jira board', 'JIRA')).toEqual([[0, 4]]);
  });

  it('trims the query, and a whitespace-only query matches nothing to mark', () => {
    expect(matchRanges('Open Jira', '  jir ')).toEqual([[5, 8]]);
    expect(matchRanges('Open Jira', '   ')).toEqual([]);
  });

  it('matches a multi-word query only as that contiguous string', () => {
    expect(matchRanges('foo bar baz', 'foo bar')).toEqual([[0, 7]]);
    expect(matchRanges('bar foo', 'foo bar')).toEqual([]);
    expect(matchRanges('foo x bar', 'foo bar')).toEqual([]);
    expect(matchRanges('foobar', 'foo bar')).toEqual([]);
  });

  it('returns nothing for an empty query, empty text or no match', () => {
    expect(matchRanges('anything', '')).toEqual([]);
    expect(matchRanges('', 'a')).toEqual([]);
    expect(matchRanges(undefined, 'a')).toEqual([]);
    expect(matchRanges('abc', 'abd')).toEqual([]);
  });

  it('treats pattern characters in the query as plain text', () => {
    expect(matchRanges('price (USD) [a+b]*', '(usd)')).toEqual([[6, 11]]);
    expect(matchRanges('a.b', '.*')).toEqual([]);
    expect(matchRanges('what? [x]', '?')).toEqual([[4, 5]]);
  });

  it('agrees with textMatches: ranges are non-empty exactly when it matches a non-empty query', () => {
    const texts = ['', 'React docs', 'https://github.com/a/b?q=1', 'ünïcödé tab', 'aaa', 'AbC', 'Jira'];
    const queries = ['', ' ', 'a', 'react', 'rd', 'gh', 'zz', 'ABC', 'aaaa', '?q', 'ö', 'jra', ' jir '];
    for (const text of texts) {
      for (const query of queries) {
        expect(matchRanges(text, query).length > 0, `${text} / ${query}`).toBe(query.trim() !== '' && textMatches(text, query));
      }
    }
  });
});

describe('textMatches', () => {
  it('matches the query as one contiguous run, ignoring case', () => {
    expect(textMatches('Jira', 'jir')).toBe(true);
    expect(textMatches('GitHub', 'HUB')).toBe(true);
    expect(textMatches('Linear — Project Board', 'project b')).toBe(true);
  });

  it('rejects letters that only appear in order with gaps, or out of order', () => {
    expect(textMatches('Jira', 'jra')).toBe(false);
    expect(textMatches('GitHub', 'ghb')).toBe(false);
    expect(textMatches('Linear — Project Board', 'lnear')).toBe(false);
    expect(textMatches('Work', 'Wrok')).toBe(false);
    expect(textMatches('foo x bar', 'foo bar')).toBe(false);
  });

  it('trims the query; an empty or whitespace-only query matches everything', () => {
    expect(textMatches('Jira', '  JIR  ')).toBe(true);
    expect(textMatches('anything', '')).toBe(true);
    expect(textMatches('anything', '   ')).toBe(true);
    expect(textMatches(undefined, '')).toBe(true);
  });

  it('is false for a missing text or a query longer than the text', () => {
    expect(textMatches(undefined, 'a')).toBe(false);
    expect(textMatches('', 'a')).toBe(false);
    expect(textMatches('hi', 'hello')).toBe(false);
  });
});

describe('matchRank', () => {
  it('ranks exact, then prefix, then word start, then anywhere', () => {
    expect(matchRank('Jira', 'JIRA')).toBe(MATCH_RANK.EXACT);
    expect(matchRank('Jira board', 'jir')).toBe(MATCH_RANK.PREFIX);
    expect(matchRank('Open Jira', 'jir')).toBe(MATCH_RANK.WORD_START);
    expect(matchRank('https://x.com/jira', 'jira')).toBe(MATCH_RANK.WORD_START);
    expect(matchRank('Ninja', 'nja')).toBe(MATCH_RANK.ANYWHERE);
  });

  it('finds a word-start occurrence after an earlier mid-word one', () => {
    expect(matchRank('subsearch search', 'search')).toBe(MATCH_RANK.WORD_START);
  });

  it('is NONE for no match, a scattered match or an empty query', () => {
    expect(matchRank('Jira', 'jra')).toBe(MATCH_RANK.NONE);
    expect(matchRank('Jira', '  ')).toBe(MATCH_RANK.NONE);
    expect(matchRank(undefined, 'a')).toBe(MATCH_RANK.NONE);
  });

  it('bestRank picks the lowest; sortByRank is stable within a rank', () => {
    expect(bestRank(MATCH_RANK.ANYWHERE, MATCH_RANK.PREFIX)).toBe(MATCH_RANK.PREFIX);
    expect(bestRank()).toBe(MATCH_RANK.NONE);
    const names = ['xjira', 'Jira b', 'a jira', 'Jira a', 'jira', 'yjira'];
    expect(sortByRank(names, (n) => matchRank(n, 'jira'))).toEqual(['jira', 'Jira b', 'Jira a', 'a jira', 'xjira', 'yjira']);
  });
});

describe('snippetAroundMatch', () => {
  it('leaves a text alone when the match is near the start', () => {
    expect(snippetAroundMatch('short title', [[6, 11]])).toEqual({ text: 'short title', ranges: [[6, 11]] });
  });

  it('cuts the start so a late match is visible, and moves the ranges', () => {
    const text = `${'x'.repeat(40)}needle tail`;
    const out = snippetAroundMatch(text, [[40, 46]], { maxLead: 20, keep: 5 });
    expect(out.text).toBe('…xxxxxneedle tail');
    expect(out.text.slice(out.ranges[0][0], out.ranges[0][1])).toBe('needle');
  });

  it('drops a URL scheme and www when the match is after them', () => {
    const url = 'https://www.example.com/docs';
    const out = snippetAroundMatch(url, matchRanges(url, 'docs'), { skip: urlPrefixLength(url) });
    expect(out.text).toBe('example.com/docs');
    expect(out.text.slice(out.ranges[0][0], out.ranges[0][1])).toBe('docs');
  });
});

describe('groupSearchState', () => {
  const tab = (title: string, url: string, tag?: string) => ({ id: 0, title, url, favIconUrl: '', pinned: false, ...(tag ? { chromeGroup: { id: 1, name: tag, color: 'blue' } } : {}) });
  const group = {
    id: 'g1', name: 'Work', color: 'rgba(0,0,0,1)', updatedAt: 0,
    windows: [
      { id: 1, name: 'Morning', incognito: false, focused: false, starred: false, tabs: [tab('Jira Board', 'https://jira.example.com'), tab('Confluence', 'https://wiki.example.com/react')] },
      { id: 2, name: 'Evening', incognito: false, focused: false, starred: false, tabs: [tab('News', 'https://news.example.com', 'reading')] }
    ]
  } as unknown as Group;

  it('keeps every flag at the real index of its tab and window', () => {
    const state = groupSearchState(group, parseSearchQuery('react'));
    expect(state.windows.map((w) => w.tabMatches)).toEqual([[false, true], [false]]);
    expect(state.windows.map((w) => w.visible)).toEqual([true, false]);
    expect(state.matchCount).toBe(1);
    expect(state.tabCount).toBe(3);
  });

  it('keeps a window that itself matched a window: filter, and only that one', () => {
    const state = groupSearchState(group, parseSearchQuery('window:even'));
    expect(state.windows.map((w) => w.visible)).toEqual([false, true]);
    expect(state.windows[1].selfMatch).toBe(true);
  });

  it('applies tag: and group: filters', () => {
    expect(groupSearchState(group, parseSearchQuery('tag:read')).matchCount).toBe(1);
    expect(groupSearchState(group, parseSearchQuery('group:zzz')).visible).toBe(false);
    expect(groupSearchState(group, parseSearchQuery('group:work')).nameMatch).toBe(true);
  });
});

describe('searchResultMessage', () => {
  it('words the live-region line', () => {
    expect(searchResultMessage({ matchingTabs: 5, groupsWithMatches: 2 })).toBe('5 tabs match in 2 groups');
    expect(searchResultMessage({ matchingTabs: 1, groupsWithMatches: 1 })).toBe('1 tab matches in 1 group');
    expect(searchResultMessage({ matchingTabs: 0, groupsWithMatches: 0 })).toBe('No tabs match');
  });
});
