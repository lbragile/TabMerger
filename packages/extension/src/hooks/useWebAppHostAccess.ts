import { useCallback, useEffect, useState } from 'react';
import {
  dismissWebAppHostPatterns,
  getDismissedWebAppHostPatterns,
  getMissingWebAppHostPatterns,
  requestWebAppHostAccess,
  webAppHostPatterns,
} from '@/lib/webAppHostAccess';

interface WebAppHostAccess {
  /** Ungranted sites the prompt should offer; empty when there is nothing to show. */
  missing: string[];
  /** Asks Firefox for `missing`. Call straight from the click: the request needs the user action. */
  connect: () => Promise<boolean>;
  /** Hides the prompt for the current `missing` sites, remembered across popup opens. */
  dismiss: () => Promise<void>;
}

/**
 * Which trusted web app sites the Firefox web bridge can't run on yet and the user hasn't
 * dismissed the prompt for. Checked when the popup opens and again on every permission change
 * (the user can grant or revoke site access in about:addons while the popup is open). Always
 * empty on Chrome and Edge; see `lib/webAppHostAccess.ts`.
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

  const connect = useCallback(() => {
    // No await before this call: Firefox only honours permissions.request() inside the click.
    return requestWebAppHostAccess(missing).then(async (granted) => {
      if (granted) setMissing(await load());
      return granted;
    });
  }, [missing, load]);

  const dismiss = useCallback(async () => {
    const dismissed = missing;
    setMissing([]);
    await dismissWebAppHostPatterns(dismissed);
  }, [missing]);

  return { missing, connect, dismiss };
}
