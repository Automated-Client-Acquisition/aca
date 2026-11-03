-- Vault secrets the database functions and cron jobs read at call time.
-- Replace each placeholder and run once. Re-running fails on existing
-- names; use vault.update_secret to change a value.

SELECT vault.create_secret('<autoblog_orchestrator_secret>', 'autoblog_orchestrator_secret');
SELECT vault.create_secret('<cron_secret>', 'cron_secret');
SELECT vault.create_secret('<internal_webhook_secret>', 'internal_webhook_secret');
SELECT vault.create_secret('<signal_engine_secret>', 'signal_engine_secret');
SELECT vault.create_secret('<signal_engine_url>', 'signal_engine_url');
SELECT vault.create_secret('<supabase_anon_key>', 'supabase_anon_key');
SELECT vault.create_secret('<supabase_service_role_key>', 'supabase_service_role_key');
SELECT vault.create_secret('<supabase_url>', 'supabase_url');
