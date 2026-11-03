# aca-list-building-verifier

Fly.io worker for the List Building Engine's downstream stages: SMTP
verification, pattern permutation, and ICP scoring. Polls the
`lb_work_items` queue, uses a per-MX connection pool with adaptive
concurrency ramp, and enqueues the next stage via the
`list-building-enqueue-next` edge function.

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role for queue + writes |
| `OPENROUTER_API_KEY` | yes for ICP stage | ICP scoring |
| `WORKER_STAGES` | no (default `smtp,pattern,icp`) | Comma list of stages this worker claims |
| `HELO_DOMAIN` | no | EHLO domain for SMTP sessions |
| `MAIL_FROM` | no | MAIL FROM address for SMTP sessions |
| `PORT` | no (default 8080) | Health HTTP port |

## Deploy

```bash
cd workers/list-building-verifier
fly launch --no-deploy --copy-config --name aca-list-building-verifier
fly secrets set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  OPENROUTER_API_KEY=...
fly deploy
```

## Scaling

```bash
fly scale count 10 --region iad
```

Each machine claims an independent proxy from `lb_proxy_pool` via a
consistent hash of its `FLY_ALLOC_ID`, so N machines == N proxies used in
parallel (wraps around if N > pool size).

## Tuning via `worker_config`

Per-job tuning lives in `list_building_jobs.worker_config`:

```json
{
  "discovery_workers": 25,
  "dm_workers": 10,
  "pattern_workers": 50,
  "smtp_workers": 30,
  "icp_workers": 10,
  "batch_size": 100
}
```

`smtp_workers` caps the per-worker batch size on SMTP claims. The MX pool
further caps per-MX concurrency with adaptive ramp: on any `421` it
halves, on 10 consecutive `250`s it doubles (up to
`maxConcurrencyPerMx`).

## Health

`GET /health` returns `{ worker_id, uptime_s, in_flight, completed, failed, throughput_per_sec, stages, proxies }`.
