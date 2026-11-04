import { describe, it, expect } from 'vitest';
import {
  AI_ACTIONS,
  AI_CACHE_WRITE_MULTIPLIER,
  AI_MAX_GROUP_DESCRIPTION_LENGTH,
  AI_RESERVE_INPUT_MARGIN_PERCENT,
  AI_COST_SHARE_PERCENT,
  AI_ESTIMATE_EXAMPLES,
  AI_MODEL_IDS,
  AI_MODELS,
  AI_NAME_GROUP_SUGGESTIONS,
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
  aiReservationCredits,
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

describe('prompt-cache pricing', () => {
  const claudeModels = AI_MODEL_IDS.filter((id) => AI_MODELS[id].provider === 'anthropic');

  it('has a cache-read price below the input price for every Claude model', () => {
    for (const model of claudeModels) {
      const info = AI_MODELS[model];
      expect(info.cacheReadCentsPerMTok).toBeDefined();
      expect(info.cacheReadCentsPerMTok!).toBeLessThan(info.inputCentsPerMTok);
      if (info.longContext) expect(info.longContext.cacheReadCentsPerMTok!).toBeLessThan(info.longContext.inputCentsPerMTok);
    }
  });

  it('prices cache reads at each model read rate (Opus 5.5 $0.20, Sonnet 5.5 $0.10, Haiku 5.5 $0.01 per MTok)', () => {
    const read = (model: (typeof AI_MODEL_IDS)[number]) =>
      aiCallCredits(model, { inputTokens: 0, cacheReadTokens: 1_000_000, outputTokens: 0 });
    expect(read('claude-opus-5-5')).toBe(200);
    expect(read('claude-sonnet-5-5')).toBe(100);
    // Haiku 5.5 is priced per tier, so stay under 100K: 100,000 reads x $0.01/MTok = $0.001.
    expect(aiCallCostUsd('claude-haiku-5-5', { inputTokens: 0, cacheReadTokens: 100_000, outputTokens: 0 })).toBeCloseTo(0.001, 12);
  });

  it('prices 5-minute writes at 1.25x and 1-hour writes at 2x the base input price', () => {
    expect(AI_CACHE_WRITE_MULTIPLIER).toEqual({ ephemeral5m: 1.25, ephemeral1h: 2 });
    const write = (model: (typeof AI_MODEL_IDS)[number], ttl: '5m' | '1h') =>
      aiCallCredits(model, {
        inputTokens: 0,
        [ttl === '5m' ? 'cacheWrite5mTokens' : 'cacheWrite1hTokens']: 1_000_000,
        outputTokens: 0,
      });
    expect(write('claude-opus-5-5', '5m')).toBe(5_000); // $5
    expect(write('claude-opus-5-5', '1h')).toBe(8_000); // $8
    expect(write('claude-sonnet-5-5', '5m')).toBe(2_500); // $2.50
    // Haiku 5.5 under its 100K tier: 100,000 tokens at $0.125 and $0.20 per MTok.
    const haikuWrite = (key: 'cacheWrite5mTokens' | 'cacheWrite1hTokens') =>
      aiCallCostUsd('claude-haiku-5-5', { inputTokens: 0, [key]: 100_000, outputTokens: 0 });
    expect(haikuWrite('cacheWrite5mTokens')).toBeCloseTo(0.0125, 12);
    expect(haikuWrite('cacheWrite1hTokens')).toBeCloseTo(0.02, 12);
  });

  it('adds up base, write, read and output tokens', () => {
    // Opus 5.5: 1,000 x $4 + 2,000 x $5 + 10,000 x $0.20 + 500 x $20 (per MTok) = $0.026.
    expect(
      aiCallCredits('claude-opus-5-5', {
        inputTokens: 1_000,
        cacheWrite5mTokens: 2_000,
        cacheReadTokens: 10_000,
        outputTokens: 500,
      })
    ).toBe(26);
    expect(
      aiCallCostUsd('claude-opus-5-5', { inputTokens: 1_000, cacheWrite5mTokens: 2_000, cacheReadTokens: 10_000, outputTokens: 500 })
    ).toBeCloseTo(0.026, 9);
  });

  it('matches the (input, output) form when nothing is cached', () => {
    for (const model of AI_MODEL_IDS) {
      expect(aiCallCredits(model, { inputTokens: 18_300, outputTokens: 1_500 })).toBe(aiCallCredits(model, 18_300, 1_500));
      expect(aiCallCostUsd(model, { inputTokens: 18_300, outputTokens: 1_500 })).toBe(aiCallCostUsd(model, 18_300, 1_500));
    }
  });

  it('picks the Haiku 5.5 long-context tier from the total input, cache tokens included', () => {
    // 100,000 read tokens alone stay in the base tier: 100,000 x $0.01/MTok = $0.001.
    expect(aiCallCredits('claude-haiku-5-5', { inputTokens: 0, cacheReadTokens: 100_000, outputTokens: 0 })).toBe(1);
    // One more uncached token crosses 100K: 1 x $0.50 + 100,000 x $0.05 (per MTok) = $0.0050005.
    expect(aiCallCredits('claude-haiku-5-5', { inputTokens: 1, cacheReadTokens: 100_000, outputTokens: 0 })).toBe(6);
  });

  it('prices reads at the input rate on own-key models without a cache-read price', () => {
    expect(AI_MODELS['gpt-6-luna'].cacheReadCentsPerMTok).toBeUndefined();
    // 100,000 tokens (under its 272K tier) at the $0.10/MTok input price.
    expect(aiCallCostUsd('gpt-6-luna', { inputTokens: 0, cacheReadTokens: 100_000, outputTokens: 0 })).toBeCloseTo(0.01, 12);
  });

  it('clamps negative and rounds up fractional token counts', () => {
    expect(aiCallCredits('claude-opus-5-5', { inputTokens: -5, cacheReadTokens: -1, outputTokens: 0 })).toBe(0);
    expect(aiCallCredits('claude-opus-5-5', { inputTokens: 0, cacheReadTokens: 0.2, outputTokens: 0 })).toBe(1);
  });
});

describe('aiReservationCredits', () => {
  it('prices the counted input plus a 2% margin as 5-minute cache writes', () => {
    expect(AI_RESERVE_INPUT_MARGIN_PERCENT).toBe(2);
    // (10,000 + 200) x $5 + 1,000 x $20 (per MTok) on Opus 5.5 = $0.071.
    expect(aiReservationCredits('claude-opus-5-5', 10_000, 1_000)).toBe(71);
    expect(aiReservationCredits('claude-opus-5-5', 10_000, 1_000)).toBe(
      aiCallCredits('claude-opus-5-5', { inputTokens: 0, cacheWrite5mTokens: 10_200, outputTokens: 1_000 })
    );
    expect(aiReservationCredits('claude-opus-5-5', 0, 0)).toBe(0);
    expect(aiReservationCredits('claude-opus-5-5', Number.NaN, 100)).toBeNaN();
  });

  it('covers a real total just over a long-context threshold when the count is at or just under it', () => {
    const tiered = AI_MODEL_IDS.filter((id) => AI_MODELS[id].longContext);
    expect(tiered).toEqual(expect.arrayContaining(['claude-haiku-5-5', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']));
    const maxOutput = 2_048;
    for (const model of tiered) {
      const threshold = AI_MODELS[model].longContext!.thresholdTokens;
      for (const counted of [threshold - 1, threshold]) {
        const reserved = aiReservationCredits(model, counted, maxOutput);
        const real = threshold + 1; // billed at the long-context prices
        const splits = [
          { inputTokens: real },
          { inputTokens: 0, cacheWrite5mTokens: real },
          { inputTokens: 1_000, cacheWrite5mTokens: real - 51_000, cacheReadTokens: 50_000 },
        ];
        for (const split of splits) {
          for (const outputTokens of [0, maxOutput]) {
            expect(aiCallCredits(model, { ...split, outputTokens })).toBeLessThanOrEqual(reserved);
          }
        }
      }
    }
    // The reported case: Haiku 5.5 counted at 100,000, billed at 100,001.
    expect(aiReservationCredits('claude-haiku-5-5', 100_000, 1_100)).toBeGreaterThanOrEqual(
      aiCallCredits('claude-haiku-5-5', { inputTokens: 100_001, outputTokens: 1_100 })
    );
  });

  it('covers a real total up to the margin above the count', () => {
    for (const model of AI_MODEL_IDS) {
      for (const counted of [50, 1_000, 97_000, 99_000, 266_000, 270_000]) {
        const reserved = aiReservationCredits(model, counted, 500);
        const real = Math.floor(counted * 1.02);
        expect(aiCallCredits(model, { inputTokens: 0, cacheWrite5mTokens: real, outputTokens: 500 })).toBeLessThanOrEqual(reserved);
      }
    }
  });

  it('is never less than the settled cost, however the input splits into base, write and read tokens', () => {
    const claudeModels = AI_MODEL_IDS.filter((id) => AI_MODELS[id].provider === 'anthropic');
    for (const model of claudeModels) {
      for (const counted of [1, 600, 4_321, 99_999, 100_000, 100_001, 250_000]) {
        const reserved = aiReservationCredits(model, counted, 2_048);
        const step = Math.max(1, Math.floor(counted / 7));
        for (let written = 0; written <= counted; written += step) {
          for (let read = 0; read <= counted - written; read += step) {
            const usage = { inputTokens: counted - written - read, cacheWrite5mTokens: written, cacheReadTokens: read };
            for (const outputTokens of [0, 1, 2_048]) {
              expect(aiCallCredits(model, { ...usage, outputTokens })).toBeLessThanOrEqual(reserved);
            }
          }
        }
      }
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

describe('estimates for every action', () => {
  it('gives every action a positive, finite estimate on every model', () => {
    for (const action of AI_ACTIONS) {
      for (const model of AI_MODEL_IDS) {
        expect(estimateAiCredits(model, action, 10)).toBeGreaterThan(0);
        const usd = estimateAiCostUsd(model, action, 10);
        expect(Number.isFinite(usd) && usd > 0).toBe(true);
      }
    }
  });

  it('estimates describe-group as a short answer: above name-group, far below organize', () => {
    expect(estimateAiCredits('claude-haiku-5-5', 'describeGroup', 10)).toBe(1);
    expect(estimateAiCredits('claude-sonnet-5-5', 'describeGroup', 10)).toBe(3);
    expect(estimateAiCredits('claude-opus-5-5', 'describeGroup', 10)).toBe(12);
    for (const model of AI_MODEL_IDS) {
      expect(estimateAiCostUsd(model, 'describeGroup', 10)).toBeGreaterThan(estimateAiCostUsd(model, 'nameGroup', 10));
      expect(estimateAiCostUsd(model, 'describeGroup', 10)).toBeLessThan(estimateAiCostUsd(model, 'organize', 10));
    }
  });

  it('estimates name-group for 3 suggestions: about 40 output tokens, below describe-group', () => {
    expect(AI_NAME_GROUP_SUGGESTIONS).toBe(3);
    for (const model of AI_MODEL_IDS) {
      // 10 tabs: 300 prompt tokens + 60 per tab in, 40 answer tokens (plus typical thinking) out.
      const output = 40 + AI_MODELS[model].typicalThinkingTokens;
      expect(estimateAiCostUsd(model, 'nameGroup', 10)).toBeCloseTo(aiCallCostUsd(model, 900, output), 12);
      expect(estimateAiCredits(model, 'nameGroup', 10)).toBe(aiCallCredits(model, 900, output));
      expect(estimateAiCostUsd(model, 'nameGroup', 10)).toBeLessThan(estimateAiCostUsd(model, 'describeGroup', 10));
    }
    expect(estimateAiCredits('claude-haiku-5-5', 'nameGroup', 10)).toBe(1);
  });

  it('grows the describe-group estimate with the tab count', () => {
    expect(estimateAiCostUsd('claude-haiku-5-5', 'describeGroup', 100)).toBeGreaterThan(
      estimateAiCostUsd('claude-haiku-5-5', 'describeGroup', 10),
    );
  });
});

describe('describe group', () => {
  it('is an AI action', () => {
    expect(AI_ACTIONS).toContain('describeGroup');
  });

  it('runs on each provider\'s cheapest model under auto, like name-group', () => {
    for (const provider of AI_PROVIDERS) {
      expect(AUTO_AI_MODELS[provider].describeGroup).toBe(aiModelsForProvider(provider)[0]);
      expect(AUTO_AI_MODELS[provider].describeGroup).toBe(AUTO_AI_MODELS[provider].nameGroup);
      expect(resolveAiModel('auto', 'describeGroup', provider)).toBe(aiModelsForProvider(provider)[0]);
    }
    expect(AUTO_AI_MODEL.describeGroup).toBe('claude-haiku-5-5');
  });

  it('caps the description at 300 characters', () => {
    expect(AI_MAX_GROUP_DESCRIPTION_LENGTH).toBe(300);
  });
});

describe('auto models', () => {
  it('cover every action on every provider', () => {
    for (const provider of AI_PROVIDERS) {
      expect(Object.keys(AUTO_AI_MODELS[provider]).sort()).toEqual([...AI_ACTIONS].sort());
    }
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
