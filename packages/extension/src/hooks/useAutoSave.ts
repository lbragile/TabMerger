import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AUTO_SAVE_MESSAGE } from '@tabmerger/shared';
import { getSetting } from '@/lib/localDb';
import { AUTO_SAVE_STATE_KEY } from '@/lib/syncSettingKeys';
import { describeAutoSaveOutcome, parseAutoSaveOutcome, parseAutoSaveState, type AutoSaveState } from '@/lib/autoSave';
import { toast } from '@/lib/toast';
import { t } from '@/lib/i18n';
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups';

export const AUTO_SAVE_STATE_QUERY_KEY = ['autoSaveState'] as const;

/**
 * How the last auto-save ended (Settings status line). The worker writes it; it says so with
 * `AUTO_SAVE_MESSAGE.STATUS_CHANGED`, which refreshes this query while the popup is open.
 */
export function useAutoSaveState() {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const onMessage = (msg: unknown) => {
      if ((msg as { type?: unknown } | null | undefined)?.type === AUTO_SAVE_MESSAGE.STATUS_CHANGED) {
        void qc.invalidateQueries({ queryKey: AUTO_SAVE_STATE_QUERY_KEY });
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [qc]);
  return useQuery<AutoSaveState>({
    queryKey: AUTO_SAVE_STATE_QUERY_KEY,
    queryFn: async () => parseAutoSaveState(await getSetting<unknown>(AUTO_SAVE_STATE_KEY, null)),
    staleTime: 0,
    refetchOnWindowFocus: false
  });
}

/**
 * "Auto-save now": asks the background worker for a run (it ignores the on/off switch and the
 * schedule; the plan, duplicate and Free-limit rules still apply) and tells the user how it ended.
 */
export function useAutoSaveNow(): { run: () => Promise<void>; running: boolean } {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const reply: unknown = await chrome.runtime.sendMessage({ type: AUTO_SAVE_MESSAGE.RUN_NOW });
      const outcome = parseAutoSaveOutcome(reply);
      const { ok, message } = describeAutoSaveOutcome(outcome);
      if (ok) toast.success(message);
      else if (outcome?.status === 'skipped') toast.info(message);
      else toast.error(message);
    } catch {
      toast.error(t('autoSave.status.failed'));
    } finally {
      setRunning(false);
      // `cancelRefetch: false`: never cancel a groups fetch another action may be waiting on
      void qc.invalidateQueries({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false });
      void qc.invalidateQueries({ queryKey: AUTO_SAVE_STATE_QUERY_KEY });
    }
  };
  return { run, running };
}
