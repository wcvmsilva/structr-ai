-- SEPARATE REVIEW CANDIDATE. Never execute standalone.
-- applyCalculatorDatabaseTempContainment owns a SERIALIZABLE transaction, checks
-- exact before metadata, executes these fixed bytes, checks exact after metadata,
-- and calls logAudit with verified readback before commit. Any failure rolls back.
-- Recipients are the enumerated pre-existing effective TEMP recipients, not an
-- inferred list of service accounts. No Calculator principal receives TEMP.
REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC;
GRANT TEMPORARY ON DATABASE postgres TO "anon", "authenticated", "authenticator", "pg_checkpoint", "pg_create_subscription", "pg_database_owner", "pg_execute_server_program", "pg_maintain", "pg_monitor", "pg_read_all_data", "pg_read_all_settings", "pg_read_all_stats", "pg_read_server_files", "pg_signal_backend", "pg_stat_scan_tables", "pg_use_reserved_connections", "pg_write_all_data", "pg_write_server_files", "pgbouncer", "service_role", "structr_estimate_read_owner_v1", "structr_intake_create_owner_v1", "structr_review_owner_v1", "structr_scope_workspace_read_owner_v1", "supabase_auth_admin", "supabase_etl_admin", "supabase_privileged_role", "supabase_read_only_user", "supabase_realtime_admin", "supabase_replication_admin", "supabase_storage_admin";
