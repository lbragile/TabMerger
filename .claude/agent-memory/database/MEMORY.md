# Database Agent Memory

- [Cloud sync RLS gate (migration 019)](learnings_cloud_sync_rls_gate.md) — has_cloud_sync() gates INSERT/UPDATE on groups/sessions/device_sessions/shared_bundles/encryption_keys; SELECT/DELETE stay owner-only; entitled statuses come from ENTITLED_SUBSCRIPTION_STATUSES
- [has_cloud_sync() must mirror the client exactly](learnings_has_cloud_sync_mirrors_client.md) — don't guess a stricter status/period check than the client uses; tighten both sides together or the two gates disagree
- [Position-only updates keep updated_at (020)](learnings_position_only_updated_at.md) — groups_set_updated_at(); client updated_at always ignored; test trigger logic on scratch initdb if Docker is down
- [Server-managed table pattern (021)](learnings_server_managed_table_pattern.md) — profiles: select-only policy + API roles SELECT only; revoke list from relacl, end-state do-block check
- [RLS refusal shapes per statement](learnings_rls_refusal_shapes.md) — insert/upsert raise 42501, update/delete are silent zero rows; pgTAP assertions for each; negative-control recipe
- [Verifying RLS/grants on the local stack](learnings_local_rls_verification.md) — migration files are write-once (dry-run first); pgTAP runner limits; key-free HTTP check via the db container
- [Atomic quota RPC (022)](learnings_atomic_quota_rpc.md) — one-statement reserve via insert..on conflict..where; revoke function EXECUTE from anon/authenticated by name; re-run-safe conversion
- [CLI runs a migration as one transaction](learnings_cli_migration_transaction.md) — set local lock_timeout works; a raise records nothing; probe recipe via --workdir
- [Testing a privilege revoke (023)](learnings_privilege_layer_tests.md) — which pgTAP asserts flip, TRUNCATE ignores RLS, column-privilege limits, keep older policy tests green
