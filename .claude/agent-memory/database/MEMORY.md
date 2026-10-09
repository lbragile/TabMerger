# Database Agent Memory

- [Cloud sync RLS gate (migration 019)](learnings_cloud_sync_rls_gate.md) — has_cloud_sync() gates INSERT/UPDATE on groups/sessions/device_sessions/shared_bundles/encryption_keys; SELECT/DELETE stay owner-only; entitled statuses come from ENTITLED_SUBSCRIPTION_STATUSES
- [has_cloud_sync() must mirror the client exactly](learnings_has_cloud_sync_mirrors_client.md) — don't guess a stricter status/period check than the client uses; tighten both sides together or the two gates disagree
- [Position-only updates keep updated_at (020)](learnings_position_only_updated_at.md) — groups_set_updated_at(); client updated_at always ignored; test trigger logic on scratch initdb if Docker is down
- [Server-managed table pattern (021)](learnings_server_managed_table_pattern.md) — profiles: select-only policy + API roles SELECT only; revoke list from relacl, end-state do-block check
- [Verifying RLS/grants on the local stack](learnings_local_rls_verification.md) — migration files are write-once (dry-run first); pgTAP runner limits; key-free HTTP check via the db container
