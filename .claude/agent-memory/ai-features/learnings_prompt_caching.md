---
name: prompt-caching
description: Where each provider's prompt cache applies to the AI tasks (Claude system-block breakpoint, OpenAI caching off, Gemini implicit), cache prices and how metering/reservation price cache tokens
metadata:
  type: reference
---

**Claude (managed + own key):** `buildAiRequest` sends `system` as one text block with
`cache_control: {type:'ephemeral'}`, in both count and create. Never use top-level automatic caching:
it marks the last block, which is the unique `<tab_data>` turn, so it would only pay the 1.25x write.
- The prefix up to the breakpoint includes the structured-output format, which is injected as an extra system prompt ("changing output_config.format invalidates the cache"). It also includes the thinking/effort settings.
- Minimum cacheable prefix on the 5.x models is 512 tokens. A shorter prefix is a silent no-op with no write charge.
- By a chars/4 estimate, the instructions plus schema are about 150-470 tokens: organize is the closest to 512, nameGroup the furthest. The Claude 4.7+ tokenizer adds about 30%, so organize may clear the minimum. Only `count_tokens` can say for sure.
- Never interpolate request data into a task's system prompt. A test asserts it is identical across inputs.

**Claude cache prices** (checked against platform.claude.com/docs/en/about-claude/pricing): reads are 0.1x base on Haiku 5.5 ($0.01, or $0.05 over 100K tokens) and 0.05x on Sonnet 5.5 ($0.10) and Opus 5.5 ($0.20). Writes are 1.25x for 5 minutes and 2x for 1 hour. Re-check the live page before trusting a remembered read price.

**Metering:**
- `aiCallCredits(model, AiTokenUsage)` prices base input, 5m writes, 1h writes, reads and output separately. The `(model, input, output)` overload still works and means nothing was cached.
- Haiku's long-context tier uses the total input, cache tokens included. Models without `cacheReadCentsPerMTok` (the own-key models) price reads at the base rate.
- The reservation is `aiReservationCredits`: counted input plus a 2% margin (`AI_RESERVE_INPUT_MARGIN_PERCENT`), all priced as 5m writes, with the tier chosen from the padded total.
  - The margin matters at tier edges. Without it, a Haiku count of 100,000 reserved at the base tier while a real 100,001 settled at long-context prices, about 4x more.
- Settle (`usageCredits`) treats `cache_creation_input_tokens` as authoritative. The 1h count is `min(max(1h, 0), written)` and the rest are 5m writes.
- Logged:
  - any 1h write;
  - any positive settle delta (the reservation bound failed);
  - a non-global `inference_geo` or non-standard `service_tier` (warning).
- Non-finite usage: `settle()` refuses it and keeps the reservation. A non-finite count refuses the call before reserving.

**OpenAI (GPT-6.x = "GPT-5.6 and later"):**
- Cache writes cost 1.25x and reads 0.1x (0.05x on Sol). Minimum cacheable prefix is 1,024 visible tokens; hidden system content such as the schema doesn't count.
- The default implicit breakpoint is the end of the latest user message, which is our unique data turn. So requests send `prompt_cache_options: {mode:'explicit'}` with no breakpoints, which means no caching.
- `prompt_cache_key` only separates cache accounting on these models. Top-level `instructions` can't carry a breakpoint.
- Revisit if a task's instructions pass 1,024 tokens: they would move into a developer message whose `input_text` carries `prompt_cache_breakpoint: {mode:'explicit'}`.

**Gemini:** implicit caching is on by default and needs no request change. Explicit `cachedContents` needs per-key resources and a storage fee, has a 4,096-token minimum on 3.8 Flash and 4 Argon, and isn't supported on 4 Argon.

**Mock:** `lib/ai-mock.ts` reports writes, then reads (per model, prefix and 5-minute TTL) only for a marked prefix of ≥512 estimated tokens. Call `clearAiMockPromptCache()` in `beforeEach`.

Gotcha: Python `open(..., 'w')` on Windows writes CRLF. Use `newline=''` and keep the file's existing line endings. Also, `\\` escapes in Bash heredocs can reach the file unescaped, so use the Edit tool for source text that contains backslashes.

Related: [[ai-metering-flow]], [[own-key-providers]], [[ai-dev-mock]], [[model-request-settings]]
