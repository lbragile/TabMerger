import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDER_LABELS, MANAGED_AI_PROVIDER, type AiModelChoice, type AiProvider } from '@tabmerger/shared';
import { Separator } from '@/components/ui/separator';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useByokKey } from '@/hooks/useByokKey';
import { AI_MANAGED_ENABLED } from '@/lib/aiFlag';
import { formatNumber } from '@/lib/i18n';
import { choiceForProvider, readAiModelChoice } from '@/lib/aiModel';
import { AiKeySetting } from './AiKeySetting';
import { AiModelPicker } from './AiModelPicker';
import { AiProviderPicker } from './AiProviderPicker';
import { BuyCreditsLink } from './BuyCreditsLink';

interface AiSettingsProps {
  /** The draft's `aiModel` (may be missing in settings saved before the picker existed). */
  model: AiModelChoice | undefined;
  onModelChange: (value: AiModelChoice) => void;
}

/**
 * The top of Settings → AI: how the plan pays for AI ("Using TabMerger's key — N of M credits
 * left this month" or "Using your own OpenAI key") and the model picker for the provider requests
 * go to. Own-key (BYOK) plans pick their provider first: its key field, setup links and models
 * show only once one is picked (the saved key's provider, or a pick remembered on this device).
 * Managed plans have no provider choice: Anthropic, and get "Buy more credits" next to the
 * credits line (only while TabMerger's AI is on sale). Rendered only for users with AI features;
 * nothing until the plan's AI mode is known.
 */
export function AiSettings({ model, onModelChange }: AiSettingsProps) {
  const { t } = useTranslation();
  const { aiFeatures, aiMode } = useEntitlements();
  const usage = useAiUsage();
  const byokKey = useByokKey();
  const pickerRef = useRef<HTMLFieldSetElement>(null);
  const [focusPicker, setFocusPicker] = useState(false);
  const byok = aiMode === 'byok';
  // Credits exist only on TabMerger's key: managed Pro AI, while that option is live
  const canBuyCredits = aiFeatures && aiMode === 'managed' && AI_MANAGED_ENABLED;
  const saved = byokKey.saved;
  const provider: AiProvider | null = byok ? (byokKey.picked ?? saved?.provider ?? null) : MANAGED_AI_PROVIDER;

  // After Cancel on a provider switch, focus returns to the saved key's provider once it is
  // checked again (the pick's query cache update can land a render after the click)
  useEffect(() => {
    if (!focusPicker || !saved || provider !== saved.provider) return;
    pickerRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    setFocusPicker(false);
  }, [focusPicker, provider, saved]);

  if (!aiMode || (byok && byokKey.loading)) return null;
  // A key from another provider makes a chosen model of the old one invalid: back to auto
  const handleKeySaved = (savedProvider: AiProvider) => {
    if (choiceForProvider(model, savedProvider) !== readAiModelChoice(model)) onModelChange('auto');
    void byokKey.pick(null);
  };
  // Picking the saved key's provider is no pick at all: forget it, the saved key decides
  const handlePick = (next: AiProvider) => void byokKey.pick(saved && saved.provider === next ? null : next);
  const handleCancelSwitch = () => {
    void byokKey.pick(null);
    setFocusPicker(true);
  };

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 text-xs font-medium" data-testid="ai-plan-line">
          {byok
            ? saved
              ? t('settings.ai.plan.byok', { provider: AI_PROVIDER_LABELS[saved.provider] })
              : t('settings.ai.plan.byokNoKey')
            : usage.known
              ? t('settings.ai.plan.managed', { remaining: formatNumber(usage.remaining), cap: formatNumber(usage.cap) })
              : t('settings.ai.plan.managedUnknown')}
        </p>
        {canBuyCredits && <BuyCreditsLink remaining={usage.remaining} total={usage.cap} known={usage.known} />}
      </div>
      {byok && <AiProviderPicker ref={pickerRef} value={provider} onChange={handlePick} />}
      {byok && provider && (
        <AiKeySetting
          key={provider}
          provider={provider}
          saved={saved}
          refresh={byokKey.refresh}
          onSaved={handleKeySaved}
          onRemoved={(removed) => byokKey.pick(removed)}
          onCancelSwitch={handleCancelSwitch}
        />
      )}
      {provider && (
        <AiModelPicker value={readAiModelChoice(model)} onChange={onModelChange} aiMode={aiMode} provider={provider} allowance={usage.cap} />
      )}
      <Separator />
    </div>
  );
}
