import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_MODEL_CHOICES, AI_MODELS, aiModelsForProvider, type AiMode, type AiModelChoice, type AiProvider } from '@tabmerger/shared';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AI_SELECT_CONTENT_CLASS, AI_SELECT_TRIGGER_CLASS } from '@/components/Settings/settingsControls';
import { choiceForProvider, costLevel, estimatesFor, modelFor, organizesFor, type AiCostLevel } from '@/lib/aiModel';
import { formatNumber } from '@/lib/i18n';

interface AiModelPickerProps {
  value: AiModelChoice;
  onChange: (value: AiModelChoice) => void;
  /** Credits for managed plans, a relative cost level (no dollar figures) for own-key plans. */
  aiMode: AiMode;
  /**
   * Whose models to offer: Anthropic for managed plans, the provider picked in Settings for
   * own-key plans (the parent renders no picker until one is picked).
   */
  provider: AiProvider;
  /** This month's managed allowance, for "≈ N organizes a month". Ignored for own-key plans. */
  allowance: number;
}

const isAiModelChoice = (value: string): value is AiModelChoice => (AI_MODEL_CHOICES as readonly string[]).includes(value);

/**
 * Settings → AI: which model AI features use, as a dropdown in a Settings row: `auto` first, then
 * the provider's models. Each option shows its "burn rate" as concrete examples
 * (`AI_ESTIMATE_EXAMPLES`, worked out by the shared estimate functions) on a muted second line:
 * credits per use and organizes a month for managed plans, or, for own-key plans, a cost level
 * relative to the provider's other models (never dollars). The trigger has the same fixed width as
 * the provider dropdown's, whatever the choice. The chosen option's line stays under
 * the row once the list closes, and describes the trigger. Only changes the Settings draft. A
 * stored model of another provider shows as `auto`.
 */
export function AiModelPicker({ value, onChange, aiMode, provider, allowance }: AiModelPickerProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const descriptionId = useId();
  const infoId = useId();
  const byok = aiMode === 'byok';

  const choices: AiModelChoice[] = ['auto', ...aiModelsForProvider(provider)];
  const selected = choiceForProvider(value, provider);

  const levelLabel = (level: AiCostLevel) => t(`settings.ai.cost.${level}`);
  const nameOf = (choice: AiModelChoice) => (choice === 'auto' ? t('settings.ai.model.auto') : AI_MODELS[choice].label);

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

  /** The secondary info of a choice: what Auto does, its burn rate and, managed, organizes a month. */
  const info = (choice: AiModelChoice): ReactNode => {
    const perMonth = byok ? null : organizesFor(choice, allowance);
    return (
      <>
        {choice === 'auto' && <span className="block">{t('settings.ai.model.autoDescription')}</span>}
        <span className="block">{line(choice)}</span>
        {perMonth && (
          <span className="block">{t('settings.ai.estimate.perMonth', { count: perMonth.count, formatted: formatNumber(perMonth.count) })}</span>
        )}
      </>
    );
  };

  return (
    <div className="min-w-0 space-y-1" data-testid="ai-model-picker">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Label id={labelId} className="text-sm">
            {t('settings.ai.model.label')}
          </Label>
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {byok ? t('settings.ai.model.byokDescription') : t('settings.ai.model.managedDescription')}
          </p>
        </div>
        <Select value={selected} onValueChange={(next) => isAiModelChoice(next) && onChange(next)}>
          <SelectTrigger
            className={AI_SELECT_TRIGGER_CLASS}
            aria-labelledby={labelId}
            aria-describedby={`${descriptionId} ${infoId}`}
            // The full name when a long one is cut with an ellipsis
            title={nameOf(selected)}
            data-testid="ai-model-select"
          >
            {/* Only the name: the options' second lines would not fit the trigger */}
            <SelectValue>{nameOf(selected)}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end" collisionPadding={8} className={`w-[min(22rem,var(--radix-select-content-available-width))] ${AI_SELECT_CONTENT_CLASS}`}>
            {choices.map((choice) => (
              <SelectItem key={choice} value={choice} textValue={nameOf(choice)} className="items-start" data-testid={`ai-model-${choice}`}>
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  {nameOf(choice)}
                  {choice === 'auto' && (
                    <Badge variant="secondary" className="text-[0.625rem] font-normal">
                      {t('settings.ai.model.recommended')}
                    </Badge>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">{info(choice)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p id={infoId} className="min-w-0 text-xs text-muted-foreground" data-testid="ai-model-selected-info">
        {info(selected)}
      </p>
    </div>
  );
}
