import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_MODEL_CHOICES, AI_MODELS, type AiMode, type AiModelChoice } from '@tabmerger/shared';
import { Badge } from '@/components/ui/badge';
import { estimatesFor, organizesFor, type AiEstimate } from '@/lib/aiModel';
import { formatNumber } from '@/lib/i18n';

interface AiModelPickerProps {
  value: AiModelChoice;
  onChange: (value: AiModelChoice) => void;
  /** Credits for managed plans, dollars billed by Anthropic for own-key plans. */
  aiMode: AiMode;
  /** This month's managed allowance, for "≈ N organizes a month". Ignored for own-key plans. */
  allowance: number;
}

/**
 * Settings → AI: which model AI features use. Each option shows its "burn rate" as concrete
 * examples (`AI_ESTIMATE_EXAMPLES`, worked out by the shared estimate functions): credits per use
 * and organizes a month for managed plans, or what Anthropic bills per use for own-key plans.
 * Native radio inputs, so arrow keys move the choice. Only changes the Settings draft.
 */
export function AiModelPicker({ value, onChange, aiMode, allowance }: AiModelPickerProps) {
  const { t } = useTranslation();
  const name = useId();
  const byok = aiMode === 'byok';

  const amount = (e: AiEstimate) =>
    byok
      ? t('settings.ai.estimate.usd', { amount: formatNumber(e.usd, { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 }) })
      : t('settings.ai.estimate.credits', { count: e.credits, formatted: formatNumber(e.credits) });

  const line = (choice: AiModelChoice) =>
    estimatesFor(choice)
      .map((e) =>
        t('settings.ai.estimate.item', {
          action: t(`settings.ai.estimate.action.${e.action}`, { count: e.tabs }),
          amount: amount(e)
        })
      )
      .join(' · ');

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{t('settings.ai.model.label')}</legend>
      <p className="text-xs text-muted-foreground">
        {byok ? t('settings.ai.model.byokDescription') : t('settings.ai.model.managedDescription')}
      </p>
      {AI_MODEL_CHOICES.map((choice) => {
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
              checked={value === choice}
              onChange={() => onChange(choice)}
              aria-describedby={descriptionId}
              className="mt-0.5 shrink-0 accent-primary"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1 text-sm">
                {choice === 'auto' ? t('settings.ai.model.auto') : AI_MODELS[choice].label}
                {choice === 'auto' && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
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
