import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAndList, t as translate } from '@/lib/i18n';
import { Link2, X } from 'lucide-react';
import { useWebAppHostAccess } from '@/hooks/useWebAppHostAccess';
import { closePopupView, hostOfPattern } from '@/lib/webAppHostAccess';

/** Shown in the banner when the site-access tab could not be opened. */
/** Shown when the site access tab could not be opened. */
export const openFailedMessage = (): string => translate('siteAccess.openFailed');

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
 * open popup), then closes the popup: opening a tab doesn't close a Firefox popup, and the tab
 * explains the next step. If the tab can't be opened the popup stays and the banner says so.
 * The banner hides once the grant is seen, and a refusal leaves it in place.
 */
export function WebAppConnectBanner() {
  const { t } = useTranslation();
  const { missing, connect, dismiss } = useWebAppHostAccess();
  const ref = useRef<HTMLDivElement>(null);
  // Where focus goes once the banner is gone, set only when a click inside it may remove it.
  const focusAfterHide = useRef<HTMLElement | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    if (missing.length > 0 || !focusAfterHide.current) return;
    const target = focusAfterHide.current;
    focusAfterHide.current = null;
    // Only when focus was left on nothing (the removed button), never stealing it from elsewhere.
    if (!document.activeElement || document.activeElement === document.body) target.focus();
  }, [missing.length]);

  if (missing.length === 0) return null;

  const hosts = formatAndList(missing.map(hostOfPattern));

  const rememberFocusTarget = () => {
    focusAfterHide.current = ref.current ? nextFocusableAfter(ref.current) : null;
  };

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t('siteAccess.bannerLabel')}
      className="flex flex-col px-3 py-2 text-xs shrink-0 bg-primary/10 text-primary"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate" title={t('siteAccess.bannerText', { hosts })}>
          {t('siteAccess.bannerText', { hosts })}
        </span>
        <button
          type="button"
          aria-label={t('siteAccess.allowOn', { hosts })}
          className="shrink-0 border border-primary/40 text-primary px-2 py-0.5 text-xs hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          // Opens the site-access tab, which makes the request, then closes the popup (opening a
          // tab leaves a Firefox popup open). On failure the popup stays and focus stays here.
          onClick={() => {
            rememberFocusTarget();
            setOpenFailed(false);
            void connect().then((opened) => {
              if (opened) closePopupView();
              else setOpenFailed(true);
            });
          }}
        >
          {t('siteAccess.allow')}
        </button>
        <button
          type="button"
          aria-label={t('siteAccess.dismiss')}
          className="shrink-0 text-primary hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            rememberFocusTarget();
            void dismiss();
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {/* Always mounted, so screen readers announce the message when it appears. */}
      <p role="alert" className={openFailed ? 'mt-1 ps-5.5 text-destructive' : undefined}>
        {openFailed ? openFailedMessage() : null}
      </p>
    </div>
  );
}
