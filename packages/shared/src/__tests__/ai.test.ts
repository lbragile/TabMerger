import { describe, it, expect } from 'vitest';
import {
  AI_COST_SHARE_PERCENT,
  AI_ESTIMATE_EXAMPLES,
  AI_MODEL_IDS,
  AI_MODELS,
  AI_PROVIDERS,
  AUTO_AI_MODEL,
  AUTO_AI_MODELS,
  CREDIT_MICRO_USD,
  PAYMENT_FEE_BPS,
  PAYMENT_FEE_FIXED_CENTS,
  PRO_AI_MONTHLY_CREDITS,
  aiCallCostUsd,
  aiCallCredits,
  aiModelsForProvider,
  byokKeyProvider,
  creditsForPayment,
  estimateAiCostUsd,
  estimateAiCredits,
  isAiMode,
  isAnthropicApiKey,
  isByokApiKey,
  maskApiKey,
  monthlyAllowanceForPayment,
  resolveAiModel,
} from '../constants/ai';
import { PRICING_TIERS, YEARLY_DISCOUNT_PERCENT, getPricingTier } from '../constants/index';

/** What a payment nets after the assumed fees, in dollars. */
function net(usd: number): number {
  return usd * (1 - PAYMENT_FEE_BPS / 10_000) - PAYMENT_FEE_FIXED_CENTS / 100;
}

/** The most AI spend, in dollars, that `credits` allow. */
function spend(credits: number): number {
  return (credits * CREDIT_MICRO_USD) / 1e6;
}

describe('creditsForPayment', () => {
  it('turns a payment into credits worth 40% of what it nets', () => {
    expect(creditsForPayment(2.5)).toBe(820);
    expect(creditsForPayment(25)).toBe(9280);
    expect(creditsForPayment(7.99)).toBe(2884);
    expect(creditsForPayment(85.99, 12)).toBe(2684);
  });

  it('gives nothing for free, tiny or malformed payments', () => {
    expect(creditsForPayment(0)).toBe(0);
    expect(creditsForPayment(0.3)).toBe(0);
    expect(creditsForPayment(-5)).toBe(0);
    expect(creditsForPayment(Number.NaN)).toBe(0);
    expect(creditsForPayment(10, 0)).toBe(0);
    expect(creditsForPayment(10, 1.5)).toBe(0);
  });
});

describe('the 40% guarantee', () => {
  const proAi = getPricingTier('pro_ai');
  // [name, amount paid, months it covers, credits it grants per month]
  const payments: [string, number, number, number][] = [
    ['managed monthly', proAi.monthlyPrice, 1, monthlyAllowanceForPayment(proAi.monthlyPrice, 1)],
    ['managed yearly', proAi.yearlyPrice, 12, monthlyAllowanceForPayment(proAi.yearlyPrice, 12)],
    ['managed monthly, 50% off', proAi.monthlyPrice / 2, 1, monthlyAllowanceForPayment(proAi.monthlyPrice / 2, 1)],
    ['managed yearly, 50% off', proAi.yearlyPrice / 2, 12, monthlyAllowanceForPayment(proAi.yearlyPrice / 2, 12)],
    ['managed monthly, 100% off', 0, 1, monthlyAllowanceForPayment(0, 1)],
    ['smallest credit pack', 2.5, 1, creditsForPayment(2.5)],
    ['largest credit pack', 25, 1, creditsForPayment(25)],
  ];

  it.each(payments)('%s never funds more AI than 40%% of what it nets', (_name, usd, months, credits) => {
    expect(spend(credits) * months).toBeLessThanOrEqual((AI_COST_SHARE_PERCENT / 100) * Math.max(0, net(usd)) + 1e-9);
  });

  it('advertises an allowance both full-price intervals can pay for', () => {
    expect(monthlyAllowanceForPayment(proAi.monthlyPrice, 1)).toBe(PRO_AI_MONTHLY_CREDITS);
    expect(monthlyAllowanceForPayment(proAi.yearlyPrice, 12)).toBe(PRO_AI_MONTHLY_CREDITS);
  });

  it('lowers the allowance when a discount lowers the payment', () => {
    expect(monthlyAllowanceForPayment(proAi.monthlyPrice / 2, 1)).toBeLessThan(PRO_AI_MONTHLY_CREDITS);
    expect(monthlyAllowanceForPayment(0, 1)).toBe(0);
  });

  it('prices the BYOK option between Pro and managed Pro AI', () => {
    expect(proAi.byok).toEqual(expect.objectContaining({ monthlyPrice: 5.99, yearlyPrice: 64.49 }));
    expect(getPricingTier('pro').monthlyPrice).toBeLessThan(proAi.byok!.monthlyPrice);
    expect(proAi.byok!.monthlyPrice).toBeLessThan(proAi.monthlyPrice);
  });
});

describe('yearly discount', () => {
  const options = PRICING_TIERS.filter((tier) => tier.monthlyPrice > 0).flatMap((tier) => [
    [tier.name, tier.monthlyPrice, tier.yearlyPrice] as const,
    ...(tier.byok ? [[`${tier.name} (own key)`, tier.byok.monthlyPrice, tier.byok.yearlyPrice] as const] : []),
  ]);

  it.each(options)('%s saves the advertised yearly discount, rounded down', (_name, monthly, yearly) => {
    const saving = ((monthly * 12 - yearly) / (monthly * 12)) * 100;
    expect(saving).toBeGreaterThanOrEqual(YEARLY_DISCOUNT_PERCENT);
    expect(saving).toBeLessThan(YEARLY_DISCOUNT_PERCENT + 1);
  });

  it('covers every paid option', () => {
    expect(options).toHaveLength(3);
  });
});

describe('aiCallCredits', () => {
  it('charges list price rounded up to whole credits', () => {
    // 1M input + 1M output on Sonnet 5.5 = $2 + $10 = $12 = 12,000 credits.
    expect(aiCallCredits('claude-sonnet-5-5', 1_000_000, 1_000_000)).toBe(12_000);
    // 18,300 in + 1,500 out on Sonnet 5.5 = $0.0366 + $0.015 = $0.0516.
    expect(aiCallCredits('claude-sonnet-5-5', 18_300, 1_500)).toBe(52);
  });

  it('charges at least one credit for any usage and none for no usage', () => {
    expect(aiCallCredits('claude-haiku-5-5', 10, 1)).toBe(1);
    expect(aiCallCredits('claude-haiku-5-5', 0, 0)).toBe(0);
    expect(aiCallCredits('claude-haiku-5-5', -5, -1)).toBe(0);
  });

  it('uses Haiku 5.5 long-context prices above 100K input tokens', () => {
    expect(aiCallCredits('claude-haiku-5-5', 100_000, 0)).toBe(10);
    expect(aiCallCredits('claude-haiku-5-5', 100_001, 0)).toBe(51);
  });

  it('costs the same in dollars as in credits', () => {
    for (const model of AI_MODEL_IDS) {
      // 50K input tokens stays under every long-context threshold.
      expect(aiCallCostUsd(model, 50_000, 0)).toBeCloseTo(AI_MODELS[model].inputCentsPerMTok / 100 / 20, 6);
      expect(aiCallCostUsd(model, 50_000, 0)).toBeCloseTo((aiCallCredits(model, 50_000, 0) * CREDIT_MICRO_USD) / 1e6, 3);
    }
  });
});

describe('resolveAiModel', () => {
  it('uses each feature\'s default for auto or no choice', () => {
    expect(resolveAiModel('auto', 'organize')).toBe(AUTO_AI_MODEL.organize);
    expect(resolveAiModel(undefined, 'nameGroup')).toBe('claude-haiku-5-5');
    expect(resolveAiModel(null, 'organize')).toBe('claude-sonnet-5-5');
  });

  it('accepts only known models', () => {
    expect(resolveAiModel('claude-opus-5-5', 'nameGroup')).toBe('claude-opus-5-5');
    expect(resolveAiModel('claude-fable-5-1', 'nameGroup')).toBeNull();
    expect(resolveAiModel(42, 'nameGroup')).toBeNull();
  });

  it('keeps managed requests on Anthropic models', () => {
    expect(resolveAiModel('gpt-6-luna', 'nameGroup')).toBeNull();
    expect(resolveAiModel('gemini-4-argon', 'organize', 'anthropic')).toBeNull();
  });

  it('resolves auto and fixed choices on the key\'s provider', () => {
    expect(resolveAiModel('auto', 'nameGroup', 'openai')).toBe('gpt-6-luna');
    expect(resolveAiModel(undefined, 'organize', 'google')).toBe('gemini-3.8-flash');
    expect(resolveAiModel('gpt-6.1-sol', 'organize', 'openai')).toBe('gpt-6.1-sol');
    expect(resolveAiModel('claude-haiku-5-5', 'nameGroup', 'openai')).toBeNull();
  });

  it('only defaults to models of the same provider', () => {
    for (const provider of AI_PROVIDERS) {
      for (const model of Object.values(AUTO_AI_MODELS[provider])) {
        expect(AI_MODELS[model].provider).toBe(provider);
      }
    }
  });
});

describe('estimates', () => {
  it('ranks each provider\'s models by cost for every example', () => {
    for (const provider of AI_PROVIDERS) {
      for (const { action, tabs } of AI_ESTIMATE_EXAMPLES) {
        const costs = aiModelsForProvider(provider).map((m) => estimateAiCostUsd(m, action, tabs));
        expect(costs).toHaveLength(3);
        expect(costs).toEqual([...costs].sort((a, b) => a - b));
      }
    }
  });

  it('matches the spec\'s organize example on Haiku and Sonnet', () => {
    expect(estimateAiCredits('claude-haiku-5-5', 'organize', 300)).toBe(3);
    expect(estimateAiCredits('claude-sonnet-5-5', 'organize', 300)).toBe(52);
  });
});

describe('BYOK keys and modes', () => {
  it('recognizes Anthropic key shapes', () => {
    expect(isAnthropicApiKey(`sk-ant-api03-${'a'.repeat(40)}`)).toBe(true);
    expect(isAnthropicApiKey('sk-ant-short')).toBe(false);
    expect(isAnthropicApiKey(`sk-proj-${'a'.repeat(40)}`)).toBe(false);
    expect(isAnthropicApiKey(`sk-ant-${'a'.repeat(30)}\n`)).toBe(false);
    expect(isAnthropicApiKey(undefined)).toBe(false);
  });

  it('tells the provider from the key', () => {
    expect(byokKeyProvider(`sk-ant-api03-${'a'.repeat(40)}`)).toBe('anthropic');
    expect(byokKeyProvider(`sk-proj-${'A1_-'.repeat(20)}`)).toBe('openai');
    expect(byokKeyProvider(`sk-svcacct-${'a'.repeat(40)}`)).toBe('openai');
    expect(byokKeyProvider(`sk-${'a'.repeat(48)}`)).toBe('openai');
    expect(byokKeyProvider(`AIza${'b'.repeat(35)}`)).toBe('google');
  });

  it('rejects keys no provider would accept', () => {
    expect(byokKeyProvider(`sk-admin-${'a'.repeat(40)}`)).toBeNull();
    expect(byokKeyProvider(`AIza${'b'.repeat(34)}`)).toBeNull();
    expect(byokKeyProvider(`sk-proj-${'a'.repeat(40)} `)).toBeNull();
    expect(byokKeyProvider(`AIza${'b'.repeat(35)}\n`)).toBeNull();
    expect(byokKeyProvider(null)).toBeNull();
    expect(isByokApiKey('hello')).toBe(false);
  });

  it('masks a key down to its last four characters', () => {
    expect(maskApiKey(`sk-ant-api03-${'a'.repeat(36)}wxyz`)).toBe('sk-ant-…wxyz');
    expect(maskApiKey(`sk-proj-${'a'.repeat(36)}wxyz`)).toBe('sk-…wxyz');
    expect(maskApiKey(`AIza${'b'.repeat(31)}wxyz`)).toBe('AIza…wxyz');
  });

  it('accepts only the two AI modes', () => {
    expect(isAiMode('managed')).toBe(true);
    expect(isAiMode('byok')).toBe(true);
    expect(isAiMode('free')).toBe(false);
  });
});
