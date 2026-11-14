import { useEffect, useState, type RefObject } from 'react';

/**
 * Keeps focus in a sidebar section when one of its rows goes away (Restore, Delete): call
 * `prepare(id)` before the action; once that id is no longer in `ids`, focus moves to the row
 * after it, else the one before, else the section's toggle. `cancel()` after a failed action.
 *
 * @param rootRef the section's root element
 * @param ids the row ids as listed, in order
 * @param attr the attribute that carries a row's id on its open button (`data-archived-open`)
 */
export function useFocusAfterRowRemoval(rootRef: RefObject<HTMLElement | null>, ids: readonly string[], attr: string) {
  const [pending, setPending] = useState<{ goneId: string; nextId: string | null } | null>(null);
  const key = ids.join('\n');

  useEffect(() => {
    if (!pending || ids.includes(pending.goneId)) return;
    setPending(null);
    const root = rootRef.current;
    const next = pending.nextId ? root?.querySelector<HTMLElement>(`[${attr}="${CSS.escape(pending.nextId)}"]`) : null;
    (next ?? root?.querySelector<HTMLElement>('[data-sidebar-section-toggle]'))?.focus();
    // `key` stands for `ids` (a new array every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pending, attr, rootRef]);

  return {
    prepare: (goneId: string) => {
      const at = ids.indexOf(goneId);
      setPending({ goneId, nextId: ids[at + 1] ?? ids[at - 1] ?? null });
    },
    cancel: () => setPending(null)
  };
}
