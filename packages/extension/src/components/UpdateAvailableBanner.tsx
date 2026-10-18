import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, X } from 'lucide-react';
import { usePendingUpdate } from '@/hooks/usePendingUpdate';
import { restartToUpdate } from '@/lib/extensionUpdate';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** The first focusable element after `node` in document order, outside it. */
function nextFocusableAfter(node: HTMLElement): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE));
  return all.find((el) => !node.contains(el) && Boolean(node.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null;
}

/**
 * "Version X is ready": the browser downloaded an update it can't apply while TabMerger is running
 * (see lib/extensionUpdate.ts). "Restart to update" reloads the extension, which applies it and
 * closes the popup (the copy says so). Dismiss hides it for that version only. One compact row in
 * the banner stack above the sidebar and windows panel, so it never touches their 240px seam.
 */
export function UpdateAvailableBanner() {
  const { t } = useTranslation();
  const { update, dismiss } = usePendingUpdate();
  const ref = useRef<HTMLDivElement>(null);
  // Where focus goes once the banner is gone after Dismiss, instead of the page body.
  const focusAfterHide = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (update || !focusAfterHide.current) return;
    const target = focusAfterHide.current;
    focusAfterHide.current = null;
    if (!document.activeElement || document.activeElement === document.body) target.focus();
  }, [update]);

  if (!update) return null;
  const { version } = update;

  return (
    <div
      ref={ref}
      role="status"
      aria-label={t('banners.update.label')}
      data-testid="update-available-banner"
      className="flex items-center gap-2 px-3 py-2 text-xs shrink-0 min-w-0 bg-primary/10 text-primary"
    >
      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0 truncate" title={t('banners.update.text', { version })}>
        {t('banners.update.text', { version })}
      </span>
      <button
        type="button"
        aria-label={t('banners.update.restartLabel', { version })}
        className="shrink-0 border border-primary/40 text-primary px-2 py-0.5 text-xs hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => restartToUpdate()}
      >
        {t('banners.update.restart')}
      </button>
      <button
        type="button"
        aria-label={t('banners.update.dismissLabel', { version })}
        className="shrink-0 text-primary hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          focusAfterHide.current = ref.current ? nextFocusableAfter(ref.current) : null;
          void dismiss();
        }}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
