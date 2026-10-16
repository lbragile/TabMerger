import { useCallback, useEffect, useState } from 'react';
import {
  dismissWebAppHostPatterns,
  getDismissedWebAppHostPatterns,
  getMissingWebAppHostPatterns,
  openWebAppHostAccessPage,
  webAppHostPatterns,
} from '@/lib/webAppHostAccess';

interface WebAppHostAccess {
  /** Ungranted sites the prompt should offer; empty when there is nothing to show. */
  missing: string[];
  /**
   * Opens the site-access tab, which asks Firefox for the missing sites. The popup never asks
   * itself: Firefox shows no permission prompt over an open popup (see `lib/webAppHostAccess.ts`).
   */
  connect: () => Promise<boolean>;
  /** Hides the prompt for the current `missing` sites, remembered across popup opens. */
  dismiss: () => Promise<void>;
}

/**
 * Which trusted web app sites the Firefox web bridge can't run on yet and the user hasn't
 * dismissed the prompt for. Checked when the popup opens and again on every permission change
 * (the user can grant or revoke site access in about:addons while the popup is open). Always
 * empty on Chrome and Edge; see `lib/webAppHostAccess.ts`. A grant made in the site-access tab
 * arrives here through `permissions.onAdded` (or the next popup open) and hides the prompt.
 */
export function useWebAppHostAccess(): WebAppHostAccess {
  const [missing, setMissing] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [ungranted, dismissed] = await Promise.all([getMissingWebAppHostPatterns(), getDismissedWebAppHostPatterns()]);
    // Hidden only while every ungranted site was dismissed; a new one brings the prompt back.
    return ungranted.every((p) => dismissed.includes(p)) ? [] : ungranted;
  }, []);

  useEffect(() => {
    if (webAppHostPatterns().length === 0) return;
    let active = true;
    const recheck = () => {
      void load().then((next) => {
        if (active) setMissing(next);
      });
    };
    recheck();
    const events = chrome.permissions;
    events?.onAdded?.addListener(recheck);
    events?.onRemoved?.addListener(recheck);
    return () => {
      active = false;
      events?.onAdded?.removeListener(recheck);
      events?.onRemoved?.removeListener(recheck);
    };
  }, [load]);

  const connect = useCallback(() => openWebAppHostAccessPage(), []);

  const dismiss = useCallback(async () => {
    const dismissed = missing;
    setMissing([]);
    await dismissWebAppHostPatterns(dismissed);
  }, [missing]);

  return { missing, connect, dismiss };
}
