import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDndAuxHost } from '@/lib/dndGhostHost';
import type { Group } from '@/lib/types';
import { useTourSearchShowsDemo } from '@/hooks/useTourSearchShowsDemo';
import { useSearchFilters } from '@/hooks/useSearchView';
import { isSearchActive, searchResultMessage, summarizeSearch } from '@/lib/searchMatch';

/** Long enough that a word being typed is announced once, not once per letter. */
export const SEARCH_ANNOUNCE_DELAY_MS = 500;

/**
 * Always-mounted polite live region for search results: "5 tabs match in 2 groups", or
 * "No tabs match". Says nothing while there is no query. The count covers every searchable
 * group, not only the one on screen. Rendered into the body-level aux host (`getDndAuxHost`).
 */
export function SearchAnnouncer({ groups }: { groups: Group[] }) {
  const filters = useSearchFilters();
  // Which groups search leaves out follows the guided tour's step: recount when it changes.
  const searchShowsDemo = useTourSearchShowsDemo();
  const text = useMemo(
    () => (isSearchActive(filters) ? searchResultMessage(summarizeSearch(groups, filters)) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, filters, searchShowsDemo]
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!text) {
      setMessage('');
      return;
    }
    const id = setTimeout(() => setMessage(text), SEARCH_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [text]);

  const region = (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="search-announcer">
      {message}
    </div>
  );
  // Drawn outside the app root: the guided tour makes that root inert during its steps, which
  // would silence the count on exactly the steps that teach search
  const host = getDndAuxHost();
  return host ? createPortal(region, host) : region;
}
