import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { aiPost } from '@/hooks/useAI';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/lib/toast';

/** Highest value the web app's `/api/ai/dev-usage` accepts (`AI_MAX_DEV_USAGE_COUNT` there). */
export const DEV_CREDITS_USED_MAX = 1_000_000;

/**
 * The typed value as a whole number of credits the route accepts: blanks, non-numbers and
 * negatives become 0, fractions are dropped, and anything above the route's maximum is capped.
 */
export function parseDevCreditsUsed(input: string): number {
  const n = Math.trunc(Number(input));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, DEV_CREDITS_USED_MAX);
}

interface DevAiCreditsProps {
  /** This month's allowance, shown in the description. */
  cap: number;
}

/**
 * Settings > Dev (development builds only): sets the signed-in account's `ai_usage.credits_used`
 * for this month through the web dev server's `/api/ai/dev-usage`, so the credits meter and the
 * server's limits can be tested without spending real credits first. Reset (0) also clears this
 * month's test credit packs on the server. The meter re-reads the real tables afterwards.
 */
export function DevAiCredits({ cap }: DevAiCreditsProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [input, setInput] = useState('0');
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const setCreditsUsed = async (credits: number) => {
    if (!session?.access_token) {
      toast.error(t('settings.toast.signInForAiUsage'));
      return;
    }
    try {
      await aiPost<{ count: number }>('/api/ai/dev-usage', { count: credits }, session.access_token);
      toast.success(t('settings.toast.aiUsageSet', { credits }));
      await queryClient.invalidateQueries({ queryKey: ['aiUsage'] });
    } catch {
      toast.error(t('settings.toast.aiUsageFailed'));
    }
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label htmlFor={inputId} className="text-sm">
          {t('settings.dev.usageLabel')}
        </Label>
        <p className="text-xs text-muted-foreground">{t('settings.dev.usageDescription', { cap })}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Input
          id={inputId}
          type="number"
          min={0}
          max={DEV_CREDITS_USED_MAX}
          step={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-20 h-8 text-xs rounded-none"
        />
        <Button
          variant="outline"
          size="sm"
          className="text-xs rounded-none"
          onClick={() => void setCreditsUsed(parseDevCreditsUsed(input))}
        >
          {t('settings.dev.usageSet')}
        </Button>
        <Button variant="outline" size="sm" className="text-xs rounded-none" onClick={() => void setCreditsUsed(0)}>
          {t('settings.dev.usageReset')}
        </Button>
      </div>
    </div>
  );
}
