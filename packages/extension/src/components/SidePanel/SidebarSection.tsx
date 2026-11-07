import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Shared shell for the Auto-saved / Archived / Sessions sidebar sections: a disclosure header row
 * (chevron + label + count), an optional right-aligned action button as a SIBLING of the
 * toggle (never nested — nested interactive elements are invalid HTML and break both a11y
 * and click handling), and a collapsible body that shows `emptyLabel` when there is
 * nothing to list. Both sections always render — only the body is gated on `open`.
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
  return (
    <div className={className} data-tour={tourAnchor}>
      <div className="flex items-center gap-1 pe-1">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 min-w-0 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors select-none"
          onClick={onToggle}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0 rtl:-scale-x-100" />}
          <span className="truncate">{t('sidePanel.sectionLabel', { label, count })}</span>
        </button>
        {action}
      </div>
      {open && (
        isEmpty ? (
          <p className="mt-0.5 px-2 py-1.5 text-[11px] text-muted-foreground/60">{emptyLabel}</p>
        ) : (
          <div className="mt-0.5 max-h-28 overflow-y-auto">{children}</div>
        )
      )}
    </div>
  );
}
