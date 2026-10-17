import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2 } from 'lucide-react';
import logoUrl from '@/assets/logo.png';
import { Button } from '@/components/ui/button';
import { getMissingWebAppHostPatterns, hostOfPattern, requestWebAppHostAccess } from '@/lib/webAppHostAccess';

type Status = 'loading' | 'needed' | 'requesting' | 'refused' | 'granted';

/** How long the success message shows before the tab closes itself. */
export const SITE_ACCESS_CLOSE_DELAY_MS = 1500;

const SUCCESS = 'Done — the website can now find TabMerger. You can close this tab.';
const REFUSED = "Firefox didn't allow it. You can try again, or allow it later in about:addons.";

/**
 * Firefox only (`entrypoints/site-access/`): asks Firefox to let TabMerger run on the trusted
 * website addresses it hasn't granted. The popup's banner opens this tab because Firefox shows
 * no permission prompt over an open popup (see `lib/webAppHostAccess.ts`).
 *
 * Works out the missing sites itself and only ever requests the build's own trusted patterns;
 * nothing is read from the URL. A grant made anywhere (this button, about:addons) arrives through
 * `permissions.onAdded` and shows the success state; the tab then tries to close itself and keeps
 * the message if the browser doesn't allow it.
 */
export function SiteAccessPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [missing, setMissing] = useState<string[]>([]);
  // Close only after access was gained while this tab was open, not when it opened already done.
  const sawMissing = useRef(false);

  const recheck = useCallback(async (afterRefusal = false) => {
    const next = await getMissingWebAppHostPatterns();
    setMissing(next);
    if (next.length > 0) sawMissing.current = true;
    setStatus(next.length === 0 ? 'granted' : afterRefusal ? 'refused' : 'needed');
  }, []);

  useEffect(() => {
    let active = true;
    const onChange = () => {
      void getMissingWebAppHostPatterns().then((next) => {
        if (!active) return;
        setMissing(next);
        if (next.length > 0) sawMissing.current = true;
        // A change elsewhere never overrides an open Firefox prompt or a shown refusal.
        setStatus((prev) => (next.length === 0 ? 'granted' : prev === 'loading' || prev === 'granted' ? 'needed' : prev));
      });
    };
    onChange();
    const events = chrome.permissions;
    events?.onAdded?.addListener(onChange);
    events?.onRemoved?.addListener(onChange);
    return () => {
      active = false;
      events?.onAdded?.removeListener(onChange);
      events?.onRemoved?.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    if (status !== 'granted' || !sawMissing.current) return;
    const timer = setTimeout(() => {
      try {
        window.close();
      } catch {
        // Not closable; the success message stays.
      }
    }, SITE_ACCESS_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const allow = () => {
    // Nothing awaited before this call: Firefox only allows permissions.request() inside the click.
    const pending = requestWebAppHostAccess(missing);
    setStatus('requesting');
    void pending.then((granted) => recheck(!granted));
  };

  const hosts = missing.map(hostOfPattern).join(' and ');
  const showButton = status === 'needed' || status === 'requesting' || status === 'refused';
  const message = status === 'granted' ? SUCCESS : status === 'refused' ? REFUSED : '';

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border bg-card text-card-foreground p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="h-8 w-8" />
          <h1 className="text-lg font-semibold">Let the TabMerger website find TabMerger</h1>
        </div>
        {status === 'loading' && <p className="text-sm text-muted-foreground">Checking site access…</p>}
        {showButton && (
          <>
            <p className="text-sm text-muted-foreground">
              Firefox hasn&apos;t allowed TabMerger on {hosts} yet. Without it the website can&apos;t detect
              TabMerger, pass your sign-in or start a sync. Click the button below, then confirm in
              Firefox&apos;s prompt.
            </p>
            <Button
              type="button"
              className="self-start"
              aria-label={`Allow TabMerger on ${hosts}`}
              loading={status === 'requesting'}
              onClick={allow}
            >
              <Link2 aria-hidden="true" />
              Allow TabMerger on {hosts}
            </Button>
          </>
        )}
        <p
          role="status"
          aria-live="polite"
          className={status === 'refused' ? 'text-sm text-destructive' : 'text-sm text-foreground'}
        >
          {status === 'granted' && <CheckCircle2 className="inline h-4 w-4 mr-2 text-primary align-text-bottom" aria-hidden="true" />}
          {message}
        </p>
      </div>
    </main>
  );
}
