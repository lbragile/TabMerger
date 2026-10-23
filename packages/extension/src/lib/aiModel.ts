import {
  AI_ESTIMATE_EXAMPLES,
  AI_MODEL_CHOICES,
  AUTO_AI_MODEL,
  DEFAULT_AI_MODEL_CHOICE,
  estimateAiCostUsd,
  estimateAiCredits,
  resolveAiModel,
  type AiAction,
  type AiModelChoice,
  type AiModelId
} from '@tabmerger/shared';

/**
 * The model choice stored in `appSettings.aiModel`, validated: settings saved before the picker
 * existed, or holding a model this build no longer offers, read as the default (`auto`).
 */
export function readAiModelChoice(value: unknown): AiModelChoice {
  return (AI_MODEL_CHOICES as readonly unknown[]).includes(value) ? (value as AiModelChoice) : DEFAULT_AI_MODEL_CHOICE;
}

/** The model a request for `action` runs on with this choice (a valid choice always resolves). */
export function modelFor(choice: AiModelChoice, action: AiAction): AiModelId {
  return resolveAiModel(choice, action) ?? AUTO_AI_MODEL[action];
}

/** One "burn rate" example of the Settings model picker. */
export interface AiEstimate {
  action: AiAction;
  tabs: number;
  credits: number;
  usd: number;
}

/** The picker's examples (`AI_ESTIMATE_EXAMPLES`) for one choice, in credits and in dollars. */
export function estimatesFor(choice: AiModelChoice): AiEstimate[] {
  return AI_ESTIMATE_EXAMPLES.map(({ action, tabs }) => {
    const model = modelFor(choice, action);
    return { action, tabs, credits: estimateAiCredits(model, action, tabs), usd: estimateAiCostUsd(model, action, tabs) };
  });
}

/**
 * About how many of the largest organize example an allowance of `credits` pays for with this
 * choice ("≈ 860 organizes a month"). 0 when there is no organize example or no allowance.
 */
export function organizesFor(choice: AiModelChoice, credits: number): { count: number; tabs: number } | null {
  const example = [...AI_ESTIMATE_EXAMPLES].reverse().find((e) => e.action === 'organize');
  if (!example) return null;
  const each = estimateAiCredits(modelFor(choice, 'organize'), 'organize', example.tabs);
  return { count: each > 0 && credits > 0 ? Math.floor(credits / each) : 0, tabs: example.tabs };
}
