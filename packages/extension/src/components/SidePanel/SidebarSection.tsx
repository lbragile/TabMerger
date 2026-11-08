import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * The look of a sidebar section's small icon buttons (Keep, Restore, Delete, the header action):
 * a 24×24 target (WCAG 2.2 target size) with a visible keyboard focus ring.
 */
export const SIDEBAR_ICON_BUTTON =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

/** The focus ring for other raw buttons in the sidebar sections (the toggle, a row's open button). */
export const SIDEBAR_FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

/**
 * Shared shell for the Auto-saved / Archived / Sessions sidebar sections: a disclosure header row
 * (chevron + label + count), an optional right-aligned action button as a SIBLING of the
 * toggle (never nested — nested interactive elements are invalid HTML and break both a11y
 * and click handling), and a collapsible body that shows `emptyLabel` when there is
 * nothing to list. Every section always renders — only the body is gated on `open`. The toggle
 * says what it controls (`aria-controls`, while the body exists). The label is shown in capitals by
 * CSS, so screen readers read the words, not letters.
 */
export function SidebarSection({
  label,
  count,
  open,
  onToggle,
  isEmpty,
  emptyLabel,
  action,
  className,
  tourAnchor,
  children,
}: {
  label: string;
  /** a number, or a ready-made count such as "2 of 2" */
  count: number | string;
  open: boolean;
  onToggle: () => void;
  isEmpty: boolean;
  emptyLabel: string;
  action?: React.ReactNode;
  className?: string;
  /** Guided-tour anchor name (`data-tour`), see lib/tourSteps.ts. */
  tourAnchor?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const bodyId = useId();
  return (
    <div className={className} data-tour={tourAnchor}>
      <div className="flex items-center gap-1 pe-1">
        <button
          type="button"
          className={`flex items-center gap-1 flex-1 min-w-0 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors select-none ${SIDEBAR_FOCUS_RING}`}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          data-sidebar-section-toggle=""
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0 rtl:-scale-x-100" />}
          <span className="truncate uppercase">{t('sidePanel.sectionLabel', { label, count })}</span>
        </button>
        {action}
      </div>
      {open && (
        isEmpty ? (
          <p id={bodyId} className="mt-0.5 px-2 py-1.5 text-[11px] text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div id={bodyId} className="mt-0.5 max-h-28 overflow-y-auto">{children}</div>
        )
      )}
    </div>
  );
}
