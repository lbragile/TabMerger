import { useUIStore } from '@/stores/uiStore';
import type { Group } from '@/lib/types';

/**
 * Single place that resolves a group's DISPLAY colour: the live Custom colour-picker preview
 * (`uiStore.previewGroupColor`) when one is in progress for this group, otherwise the group's
 * real committed `color`. Every render site that shows a group's colour (sidebar dot, main
 * panel accents, star fill, etc.) should read through this hook rather than `group.color`
 * directly, so the picker's drag/typing preview shows up everywhere at once without persisting
 * anything until Apply.
 */
export function useGroupDisplayColor(group: Pick<Group, 'id' | 'color'>): string {
  const preview = useUIStore((s) => s.previewGroupColor);
  return preview && preview.groupId === group.id ? preview.color : group.color;
}
