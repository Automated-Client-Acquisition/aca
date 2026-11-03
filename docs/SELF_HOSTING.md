# Self-hosting ACA

ACA is three parts: a React app (static files), Supabase (Postgres, auth, storage and the edge
functions that hold the business logic) and Node workers for the long jobs (sending, inbox sync,
rendering). This guide sets up all three.

Self-hosting is supported by the community through GitHub
[discussions](https://github.com/seguelaCedric/aca/discussions) and issues. If you'd rather not
run it, [ACA Cloud](https://www.automatedclientacquisition.com) is $67 a month and includes support.

## What you need

- Node.js 22, Git, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/cli)
- A Supabase project: [Supabase Cloud](https://supabase.com) (simplest) or
  [self-hosted Supabase](https://supabase.com/docs/guides/self-hosting/docker)
- A host for the workers: any machine with Docker (a small VPS covers the `outreach` profile),
  or Fly.io
- A domain, with HTTPS, for the app, the API and the tracking links
- Your own provider accounts: an AI provider (OpenRouter, OpenAI, Ollama...) and, for LinkedIn,
  WhatsApp and Telegram, a Unipile account

```bash
git clone https://github.com/seguelaCedric/aca.git
cd aca
npm ci
cp .env.example .env
```

`.env.example` lists every variable, grouped by who reads it (frontend, edge functions, each
worker), with the required ones marked. Generate the encryption keys once and keep them safe:
losing them makes every stored key and mailbox password unreadable.

```bash
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 32   # SMTP_ENCRYPTION_KEY
openssl rand -hex 32   # CRON_SECRET
openssl rand -hex 32   # INTERNAL_WEBHOOK_SECRET
```

## 1. Database

The whole schema is one migration, `supabase/migrations/20261102000000_baseline.sql`.

**Supabase Cloud**

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

**Self-hosted Supabase**

```bash
supabase db push --db-url "postgresql://postgres:<password>@<host>:5432/postgres"
```

**On your machine, for development:** `supabase start` applies the baseline to a local stack.

Then, in the SQL editor (or `psql`):

1. Fill in and run `supabase/sql/vault_secrets.example.sql`. `supabase_url`,
   `supabase_service_role_key` and `supabase_anon_key` come from your project's API settings.
   `cron_secret` and `internal_webhook_secret` must equal the `CRON_SECRET` and
   `INTERNAL_WEBHOOK_SECRET` you generated above.
2. Run `supabase/sql/cron_jobs.sql` to schedule the background jobs. Some drive features you may
   not use; remove those with `select cron.unschedule('<job name>');`.

## 2. Edge functions

Put the "Edge functions" block of your `.env` in a file of its own (for example
`supabase/.env.functions`, which git ignores). At least:

| Variable | Value |
|---|---|
| `ACA_SELF_HOSTED` | `true` (turns off ACA Cloud billing and the hosted-only functions) |
| `APP_URL` | where the app runs, e.g. `https://aca.example.com` |
| `ENCRYPTION_KEY`, `SMTP_ENCRYPTION_KEY` | the keys you generated |
| `CRON_SECRET`, `INTERNAL_WEBHOOK_SECRET` | the same values as in Vault |
| `UNSUBSCRIBE_FALLBACK_HOST` | the public host of your tracking proxy (step 4) |
| `SUPPORT_EMAIL`, `OPS_EMAIL`, `EMAIL_FROM_DOMAIN`, `BRAND_NAME` | your own addresses and name |

```bash
supabase secrets set --env-file supabase/.env.functions
supabase functions deploy
```

`supabase/config.toml` already marks which functions skip JWT checks (webhooks and public
endpoints). On self-hosted Supabase, copy `supabase/functions` into the edge runtime's functions
volume and set the same variables on that container instead.

## 3. The app

In `.env`:

```bash
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable or anon key>
VITE_ACA_SELF_HOSTED=true
VITE_API_URL=https://api.example.com
MCP_URL=https://mcp.example.com/mcp
```

```bash
npm run build      # writes dist/
```

**Vercel:** `node scripts/oss/configure-vercel.mjs` writes `vercel.json` from
`oss/vercel.template.json` with your Supabase, API and MCP hosts filled in. Then deploy the folder
with the Vercel CLI or a Git integration.

**Anywhere else:** serve `dist/` as a single-page app (unknown paths fall back to `index.html`) and
copy the rewrites from `oss/vercel.template.json` into your proxy: they route `/v1/*` (the REST
API) and the MCP host to the matching edge functions.

Open the app and create your account at `/auth`. Signing up creates your organization.

## 4. Workers

```bash
docker compose --profile outreach up -d                    # sending, inbox sync, campaigns, tracking links
docker compose --profile outreach --profile leads up -d    # plus company analysis and list building
docker compose --profile all up -d                         # everything
```

Every worker reads the root `.env`; each worker's block in `.env.example` lists what it needs, at
least `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Each one answers `GET /health`, and compose
restarts any that stop answering.

Some workers poll the database and need nothing else: `campaign-processor`, `sequence-sender`,
`signal-engine`. The edge functions call the others, so put those behind HTTPS (a reverse proxy
such as Caddy, or a tunnel) and set the matching edge secret:

| Worker (profile) | Edge secret |
|---|---|
| `tracking-proxy` (outreach) | `UNSUBSCRIBE_FALLBACK_HOST`: its host only, e.g. `t.example.com` |
| `imap-poller` (outreach) | `IMAP_POLLER_WEBHOOK_URL`: `https://<host>/webhook-poll` |
| `email-sequence-generator` (outreach) | `EMAIL_SEQUENCE_WORKER_URL` |
| `company-analyzer` (leads) | `COMPANY_ANALYZER_URL` |
| `crawler` (leads) | `CRAWLER_BASE_URL` |
| `list-building-scraper` (leads) | `LIST_BUILDING_SCRAPER_URL` |
| `content-pipeline` (content) | `CONTENT_PIPELINE_WORKER_URL` |
| `text-generator` (content) | `TEXT_GENERATOR_WORKER_URL` |
| `carousel-renderer` (content) | `CAROUSEL_RENDERER_WORKER_URL` |
| `subtitle-renderer` (content) | `SUBTITLE_RENDERER_WORKER_URL` |
| `video-renderer` (content) | `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_WORKER_URL` |
| `web-capture` (content) | `WEB_CAPTURE_WORKER_URL` |
| `notion-generator` (content) | `NOTION_GENERATOR_WORKER_URL` |
| `byo-deployer` (infra) | `BYO_DEPLOYER_URL` |

After changing secrets, run `supabase secrets set` again; the functions pick them up on the next
request.

`sequence-sender` won't start with `ACA_SELF_HOSTED=true` until `UNSUBSCRIBE_FALLBACK_HOST` is set.
Without your own tracking proxy, unsubscribe links would point at ACA Cloud and your opt-outs would
be lost.

`video-renderer` uses [Remotion](https://www.remotion.dev/license), which needs a company license
for for-profit teams of four or more.

Each worker also has a `fly.toml` if you prefer Fly.io: `fly deploy -a <your-app-name>` from its
folder, with its variables set as Fly secrets.

## 5. Provider keys, storage and sending

- **Keys:** each organization adds its own under **Settings → API Keys** (OpenRouter, Replicate,
  ElevenLabs, Unipile, Apify, Pexels and more). A matching edge secret such as
  `OPENROUTER_API_KEY` is used for organizations that haven't added their own. A feature without a
  key tells you where to add one.
- **Storage:** generated images, video and audio go to the organization's storage under
  **Settings → Storage** (Cloudflare R2, AWS S3 or Backblaze B2), or to your Supabase Storage when
  none is set.
- **Mailboxes:** connect Microsoft 365, Google, or any SMTP and IMAP inbox under
  **Settings → Sending**.
- **Sending rules:** the unsubscribe link and header, suppression and stop-on-reply are on by
  default. Read [ACCEPTABLE_USE.md](../ACCEPTABLE_USE.md) before you send.

## ACA Network

The warmup network, the shared lead pool and Microsoft 365 tenants depend on shared
infrastructure, so they can't be self-hosted. A self-hosted install can use them through the
[ACA Network API](https://www.automatedclientacquisition.com/developers) with an approved account.

## Updating

```bash
git pull
npm ci
supabase db push                 # new migrations
supabase functions deploy
npm run build                    # then redeploy the app
docker compose --profile <yours> up -d --build
```
