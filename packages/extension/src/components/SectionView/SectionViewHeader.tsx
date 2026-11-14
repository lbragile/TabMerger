import { useState } from 'react';
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
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** The ⋯ menu's Delete item. */
  deleteLabel: string;
  onDelete: () => void;
  /** ✕: back to the group view. */
  onClose: () => void;
  /** The read-only note under the header. */
  banner: string;
}

/**
 * The header of a read-only main-panel view (an archived group, a saved session): title (h2), a
 * meta line, the primary action, a ⋯ menu with Delete, ✕ to go back to the group shown before, and
 * a banner saying what the view is and that it is read-only.
 */
export function SectionViewHeader({ color, title, meta, description, primaryLabel, onPrimary, primaryDisabled, deleteLabel, onDelete, onClose, banner }: SectionViewHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  // A multi-select starting in the sidebar closes the menu, like every other overlay
  useCloseOnOverlayDismiss(() => setMenuOpen(false));
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        {color && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
        <div className="min-w-0 flex-1">
          <h2 dir="auto" className="truncate text-sm font-semibold text-ui-start" title={title}>{title}</h2>
          <p className="truncate text-[11px] text-muted-foreground"><SeparatedText text={meta} /></p>
          {description && (
            <p dir="auto" className="truncate text-[11px] italic text-muted-foreground text-ui-start" title={description}>{description}</p>
          )}
        </div>
        <Button size="sm" className="h-7 shrink-0 rounded-none px-3 text-xs" onClick={onPrimary} disabled={primaryDisabled}>
          {primaryLabel}
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded-none" aria-label={t('sidePanel.view.moreOptions', { name: title })}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive" onClick={onDelete}>
              <Trash2 className="me-2 h-3.5 w-3.5 shrink-0" />
              {deleteLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded-none" onClick={onClose} aria-label={t('sidePanel.view.close')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sidePanel.view.close')}</TooltipContent>
        </Tooltip>
      </div>
      <p role="note" className="flex items-start gap-1.5 border-t border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Info aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
        <span className="min-w-0">{banner}</span>
      </p>
    </div>
  );
}
