# Payments Security Reviewer Memory

- [Webhook retry review method](learnings_webhook_retry_review_method.md) — audit questions for a 500-to-redeliver, read-current-state webhook: permanent vs transient codes, constraints, concurrency, tests
- [Worker paid-action review method](learnings_worker_paid_action_review_method.md) — worker job that checks tier/identity then writes: identity re-check, sender checks, silent RLS UPDATE denial, client rotation vs server cap
- [Client file path review method](learnings_client_file_path_review_method.md) — settings that become a downloads path: who writes them, validate at use, token expansion, build-time test switches, guard-conditional writes
- [Mocked gate return values](learnings_mocked_gate_return_values.md) — check mocked entitlement/usage results are ones the real gate can return; require a real-gate test per unpaid account type
- [Sessions backup gate shape](learnings_sessions_backup_gate_shape.md) — backups gated by sessions RLS insert/update (has_cloud_sync), owner select/delete any tier; auto marker only in ciphertext so server can't count backups separately
- [Analytics vs privacy page](learnings_analytics_privacy_crosscheck.md) — cross-check GA4/PostHog identifiers sent from payments code against the privacy page wording
