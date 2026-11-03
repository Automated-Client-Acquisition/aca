# BYO Deployer

Long-running service that consumes `infra_byo_jobs` and SSHes into user-supplied
servers to install / configure / operate Postfix + OpenDKIM + Dovecot.

## Why a separate service

Supabase edge functions have ~60s wallclock budgets. `apt-get install postfix opendkim dovecot-imapd`
plus DKIM keygen plus first DNS verification routinely exceeds that. The deployer
also needs to hold long SSH sessions and stream logs back into
`infra_byo_jobs.log` so the wizard can show real-time progress.

## How it wakes up

1. `pg_notify('infra_byo_job_created', ...)` — fired by the AFTER INSERT trigger
   on `infra_byo_jobs`. The deployer holds an idle `LISTEN` connection.
2. `POST /jobs/run-now` (HMAC-signed) — edge functions call this to nudge the
   deployer immediately on top of NOTIFY (covers brief LISTEN disconnects).
3. 30s polling fallback — picks up jobs whose lease (`locked_until`) expired.

Claim is atomic via Supabase REST update with `WHERE id = ? AND status = 'pending'`.

## Running locally

```bash
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
# SMTP_ENCRYPTION_KEY (must match the one in Supabase function secrets),
# DEPLOYER_TRIGGER_SECRET (also set BYO_DEPLOYER_TRIGGER_SECRET in Supabase)

npm install
npm run dev
```

Deployer health check: `curl http://localhost:8080/health`.

## Deploying to Fly.io

```bash
# First-time setup
fly apps create aca-byo-deployer --org <your-org>
fly secrets set \
  SUPABASE_URL=https://...supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  SUPABASE_DB_URL=postgresql://postgres:...@db....supabase.co:5432/postgres \
  SMTP_ENCRYPTION_KEY=<64-hex-chars> \
  DEPLOYER_TRIGGER_SECRET=<32-hex-chars>

fly deploy

# Set Supabase secrets so edge functions can wake the deployer
supabase secrets set BYO_DEPLOYER_URL=https://aca-byo-deployer.fly.dev
supabase secrets set BYO_DEPLOYER_TRIGGER_SECRET=<same-as-above>
```

**Important:**
- Use the **direct** Postgres connection (port 5432), not the pooler — pgbouncer
  drops `LISTEN` connections.
- `SMTP_ENCRYPTION_KEY` MUST match what edge functions use, or decrypting SSH
  private keys will fail.
- Single instance only. Scaling horizontally without distributed claim
  semantics will cause double-execution on race conditions.

## Job types implemented

| job_type            | Phase | Status |
|---------------------|-------|--------|
| `connect`           | 2     | ✅ implemented |
| `deploy_base`       | 3     | TODO |
| `provision_domain`  | 3     | TODO |
| `provision_mailbox` | 4     | TODO |
| `attach_ip` / `detach_ip` | 5 | TODO |
| `verify_dns` / `test_port25` | 3 | TODO (verify_dns is in edge fn) |
| `rotate_ssh_key`    | 7     | TODO |
| `deprovision_*`     | 7     | TODO |
