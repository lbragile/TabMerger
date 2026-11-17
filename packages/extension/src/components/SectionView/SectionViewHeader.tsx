import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, MoreHorizontal, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCloseOnOverlayDismiss } from '@/hooks/useCloseOnOverlayDismiss';
import { SeparatedText } from './SeparatedText';

interface SectionViewHeaderProps {
  /** The group colour dot before the title; none when omitted. */
  color?: string;
  title: string;
  /** One line under the title, e.g. "Archived ◆ 1 Window ◆ 6 Tabs" (the ◆ are hidden from screen readers). */
  meta: string;
  /** An optional second line (a session's description). */
  description?: string;
  /** The primary action button; none when omitted (a recently-closed day). */
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  /** Items of the ⋯ menu before Delete (`DropdownMenuItem`s, submenus). */
  menuItems?: ReactNode;
  /** The ⋯ menu's Delete item; none when omitted. */
  deleteLabel?: string;
  onDelete?: () => void;
  /** ✕: back to the group view. */
  onClose: () => void;
  /** The read-only note under the header; none when omitted. */
  banner?: string;
}

/** Marks a view's title (h2): focusable from code, where focus goes when the view's list empties. */
export const SECTION_VIEW_TITLE_ATTR = 'data-section-view-title';

/**
 * The header of a read-only main-panel view (an archived group, a saved session, a recently-closed
 * day): title (h2), a meta line, the primary action, a ⋯ menu (the view's own items, then Delete),
 * ✕ to go back to the group shown before, and a banner saying what the view is and that it is
 * read-only. Each part but the title, meta line and ✕ is optional.
 */
export function SectionViewHeader({ color, title, meta, description, primaryLabel, onPrimary, primaryDisabled, menuItems, deleteLabel, onDelete, onClose, banner }: SectionViewHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // A multi-select starting in the sidebar closes the menu, like every other overlay
  useCloseOnOverlayDismiss(() => setMenuOpen(false));
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        {color && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
        <div className="min-w-0 flex-1">
          <h2 dir="auto" tabIndex={-1} {...{ [SECTION_VIEW_TITLE_ATTR]: '' }} className="truncate text-sm font-semibold text-ui-start focus-visible:outline-none" title={title}>{title}</h2>
          <p className="truncate text-[11px] text-muted-foreground"><SeparatedText text={meta} /></p>
          {description && (
            <p dir="auto" className="truncate text-[11px] italic text-muted-foreground text-ui-start" title={description}>{description}</p>
          )}
        </div>
        {primaryLabel && (
          <Button size="sm" className="h-7 shrink-0 rounded-none px-3 text-xs" onClick={onPrimary} disabled={primaryDisabled}>
            {primaryLabel}
          </Button>
        )}
        {(menuItems || onDelete) && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button ref={menuButton} variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded-none" aria-label={t('sidePanel.view.moreOptions', { name: title })}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="text-xs"
            // the shared menu never moves focus on close: back to ⋯ while the view is there (a
            // Delete that closes the view leaves focus to MainPanel, which returns it to the opener)
            onCloseAutoFocus={() => {
              if (menuButton.current?.isConnected) menuButton.current.focus();
            }}
          >
            {menuItems}
            {onDelete && (
              <DropdownMenuItem className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive" onClick={onDelete}>
                <Trash2 className="me-2 h-3.5 w-3.5 shrink-0" />
                {deleteLabel}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded-none" onClick={onClose} aria-label={t('sidePanel.view.close')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sidePanel.view.close')}</TooltipContent>
        </Tooltip>
      </div>
      {banner && (
        <p role="note" className="flex items-start gap-1.5 border-t border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <Info aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0">{banner}</span>
        </p>
      )}
    </div>
  );
}
