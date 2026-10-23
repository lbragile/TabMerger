import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_MODELS, aiModelsForProvider, type AiMode, type AiModelChoice, type AiProvider } from '@tabmerger/shared';
import { Badge } from '@/components/ui/badge';
import { choiceForProvider, costLevel, estimatesFor, modelFor, organizesFor, type AiCostLevel } from '@/lib/aiModel';
import { formatNumber } from '@/lib/i18n';

interface AiModelPickerProps {
  value: AiModelChoice;
  onChange: (value: AiModelChoice) => void;
  /** Credits for managed plans, a relative cost level (no dollar figures) for own-key plans. */
  aiMode: AiMode;
  /**
   * Whose models to offer: Anthropic for managed plans, the saved key's provider for own-key
   * plans, or null for an own-key plan with no key saved yet (nothing to choose from).
   */
  provider: AiProvider | null;
  /** This month's managed allowance, for "≈ N organizes a month". Ignored for own-key plans. */
  allowance: number;
}

/**
 * Settings → AI: which model AI features use: `auto` or one of the provider's models. Each option
 * shows its "burn rate" as concrete examples (`AI_ESTIMATE_EXAMPLES`, worked out by the shared
 * estimate functions): credits per use and organizes a month for managed plans, or, for own-key
 * plans, a cost level relative to the provider's other models (never dollars). Native radio inputs, so arrow keys move the
 * choice. Only changes the Settings draft. A stored model of another provider shows as `auto`.
 */
export function AiModelPicker({ value, onChange, aiMode, provider, allowance }: AiModelPickerProps) {
  const { t } = useTranslation();
  const name = useId();
  const byok = aiMode === 'byok';

  if (!provider) {
    return (
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">{t('settings.ai.model.label')}</legend>
        <p className="text-xs text-muted-foreground" data-testid="ai-model-add-key-first">
          {t('settings.ai.model.addKeyFirst')}
        </p>
      </fieldset>
    );
  }
  const choices: AiModelChoice[] = ['auto', ...aiModelsForProvider(provider)];
  const checked = choiceForProvider(value, provider);

  const levelLabel = (level: AiCostLevel) => t(`settings.ai.cost.${level}`);

  // Managed: credits for each example. Own key: a cost level, never a dollar figure; a fixed model
  // has one level, Auto names the level of the model it uses for each example.
  const line = (choice: AiModelChoice) => {
    if (byok && choice !== 'auto') return levelLabel(costLevel(modelFor(choice, 'organize', provider)));
    return estimatesFor(choice, provider)
      .map((e) =>
        t('settings.ai.estimate.item', {
          action: t(`settings.ai.estimate.action.${e.action}`, { count: e.tabs }),
          amount: byok ? levelLabel(costLevel(e.model)) : t('settings.ai.estimate.credits', { count: e.credits, formatted: formatNumber(e.credits) })
        })
      )
      .join(' · ');
  };

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{t('settings.ai.model.label')}</legend>
      <p className="text-xs text-muted-foreground">
        {byok ? t('settings.ai.model.byokDescription') : t('settings.ai.model.managedDescription')}
      </p>
      {choices.map((choice) => {
        const descriptionId = `${name}-${choice}`;
        const perMonth = byok ? null : organizesFor(choice, allowance);
        return (
          <label
            key={choice}
            className="flex min-w-0 cursor-pointer items-start gap-2 border border-border p-2 has-[:checked]:border-primary"
            data-testid={`ai-model-${choice}`}
          >
            <input
              type="radio"
              name={name}
              value={choice}
              checked={checked === choice}
              onChange={() => onChange(choice)}
              aria-describedby={descriptionId}
              className="mt-0.5 shrink-0 accent-primary"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1 text-sm">
                {choice === 'auto' ? t('settings.ai.model.auto') : AI_MODELS[choice].label}
                {choice === 'auto' && (
                  <Badge variant="secondary" className="text-[0.625rem] font-normal">
                    {t('settings.ai.model.recommended')}
                  </Badge>
                )}
              </span>
              <span id={descriptionId} className="block text-xs text-muted-foreground">
                {choice === 'auto' && <span className="block">{t('settings.ai.model.autoDescription')}</span>}
                <span className="block">{line(choice)}</span>
                {perMonth && (
                  <span className="block">
                    {t('settings.ai.estimate.perMonth', { count: perMonth.count, formatted: formatNumber(perMonth.count) })}
                  </span>
                )}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
