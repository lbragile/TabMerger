import { useTranslation } from 'react-i18next';
import { AI_PROVIDER_LABELS, MANAGED_AI_PROVIDER, type AiModelChoice, type AiProvider } from '@tabmerger/shared';
import { Separator } from '@/components/ui/separator';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useByokKey } from '@/hooks/useByokKey';
import { formatNumber } from '@/lib/i18n';
import { choiceForProvider, readAiModelChoice } from '@/lib/aiModel';
import { AiKeySetting } from './AiKeySetting';
import { AiModelPicker } from './AiModelPicker';

interface AiSettingsProps {
  /** The draft's `aiModel` (may be missing in settings saved before the picker existed). */
  model: AiModelChoice | undefined;
  onModelChange: (value: AiModelChoice) => void;
}

/**
 * The top of Settings → AI: how the plan pays for AI ("Using TabMerger's key — N of M credits
 * left this month" or "Using your own OpenAI key"), the own key (BYOK plans only), and the model
 * picker for the provider requests go to. Rendered only for users with AI features; nothing until
 * the plan's AI mode is known.
 */
export function AiSettings({ model, onModelChange }: AiSettingsProps) {
  const { t } = useTranslation();
  const { aiMode } = useEntitlements();
  const usage = useAiUsage();
  const byokKey = useByokKey();
  if (!aiMode) return null;

  const byok = aiMode === 'byok';
  const provider: AiProvider | null = byok ? (byokKey.saved?.provider ?? null) : MANAGED_AI_PROVIDER;
  // A key from another provider makes a chosen model of the old one invalid: back to auto
  const handleKeySaved = (saved: AiProvider) => {
    if (choiceForProvider(model, saved) !== readAiModelChoice(model)) onModelChange('auto');
  };
  return (
    <div className="space-y-4 min-w-0">
      <p className="text-xs font-medium" data-testid="ai-plan-line">
        {byok
          ? byokKey.saved
            ? t('settings.ai.plan.byok', { provider: AI_PROVIDER_LABELS[byokKey.saved.provider] })
            : t('settings.ai.plan.byokNoKey')
          : usage.known
            ? t('settings.ai.plan.managed', { remaining: formatNumber(usage.remaining), cap: formatNumber(usage.cap) })
            : t('settings.ai.plan.managedUnknown')}
      </p>
      {byok && <AiKeySetting saved={byokKey.saved} refresh={byokKey.refresh} onSaved={handleKeySaved} />}
      <AiModelPicker value={readAiModelChoice(model)} onChange={onModelChange} aiMode={aiMode} provider={provider} allowance={usage.cap} />
      <Separator />
    </div>
  );
}
