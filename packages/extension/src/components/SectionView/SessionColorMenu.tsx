import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { AUTO_ITEM_COLORS } from '@tabmerger/shared';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu';
import type { Session } from '@/lib/types';
import { autoColorName, sessionDisplayColor } from '@/lib/sessionColor';
import { useUpdateSessionColor } from '@/hooks/useSessions';
import { useEntitlements } from '@/hooks/useEntitlements';
import { announceSectionView } from '@/lib/sectionViewStatus';
import { toast } from '@/lib/toast';

/**
 * "Change color…" in the session view's ⋯ menu: a submenu of the ten palette colours (radio items,
 * the current one checked). Picking one stores it and uploads the session again, encrypted, like
 * any session edit (`useUpdateSessionColor`); the change is announced in the status line.
 */
export function SessionColorMenu({ session }: { session: Session }) {
  const { t } = useTranslation();
  const { cloudSync } = useEntitlements();
  const { mutate: updateColor } = useUpdateSessionColor();
  const current = sessionDisplayColor(session);

  const pick = (color: string) => {
    if (color === current) return;
    updateColor(
      { id: session.id, color, cloudSync },
      {
        onSuccess: () => announceSectionView(t('sidePanel.sessionColor.changed', { name: session.name })),
        onError: () => toast.error(t('sidePanel.sessionColor.failed'))
      }
    );
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-xs">
        <Palette className="me-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {t('sidePanel.sessionColor.change')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="text-xs">
        <DropdownMenuRadioGroup value={current} onValueChange={pick}>
          {AUTO_ITEM_COLORS.map((color) => {
            const key = autoColorName(color);
            return (
              <DropdownMenuRadioItem key={color} value={color} className="text-xs">
                <span aria-hidden className="me-2 h-3 w-3 shrink-0 rounded-full border border-foreground/50" style={{ backgroundColor: color }} />
                {key ? t(`sidePanel.sessionColor.names.${key}`) : color}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
