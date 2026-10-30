import {
  AI_ESTIMATE_EXAMPLES,
  AI_MODEL_CHOICES,
  AI_MODELS,
  AUTO_AI_MODELS,
  DEFAULT_AI_MODEL_CHOICE,
  aiModelsForProvider,
  MANAGED_AI_PROVIDER,
  estimateAiCostUsd,
  estimateAiCredits,
  resolveAiModel,
  type AiAction,
  type AiModelChoice,
  type AiModelId,
  type AiProvider
} from '@tabmerger/shared';

/**
 * The model choice stored in `appSettings.aiModel`, validated: settings saved before the picker
 * existed, or holding a model this build no longer offers, read as the default (`auto`).
 */
export function readAiModelChoice(value: unknown): AiModelChoice {
  return (AI_MODEL_CHOICES as readonly unknown[]).includes(value) ? (value as AiModelChoice) : DEFAULT_AI_MODEL_CHOICE;
}

/**
 * The choice that applies on `provider`: a model from another provider (chosen while a key from
 * that provider was saved, or before switching between own key and TabMerger's key) means `auto`,
 * since the server refuses a model the request's provider doesn't have.
 */
export function choiceForProvider(value: unknown, provider: AiProvider): AiModelChoice {
  const choice = readAiModelChoice(value);
  return choice === 'auto' || AI_MODELS[choice].provider === provider ? choice : 'auto';
}

/** The model a request for `action` runs on with this choice and provider. */
export function modelFor(choice: AiModelChoice, action: AiAction, provider: AiProvider = MANAGED_AI_PROVIDER): AiModelId {
  return resolveAiModel(choice, action, provider) ?? AUTO_AI_MODELS[provider][action];
}

/** One "burn rate" example of the Settings model picker. */
export interface AiEstimate {
  action: AiAction;
  tabs: number;
  /** The model the choice runs this example on. */
  model: AiModelId;
  /** Credits on TabMerger's key (shown only to managed plans). */
  credits: number;
}

/** The picker's examples (`AI_ESTIMATE_EXAMPLES`) for one choice: the model each runs on and its credits. */
export function estimatesFor(choice: AiModelChoice, provider: AiProvider = MANAGED_AI_PROVIDER): AiEstimate[] {
  return AI_ESTIMATE_EXAMPLES.map(({ action, tabs }) => {
    const model = modelFor(choice, action, provider);
    return { action, tabs, model, credits: estimateAiCredits(model, action, tabs) };
  });
}

/** How a model's price compares with the other models of its provider. */
export type AiCostLevel = 'low' | 'medium' | 'high';

/** A model's estimated cost over every picker example: only used to rank models, never shown. */
function exampleCost(model: AiModelId): number {
  return AI_ESTIMATE_EXAMPLES.reduce((sum, { action, tabs }) => sum + estimateAiCostUsd(model, action, tabs), 0);
}

/**
 * Where a model sits among its provider's models by estimated cost: the cheapest is `low`, the
 * dearest `high`, anything between `medium`. Own-key plans see this instead of dollar figures,
 * which read as a price tag for each action rather than a comparison.
 */
export function costLevel(model: AiModelId): AiCostLevel {
  const ranked = aiModelsForProvider(AI_MODELS[model].provider).sort((a, b) => exampleCost(a) - exampleCost(b));
  const rank = ranked.indexOf(model);
  if (rank <= 0) return 'low';
  return rank === ranked.length - 1 ? 'high' : 'medium';
}

/**
 * About how many of the largest organize example an allowance of `credits` pays for with this
 * choice on TabMerger's key ("≈ 860 organizes a month"). Null when there is no organize example.
 */
export function organizesFor(choice: AiModelChoice, credits: number): { count: number; tabs: number } | null {
  const example = [...AI_ESTIMATE_EXAMPLES].reverse().find((e) => e.action === 'organize');
  if (!example) return null;
  const each = estimateAiCredits(modelFor(choice, 'organize'), 'organize', example.tabs);
  return { count: each > 0 && credits > 0 ? Math.floor(credits / each) : 0, tabs: example.tabs };
}
