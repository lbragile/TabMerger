import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@/lib/types';
import { useRestoreSession } from '@/hooks/useSessions';
import { useConfirm } from '@/hooks/useConfirm';

/** A session name as the restore question shows it: cut at 60 characters. */
const SESSION_NAME_IN_QUESTION = 60;

/**
 * "Restore session" behind its confirmation: restoring closes every browser window, so it always
 * asks first ("Close all windows"). Used by the Sessions sidebar row and the session view, so both
 * ask the same question. `confirmDialog` must be rendered by the caller.
 *
 * @returns `restore(session, onRestored?)` (`onRestored` runs after a successful restore),
 *   `restoring` while one runs, and the dialog element.
 */
export function useConfirmedRestoreSession(): {
  restore: (session: Session, onRestored?: () => void) => void;
  restoring: boolean;
  confirmDialog: ReactNode;
} {
  const { t } = useTranslation();
  const { mutate: restoreSession, isPending: restoring } = useRestoreSession();
  const { confirm, confirmDialog } = useConfirm();

  const restore = (session: Session, onRestored?: () => void) => {
    const name = session.name.length > SESSION_NAME_IN_QUESTION ? `${session.name.slice(0, SESSION_NAME_IN_QUESTION)}…` : session.name;
    void confirm({
      title: t('sidePanel.restoreConfirmTitle'),
      description: t('sidePanel.restoreConfirmDescription', { name }),
      confirmLabel: t('sidePanel.restoreConfirmLabel'),
      destructive: true
    }).then((confirmed) => {
      if (!confirmed) return;
      if (onRestored) restoreSession(session, { onSuccess: () => onRestored() });
      else restoreSession(session);
    });
  };

  return { restore, restoring, confirmDialog };
}
