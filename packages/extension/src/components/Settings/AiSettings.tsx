import { useTranslation } from 'react-i18next';
import type { AiModelChoice } from '@tabmerger/shared';
import { Separator } from '@/components/ui/separator';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAiUsage } from '@/hooks/useAiUsage';
import { formatNumber } from '@/lib/i18n';
import { readAiModelChoice } from '@/lib/aiModel';
import { AiKeySetting } from './AiKeySetting';
import { AiModelPicker } from './AiModelPicker';

interface AiSettingsProps {
  /** The draft's `aiModel` (may be missing in settings saved before the picker existed). */
  model: AiModelChoice | undefined;
  onModelChange: (value: AiModelChoice) => void;
}

/**
 * The top of Settings → AI: how the plan pays for AI ("Using TabMerger's key — N of M credits
 * left this month" or "Using your own Anthropic key"), the own key (BYOK plans only), and the
 * model picker. Rendered only for users with AI features; nothing until the plan's AI mode is known.
 */
export function AiSettings({ model, onModelChange }: AiSettingsProps) {
  const { t } = useTranslation();
  const { aiMode } = useEntitlements();
  const usage = useAiUsage();
  if (!aiMode) return null;

  const byok = aiMode === 'byok';
  return (
    <div className="space-y-4 min-w-0">
      <p className="text-xs font-medium" data-testid="ai-plan-line">
        {byok
          ? t('settings.ai.plan.byok')
          : usage.known
            ? t('settings.ai.plan.managed', { remaining: formatNumber(usage.remaining), cap: formatNumber(usage.cap) })
            : t('settings.ai.plan.managedUnknown')}
      </p>
      {byok && <AiKeySetting />}
      <AiModelPicker value={readAiModelChoice(model)} onChange={onModelChange} aiMode={aiMode} allowance={usage.cap} />
      <Separator />
    </div>
  );
}
