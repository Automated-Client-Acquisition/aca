# aca-list-building-scraper

Fly.io Playwright worker for the ACA List Building Engine.

Endpoints:
- `GET  /health` — liveness + browser status
- `POST /scrape-companies` — company discovery (google_maps, google_search, directory/BBB, linkedin)
- `POST /scrape-dms` — decision-maker scraping from a company website

> **ToS note (spec section 10).** Respecting robots.txt is the client's
> responsibility. This worker does not consult robots.txt — it is intended
> for user-controlled prospecting workflows.

## Deploy

```bash
cd workers/list-building-scraper
fly launch --no-deploy --name aca-list-building-scraper --region iad
fly secrets set \
  SUPABASE_URL=https://<project>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
fly deploy
```

## Wire into edge functions

Set this secret on the Supabase project so `company-scraper.ts` and
`dm-scraper.ts` know where to reach the worker:

```bash
npx supabase secrets set LIST_BUILDING_SCRAPER_URL=https://aca-list-building-scraper.fly.dev
```

If `LIST_BUILDING_SCRAPER_URL` is unset, the shared modules fall back to
their native-fetch stub behavior so local dev keeps working without the
worker.

## Request shapes

### POST /scrape-companies
```json
{
  "query": { "niche": "solar installer", "geo": "Austin TX",
             "sources": ["google_maps","directory","linkedin"], "limit": 25 },
  "proxy": { "host": "x", "port": 8000, "username": "u", "password": "p" }
}
```
Returns `{ "companies": DiscoveredCompany[] }`.

### POST /scrape-dms
```json
{
  "website_url": "https://example.com",
  "linkedin_url": "https://linkedin.com/company/example",
  "proxy": { "host": "x", "port": 8000, "username": "u", "password": "p" }
}
```
Returns `{ "candidates": DMCandidate[] }`.

## Local dev

```bash
npm install
npx playwright install chromium
npm run dev
```
