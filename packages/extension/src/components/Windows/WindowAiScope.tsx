import { createContext, useContext, useLayoutEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useNameAction } from '@/hooks/useNameGroupAction';
import { useDescribeAction } from '@/hooks/useDescribeGroupAction';
import { windowSubject, type AiSubject } from '@/lib/aiTarget';
import type { Group, Window } from '@/lib/types';

/** The AI items of a window's ⋯ menu: which ones show, and what they run. */
export interface WindowAiMenu {
  /** "AI rename" shows (Settings → AI "Name groups and windows" on) */
  showName: boolean;
  /** "Describe with AI" shows (Settings → AI "Describe groups and windows" on) */
  showDescribe: boolean;
  name: (group: Group | undefined, windowIndex: number, window: Window) => void;
  describe: (group: Group | undefined, windowIndex: number, window: Window) => void;
}

const WindowAiContext = createContext<WindowAiMenu | null>(null);

/**
 * The window AI items for a window row, or `null` when none show: no AI for this plan (Free, Pro,
 * a Pro AI option that isn't live in this build: `aiFeatures` is false, the same rule as the group
 * context menu, which hides its AI items too), both per-feature switches off, or outside a
 * `WindowAiScope` (a row rendered on its own). The row still hides them for Now Open.
 */
export function useWindowAiMenu(): WindowAiMenu | null {
  return useContext(WindowAiContext);
}

interface Runners {
  name: (subject: AiSubject | undefined) => Promise<void>;
  describe: (subject: AiSubject | undefined) => Promise<void>;
}

/** Holds the AI request hooks; mounted only while a window AI item can show. */
function WindowAiHost({ runners }: { runners: MutableRefObject<Runners | null> }) {
  const { run: name } = useNameAction();
  const { run: describe } = useDescribeAction();
  // The latest closures, for clicks; no state, so this never re-renders anything
  useLayoutEffect(() => {
    runners.current = { name, describe };
  });
  useLayoutEffect(() => () => { runners.current = null; }, [runners]);
  return null;
}

/**
 * Gives the window rows of the windows panel their AI items ("AI rename", "Describe with AI").
 * ONE set of AI hooks for the whole panel instead of one per window row (each AI hook reads the
 * session, plan, settings and usage), and none at all unless an item can show: Free and Pro users
 * get no AI hooks here. The host is a sibling of the rows, so turning it on or off never remounts
 * them. A request keeps running if the host goes away meanwhile (the menu items only start it).
 */
export function WindowAiScope({ children }: { children: ReactNode }) {
  const { aiFeatures } = useEntitlements();
  const { data: appSettings } = useAppSettings();
  const showName = appSettings?.aiNameGroupEnabled !== false;
  const showDescribe = appSettings?.aiDescribeGroupEnabled !== false;
  const enabled = !!aiFeatures && (showName || showDescribe);
  const runners = useRef<Runners | null>(null);

  const value = useMemo<WindowAiMenu | null>(
    () =>
      enabled
        ? {
            showName,
            showDescribe,
            name: (group, windowIndex, window) => void runners.current?.name(windowSubject(group, windowIndex, window)),
            describe: (group, windowIndex, window) => void runners.current?.describe(windowSubject(group, windowIndex, window))
          }
        : null,
    [enabled, showName, showDescribe]
  );

  return (
    <>
      {enabled && <WindowAiHost runners={runners} />}
      <WindowAiContext.Provider value={value}>{children}</WindowAiContext.Provider>
    </>
  );
}
