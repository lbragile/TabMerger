import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The look of a sidebar section's small icon buttons (Keep, Restore, Delete, the header action):
 * a 24×24 target (WCAG 2.2 target size) with a visible keyboard focus ring.
 */
export const SIDEBAR_ICON_BUTTON =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

/** The focus ring for other raw buttons in the sidebar sections (the toggle, a row's open button). */
export const SIDEBAR_FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

/**
 * A section row (Auto-saved, Archived, Sessions): the open button, the counts badge and the icon
 * buttons side by side. The row whose contents the main panel shows adds {@link SIDEBAR_ROW_ACTIVE}
 * (its 3px start bar is the item's colour, set inline by each section).
 */
export const SIDEBAR_ROW = 'flex items-center gap-1 px-2 py-1 transition-colors min-w-0 hover:bg-[var(--sidebar-hover-bg)]';
/** The current row: a background clearly stronger than hover (and kept on hover), as the current group row. */
export const SIDEBAR_ROW_ACTIVE = 'bg-[var(--sidebar-current-bg)] hover:bg-[var(--sidebar-current-bg)]';

/**
 * A section row's name: bold (700) and in the full text colour on the one row the main panel shows,
 * regular and muted everywhere else. Bold, not semibold: the popup renders in the platform UI font
 * (Segoe UI on Windows), where 600 at 11px barely differs from 400; every platform UI font ships
 * a real bold, so it is never synthesized.
 */
export function sidebarRowNameClass(active: boolean): string {
  return active ? 'font-bold text-foreground' : 'font-normal text-muted-foreground';
}

/**
 * A section row's detail line (time, description): 10px, muted; on the current row a darker grey,
 * since muted text on the stronger current background drops under 4.5:1.
 */
export function sidebarRowDetailClass(active: boolean): string {
  return cn('text-[0.625rem]', active ? 'text-[var(--sidebar-text-inactive)]' : 'text-muted-foreground');
}

/**
 * Shared shell for the Auto-saved / Archived / Sessions sidebar sections (an accordion: the parent
 * passes `open` from `uiStore.openSidebarSection`, so expanding one collapses the others): a disclosure header row
 * (chevron + label + count), an optional right-aligned action button as a SIBLING of the
 * toggle (never nested — nested interactive elements are invalid HTML and break both a11y
 * and click handling), and a collapsible body that shows `emptyLabel` when there is
 * nothing to list. Every section always renders — only the body is gated on `open`. The open
 * section's label is bold (collapsed ones regular), so the expanded one stands out. The toggle
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
  /** Shown in the body when there is nothing to list (text, or text with a link button). */
  emptyLabel: React.ReactNode;
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
          {/* the expanded section's label is bold, the collapsed ones regular (same colour tokens) */}
          <span className={cn('truncate uppercase', open ? 'font-bold' : 'font-normal')}>{t('sidePanel.sectionLabel', { label, count })}</span>
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
