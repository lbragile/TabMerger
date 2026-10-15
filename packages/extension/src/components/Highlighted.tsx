import type { ReactNode } from 'react';
import { matchRanges, type MatchRange } from '@/lib/searchMatch';

/**
 * The look of a search match: dark text on yellow in both themes (about 17:1 on the light
 * yellow, 14:1 on the dark-theme one), and semibold so the match does not rely on colour alone.
 * No padding or margin: marking text must not move it, or a truncated row would re-flow.
 */
export const SEARCH_MARK_CLASS = 'rounded-[0.125rem] bg-yellow-200 font-semibold text-neutral-950 dark:bg-yellow-300';

interface HighlightedProps {
  text: string;
  /** What the user searched for. Compared as plain text (never as a pattern) by `matchRanges`. */
  query?: string;
  /** Ranges worked out by the caller (e.g. for a shortened snippet); wins over `query`. */
  ranges?: MatchRange[];
}

/**
 * `text` with the characters a search matched wrapped in `<mark>`. Inline only: the parent's
 * `truncate` keeps working, and a screen reader reads the text once, as ordinary text. The
 * pieces are React text nodes, so nothing in `text` or `query` is ever treated as markup.
 */
export function Highlighted({ text, query, ranges }: HighlightedProps) {
  const runs = ranges ?? matchRanges(text, query ?? '');
  if (runs.length === 0) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  runs.forEach(([from, to], i) => {
    const start = Math.max(at, Math.min(from, text.length));
    const end = Math.max(start, Math.min(to, text.length));
    if (end === start) return;
    if (start > at) out.push(text.slice(at, start));
    out.push(
      <mark key={i} className={SEARCH_MARK_CLASS} data-search-mark="">
        {text.slice(start, end)}
      </mark>
    );
    at = end;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
