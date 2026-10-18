import { useEffect, useRef, useState } from 'react';
import { useUIStore, type SelectedItem } from '@/stores/uiStore';
import { consumeDropSelectionRemap } from '@/lib/dndAnnouncements';
import { t } from '@/lib/i18n';

const EMPTY: readonly SelectedItem[] = [];

/**
 * What a selection change should tell a screen-reader user, or `null` for nothing.
 *  - cleared → "Selection cleared."
 *  - the same items re-pointed by a drop (`afterDrop`) → nothing: the assertive drop
 *    outcome already says "They're still selected.", and two regions would talk over
 *    each other
 *  - anything else (toggle, range, Ctrl+A) → "3 tabs selected."
 */
export function selectionMessage(
  prev: readonly SelectedItem[],
  next: readonly SelectedItem[],
  afterDrop = false
): string | null {
  if (prev === next) return null;
  if (next.length === 0) return prev.length > 0 ? t('selection.cleared') : null;
  const type = next[0].type;
  if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id)) return null;
  if (afterDrop && prev.length === next.length && prev[0]?.type === type) return null;
  return t('selection.sentence', { text: t('selection.selected', { count: next.length, context: type }) });
}

/**
 * Always-mounted polite live region for selection changes. Lives OUTSIDE `<DndProvider>`
 * and never mounts/unmounts, so it can't disturb a native drag's ancestor chain (spec C4).
 */
export function SelectionAnnouncer() {
  const selectedItems = useUIStore((s) => s.selectedItems) ?? EMPTY;
  const prev = useRef<readonly SelectedItem[]>(selectedItems);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const text = selectionMessage(prev.current, selectedItems, consumeDropSelectionRemap(selectedItems));
    prev.current = selectedItems;
    // A trailing no-break space toggles so an identical message is still re-announced.
    if (text) setMessage((m) => (m === text ? `${text} ` : text));
  }, [selectedItems]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="selection-announcer">
      {message}
    </div>
  );
}
