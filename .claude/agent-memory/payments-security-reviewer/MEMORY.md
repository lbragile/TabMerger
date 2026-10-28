# Payments Security Reviewer Memory

- [Webhook retry review method](learnings_webhook_retry_review_method.md) — audit questions for a 500-to-redeliver, read-current-state webhook: permanent vs transient codes, constraints, concurrency, tests
- [Worker paid-action review method](learnings_worker_paid_action_review_method.md) — worker job that checks tier/identity then writes: identity re-check, sender checks, silent RLS UPDATE denial, client rotation vs server cap
- [Client file path review method](learnings_client_file_path_review_method.md) — settings that become a downloads path: who writes them, validate at use, token expansion, build-time test switches, guard-conditional writes
- [Mocked gate return values](learnings_mocked_gate_return_values.md) — check mocked entitlement/usage results are ones the real gate can return; require a real-gate test per unpaid account type
- [Sessions backup gate shape](learnings_sessions_backup_gate_shape.md) — backups gated by sessions RLS insert/update (has_cloud_sync), owner select/delete any tier; auto marker only in ciphertext so server can't count backups separately
- [User-triggered resync review method](learnings_user_triggered_resync_review_method.md) — auditing a route that corrects a row from Stripe: key provenance, write-by-id, non-entitled only, revivable statuses
- [Pre-checkout Stripe guard review method](learnings_pre_checkout_stripe_guard_review_method.md) — ask-Stripe-before-selling: input fail-closed, resource_missing scope, expire-pass races, upward-write gates
- [Analytics vs privacy page](learnings_analytics_privacy_crosscheck.md) — cross-check GA4/PostHog identifiers sent from payments code against the privacy page wording
- [Refund after paid call](learnings_refund_after_paid_call_review_method.md) — credit refund audit (bounded? exact charge? once-flag?) + Workflow DevKit endpoint exposure, Vercel vs local world
- [Reserve/settle bound](learnings_reserve_settle_bound_review_method.md) — does the AI reservation bound settle? split vs total drift, tier thresholds, uncapped positive deltas, NaN path
- [Buy-button visibility](learnings_buy_button_visibility_review_method.md) — CTA show/hide changes: buy gate vs spend gate, what the old condition really covered, per-page flag drift
- [Prorated option switch](learnings_prorated_option_switch_review_method.md) — immediate two-way proration + allowance: round-trip math, usage month vs period, once-coupon credits, invoice-scaled allowance
- [Schedule release](learnings_schedule_release_review_method.md) — user-triggered schedule release: ownership chain, which schedules are releasable, cancel-then-renew path, landing race
- [Usage bucket vs billing period](learnings_usage_bucket_vs_billing_period.md) — calendar-month counter vs paid period: buckets per payment, dunning, upgrade shares, free pre-check calls
- [Amount-driven portal deferral](learnings_amount_driven_portal_deferral_review_method.md) — schedule_at_period_end conditions: pair-by-pair per-month check, stale sessions, restricted coupons, schedule locks, alarm shape
