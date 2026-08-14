-- Weighted credit metering: request_count now accumulates weighted credit
-- cost per call instead of a flat call count.
-- Rollback: alter table public.ai_usage rename column credits_used to request_count;
alter table public.ai_usage rename column request_count to credits_used;
