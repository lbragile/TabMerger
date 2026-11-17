import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Group } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { RECENTLY_CLOSED_SECTION_ATTR, SIDEBAR_SECTION } from '@/lib/sidebarSections';
import { openPricingPage } from '@/lib/pricingLink';
import { useRecentlyClosed } from '@/hooks/useRecentlyClosed';
import { useRecentlyClosedActions } from '@/hooks/useRecentlyClosedActions';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useFocusAfterRowRemoval } from '@/hooks/useFocusAfterRowRemoval';
import { limitsForPlan, readRememberClosedTabs } from '@/lib/recentlyClosed';
import { recentlyClosedPlanNote, type RecentlyClosedDay } from '@/lib/recentlyClosedDays';
import { trackEvent } from '@/lib/analytics';
import {
  SIDEBAR_FOCUS_RING,
  SIDEBAR_ICON_BUTTON,
  SIDEBAR_ROW,
  SIDEBAR_ROW_ACTIVE,
  SidebarSection,
  sidebarRowDetailClass,
  sidebarRowNameClass
} from './SidebarSection';

/** "7 tabs · 1 window" (the window part only when there is one). */
export function useDayDetail(): (day: RecentlyClosedDay) => string {
  const { t } = useTranslation();
  return (day) => {
    const tabs = t('common.tabCount', { count: day.allTabCount });
    return day.windowCount > 0 ? t('recentlyClosed.section.dayDetail', { tabs, windows: t('common.windowCount', { count: day.windowCount }) }) : tabs;
  };
}

/**
 * The "Recently closed" sidebar section, first in the bottom stack and open when the popup opens:
 * one row per local day, newest first (Today, Yesterday, "Wed, Nov 11"). A row's name opens the
 * day in the main panel (`mainView` `closedDay`) and is the current row while it shows; its Remove
 * button (a sibling, never nested) removes the whole day with an Undo toast. The header counts the
 * day rows and reads "(off)" while remembering is off; the body then links to Settings → Data.
 * On Free a quiet line after the last day says how long each plan keeps them.
 */
export function RecentlyClosedSection({ groups }: { groups: readonly Group[] }) {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.openSidebarSection === SIDEBAR_SECTION.recentlyClosed);
  const toggle = useUIStore((s) => s.toggleSidebarSection);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const viewedDay = useUIStore((s) => (s.mainView?.kind === 'closedDay' ? s.mainView.day : null));
  const openMainView = useUIStore((s) => s.openMainView);
  const openModal = useUIStore((s) => s.openModal);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const { data: settings } = useAppSettings();
  const { tier, loading: planLoading } = useEntitlements();
  const { days } = useRecentlyClosed();
  const { removeDay } = useRecentlyClosedActions();
  const dayDetail = useDayDetail();
  const rootRef = useRef<HTMLDivElement>(null);
  const focus = useFocusAfterRowRemoval(rootRef, days.map((d) => d.key), 'data-closed-day-open');

  const on = readRememberClosedTabs(settings);
  const free = !planLoading && tier === 'free';
  const keptDays = limitsForPlan(free ? 'free' : 'pro').days;

  const show = (day: RecentlyClosedDay) => {
    if (selectionMode) return;
    trackEvent('recently_closed_opened');
    openMainView({ kind: 'closedDay', day: day.key }, groups[activeGroupIndex]?.id ?? null);
  };

  const remove = async (day: RecentlyClosedDay) => {
    focus.prepare(day.key);
    if (!(await removeDay(day))) focus.cancel();
  };

  const emptyLabel = on ? (
    t('recentlyClosed.section.empty', { count: keptDays })
  ) : (
    <>
      {t('recentlyClosed.section.offBody')}{' '}
      <Button variant="link" size="sm" className="inline h-auto whitespace-normal p-0 text-start align-baseline text-[11px]" onClick={() => openModal('settings', { tab: 'data' })}>
        {t('recentlyClosed.section.turnOn')}
      </Button>
    </>
  );

  return (
    <div ref={rootRef} {...{ [RECENTLY_CLOSED_SECTION_ATTR]: '' }}>
      <SidebarSection
        label={t('recentlyClosed.section.title')}
        count={on ? days.length : t('recentlyClosed.section.offCount')}
        open={open}
        onToggle={() => toggle(SIDEBAR_SECTION.recentlyClosed)}
        isEmpty={!on || days.length === 0}
        emptyLabel={emptyLabel}
        className="mt-1.5"
      >
        <ul data-testid="recently-closed-days">
          {days.map((day) => {
            const active = day.key === viewedDay;
            const detailId = `closed-day-detail-${day.key}`;
            return (
              <li key={day.key} className={cn(SIDEBAR_ROW, active && SIDEBAR_ROW_ACTIVE)} style={{ borderInlineStart: `3px solid ${day.color}` }}>
                <button
                  type="button"
                  className={cn('flex-1 min-w-0 text-start', SIDEBAR_FOCUS_RING)}
                  aria-label={t('recentlyClosed.section.showDay', { context: day.kind, day: day.label })}
                  aria-describedby={detailId}
                  aria-current={active ? 'page' : undefined}
                  aria-disabled={selectionMode || undefined}
                  data-closed-day-open={day.key}
                  onClick={() => show(day)}
                >
                  <span className={cn('block truncate text-[11px]', sidebarRowNameClass(active))}>{day.label}</span>
                  <span id={detailId} className={cn('block truncate', sidebarRowDetailClass(active))}>{dayDetail(day)}</span>
                </button>
                <span
                  aria-hidden
                  className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-none shrink-0 whitespace-nowrap"
                  style={{ background: 'var(--sidebar-badge-bg)', color: 'var(--sidebar-text-muted)' }}
                >
                  {day.entries.length}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(SIDEBAR_ICON_BUTTON, 'hover:text-destructive')}
                      onClick={() => void remove(day)}
                      aria-label={t('recentlyClosed.section.removeDay', { context: day.kind, day: day.label })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('recentlyClosed.section.removeDayTooltip')}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
        {free && (
          <p className="px-2 py-1 text-[10px] text-muted-foreground" data-testid="recently-closed-free-note">
            {recentlyClosedPlanNote()}{' '}
            <Button variant="link" size="sm" className="inline h-auto whitespace-normal p-0 text-start align-baseline text-[10px]" onClick={() => openPricingPage('recently_closed_sidebar')}>
              {t('recentlyClosed.section.seePro')}
            </Button>
          </p>
        )}
      </SidebarSection>
    </div>
  );
}
