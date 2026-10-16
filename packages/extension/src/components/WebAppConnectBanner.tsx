import { useEffect, useRef } from 'react';
import { Link2, X } from 'lucide-react';
import { useWebAppHostAccess } from '@/hooks/useWebAppHostAccess';
import { hostOfPattern } from '@/lib/webAppHostAccess';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The first focusable element after `node` in document order, outside it: where focus goes when
 * the banner disappears from under a focused button, instead of falling back to the page body.
 */
function nextFocusableAfter(node: HTMLElement): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE));
  return (
    all.find((el) => !node.contains(el) && Boolean(node.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) ??
    null
  );
}

/**
 * Firefox only: offers one click to let TabMerger run on a website it trusts but Firefox hasn't
 * granted (an update that adds a site doesn't grant it, see `lib/webAppHostAccess.ts`). Without
 * it the website can't detect the extension, hand over a sign-in or start a sync. Renders nothing
 * when every site is granted, on Chrome and Edge, and once dismissed for the missing sites.
 * Allow opens the site-access tab, which asks Firefox (Firefox shows no permission prompt over an
 * open popup); the banner hides once the grant is seen, and a refusal leaves it in place.
 */
export function WebAppConnectBanner() {
  const { missing, connect, dismiss } = useWebAppHostAccess();
  const ref = useRef<HTMLDivElement>(null);
  // Where focus goes once the banner is gone, set only when a click inside it may remove it.
  const focusAfterHide = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (missing.length > 0 || !focusAfterHide.current) return;
    const target = focusAfterHide.current;
    focusAfterHide.current = null;
    // Only when focus was left on nothing (the removed button), never stealing it from elsewhere.
    if (!document.activeElement || document.activeElement === document.body) target.focus();
  }, [missing.length]);

  if (missing.length === 0) return null;

  const hosts = missing.map(hostOfPattern).join(' and ');

  const rememberFocusTarget = () => {
    focusAfterHide.current = ref.current ? nextFocusableAfter(ref.current) : null;
  };

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Website access"
      className="flex items-center gap-2 px-3 py-2 text-xs shrink-0 bg-primary/10 text-primary"
    >
      <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0 truncate" title={`Allow TabMerger on ${hosts} so the website can find it and pass your sign-in.`}>
        Allow TabMerger on {hosts} so the website can find it and pass your sign-in.
      </span>
      <button
        type="button"
        aria-label={`Allow TabMerger on ${hosts}`}
        className="shrink-0 border border-primary/40 text-primary px-2 py-0.5 text-xs hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        // Opens the site-access tab, which closes the popup; the tab makes the request.
        onClick={() => {
          rememberFocusTarget();
          void connect();
        }}
      >
        Allow
      </button>
      <button
        type="button"
        aria-label="Dismiss website access prompt"
        className="shrink-0 text-primary hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          rememberFocusTarget();
          void dismiss();
        }}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
