# Database Agent Memory

- [Cloud sync RLS gate (migration 019)](learnings_cloud_sync_rls_gate.md) — has_cloud_sync() gates INSERT/UPDATE on groups/sessions/device_sessions/shared_bundles/encryption_keys; SELECT/DELETE stay owner-only; entitled statuses come from ENTITLED_SUBSCRIPTION_STATUSES
- [has_cloud_sync() must mirror the client exactly](learnings_has_cloud_sync_mirrors_client.md) — don't guess a stricter status/period check than the client uses; tighten both sides together or the two gates disagree
