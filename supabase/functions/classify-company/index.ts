/**
 * classify-company — derive a company's real category from its own website.
 *
 * The 123M-row pool's firmographics cannot be trusted: `sic_code` is
 * multi-valued where present and null for most rows, 12M rows carry a corrupted
 * `p_industry`, and there is no date column anywhere so nothing can be aged.
 * Filtering on those fields silently returns the wrong set. This replaces them
 * with a category derived from the one source that is current by definition —
 * the company's live homepage.
 *
 * Deliberately metadata-only: <title>, <meta description> and <h1>. Measured on
 * a 200-domain sample, that yields usable text for ~74% of live domains at
 * ~27k domains/hour with no crawler, no rendering and no JS. Full scraping is a
 * separate, later tier for the ~21% that return nothing.
 *
 * Results are cached in crm_companies keyed by normalized_domain, so a domain
 * is classified once and never again — across every list and every future build.
 * That is what turns this from a per-build cost into a one-time one.
 *
 * A domain whose page cannot be read is NOT classified. There is no fallback
 * to the company name: names describe what a business is called, not what it
 * does, and the model reasons from vocabulary when given one ("Gardner
 * Resources" → staffing_recruiting, "Home Technologies often HVAC"). Measured
 * on the 1-10 employee band, that produced 37.5% of all output. Unreadable
 * domains come back in `unreachable_domains` for the caller to retry, scrape
 * or drop.
 *
 * Do NOT feed the pool's person `title` field in either: it is not a job title.
 * Roofing companies come back with people titled "Trucking" and "Dental".
 *
 * POST { domains: string[] | Array<{domain, company_name?}>, force?, model? }
 */

import {
  ApiError,
  createResource,
  json,
} from '../_shared/rest-api.ts';
import { fetchChatCompletions, decryptApiKey } from '../_shared/llm-client.ts';
import {
  buildPrompt,
  parseResponse,
  type ClassificationInput,
  type Classification,
} from '../_shared/company-taxonomy.ts';

/** Domains per request. Bounded by the metadata fetch, not the model. */
const MAX_DOMAINS = 50;

/** Companies per LLM call. Small enough that one bad row can't poison a big batch. */
const LLM_BATCH = 20;

const FETCH_TIMEOUT_MS = 12000;
const FETCH_CONCURRENCY = 15;

/**
 * Cheap by design. The task is "pick one slug from a closed list given ~40
 * words" — a small model does that as well as a large one, and the closed
 * taxonomy (not the model size) is what makes it consistent. So pick almost
 * purely on price.
 *
 * OpenRouter list price, checked 2026-08-09, USD per 1M tokens in/out:
 *   qwen/qwen3.7-flash             0.030 / 0.130   ← default
 *   google/gemini-2.5-flash-lite   0.100 / 0.400
 *   google/gemini-2.5-flash        0.300 / 2.500
 *
 * Measured on the same 24 domains: the two cheap models agree 75% of the time
 * and neither is clearly better on the disagreements (qwen wins BIC and Caruso
 * Logistics, gemini wins Chaparral Insulation and 4 Star Fab). Quality is a
 * wash, so price decides — roughly $5 vs $17 per 750k domains.
 *
 * HEADLINE PRICE IS NOT COST. qwen3.7-flash is a reasoning model: left to
 * itself it spent 4000 of 4002 completion tokens on `reasoning_tokens`, hit
 * finish_reason='length', returned empty content and classified NOTHING — while
 * costing about twice what gemini-flash-lite costs to do the job properly.
 * `reasoning: { enabled: false }` below is load-bearing, not a tuning knob.
 * `effort: 'low'` was not enough. Re-measure before swapping in any model.
 */
const DEFAULT_MODEL = 'qwen/qwen3.7-flash';

/**
 * A real browser UA. The polite bot string was being refused by hosts that
 * serve fine to browsers — swapping it, adding the www. variant and raising the
 * timeout to 12s took readability from ~45% to 52.5% on a 514-domain sample,
 * with no new infrastructure.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Bytes to read per page. We need the <head>, not the document — see the note
 * in fetchMeta. 32 KB is the knee of the curve: 81% of pages complete, ~10% of
 * the bandwidth of a full download.
 */
const HEAD_BYTES = 32 * 1024;

/** Read at most `limit` bytes, then abort the transfer. */
async function readCapped(res: Response, limit: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    // Cancel rather than drain — this is what actually stops the bytes.
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/**
 * Error pages, WAF interstitials and parking pages, several of which are served
 * with HTTP 200. Treating these as page text is worse than having no page: the
 * model answers from the company name but the caller believes a site confirmed
 * it, so the confidence is inflated.
 */
const ERROR_PAGE =
  /\b(4\d{2}|5\d{2})\b.*(forbidden|not found|error|unavailable|unreachable)|forbidden|access denied|not acceptable|origin is unreachable|just a moment|attention required|checking your browser|are you a robot|site can'?t be reached|domain (is )?for sale|buy this domain|under construction|coming soon|default web page|shared hosting platform|web hosting default|this site is hosted by|welcome to nginx|apache2 (ubuntu|debian) default/i;

/** Strip scheme/www/path so cache keys match across sources. */
function normalizeDomain(raw: string): string {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .replace(/\.$/, '');
}

function clean(s: string | undefined, max = 220): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

interface PageMeta {
  domain: string;
  reachable: boolean;
  title: string;
  description: string;
  h1: string;
  /**
   * Why the page could not be read. Recorded because the responses differ
   * completely: `no_dns`, `conn_failed` and `parked` are permanently dead —
   * about 61% of failures — and pointing a rendering cluster at them is pure
   * waste. `js_or_empty` is the slice a headless browser actually fixes.
   */
  reason?: 'no_dns' | 'conn_failed' | 'http_4xx' | 'http_5xx' | 'parked' | 'js_or_empty' | 'thin';
}

/** One GET, capped read, no rendering. https first, http as fallback. */
async function fetchMeta(domain: string): Promise<PageMeta> {
  const empty: PageMeta = { domain, reachable: false, title: '', description: '', h1: '' };
  let reason: PageMeta['reason'] | undefined;
  let sawDns = false;

  // Try the bare host and the www. variant, https before http. Plenty of small
  // business sites answer on only one of the four.
  const attempts = [
    `https://${domain}`, `https://www.${domain}`,
    `http://${domain}`, `http://www.${domain}`,
  ];

  for (const url of attempts) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);

      // A non-2xx body is an error page, not the company's site. Without this
      // check a Cloudflare 523 or a 403 gets stored as page text and the model
      // then answers from the company name while reporting HIGH confidence, as
      // though a real page had confirmed it. Fall through so the caller routes
      // it to the name-only tier, which caps confidence at medium.
      sawDns = true;
      if (!res.ok) {
        reason = res.status >= 500 ? 'http_5xx' : 'http_4xx';
        continue;
      }

      // Stream and STOP at HEAD_BYTES rather than res.text(), which downloads
      // the whole document before slicing. Measured over 75 live pages: the
      // mean page is 317 KB but the median byte offset at which title plus
      // description/h1 are both available is 1.4 KB. Capping at 32 KB leaves
      // 81% of pages fully complete for 9.6% of the bandwidth, and the rest
      // still yield a title (which is almost always in the first 2 KB).
      const html = await readCapped(res, HEAD_BYTES);

      const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
      const description = clean(
        html.match(/<meta[^>]+name=["']?description["']?[^>]*content=["']([\s\S]*?)["']/i)?.[1] ??
        html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i)?.[1],
      );
      const h1 = clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' '));

      // Some hosts serve an error or interstitial with HTTP 200. Judge the
      // text, not just the status. Decode common whitespace entities first:
      // shared-hosting placeholders often write "Shared&#32;Hosting", which the
      // model understands but a literal pre-model regex otherwise misses.
      const errorText = `${title} ${description} ${h1}`
        .replace(/&(?:nbsp|#32|#x20);/gi, ' ');
      if (ERROR_PAGE.test(errorText)) { reason = 'parked'; continue; }

      // No usable tags but real copy on the page: use the copy. We already paid
      // to download it, and it is still the company describing itself.
      if ((title + description + h1).trim().length < 12) {
        // Strip scripts, styles, SVG, noscript AND head entirely before taking
        // text. The naive version leaked CSS rules and tag soup into the prompt
        // — measured at 9.4% of all classified rows, where the model dutifully
        // reported "CSS variables only" and returned unclear at high
        // confidence. Then require it to look like prose: enough letters, and
        // no CSS punctuation.
        const stripped = html
          .replace(/<head[\s\S]*?<\/head>/gi, ' ')
          .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/<[^>]+>/g, ' ');
        const body = clean(stripped.replace(/&[a-z#0-9]+;/gi, ' '), 400);
        const letters = (body.match(/[a-z]/gi) || []).length;
        const looksLikeCss = /[{};:]{2,}|--[a-z-]+\s*:/i.test(body);
        // The page may have no title/description/H1 and put the hosting or
        // parking message only in body copy. Run the parked-page guard again
        // after body extraction, before treating that copy as company evidence.
        if (ERROR_PAGE.test(body)) { reason = 'parked'; continue; }
        if (body.length >= 60 && letters / body.length > 0.6 && !looksLikeCss) {
          return { domain, reachable: true, title, description: body, h1 };
        }
        // Served 200 with no readable copy: a client-rendered shell. This is
        // the population a headless browser would recover.
        reason = body.length > 0 ? 'thin' : 'js_or_empty';
        continue;
      }

      return { domain, reachable: true, title, description, h1 };
    } catch (err) {
      // Deno surfaces DNS and connect failures as the same error type; the
      // message is the only discriminator available.
      const msg = String(err instanceof Error ? err.message : err).toLowerCase();
      if (!sawDns && (msg.includes('dns') || msg.includes('name not resolved'))) reason = 'no_dns';
      else if (!reason) reason = 'conn_failed';
      continue;
    }
  }
  return { ...empty, reason: reason ?? 'conn_failed' };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

Deno.serve(createResource({
  POST: async ({ supabase, caller, body }) => {
    const raw = body.domains;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ApiError('domains[] is required and must be non-empty');
    }
    if (raw.length > MAX_DOMAINS) {
      throw new ApiError(`Maximum ${MAX_DOMAINS} domains per request (received ${raw.length})`);
    }

    // Accept bare strings or {domain, company_name}. The name is used ONLY to
    // label the crm_companies row — it is never shown to the classifier. See
    // the note in company-taxonomy.ts.
    const nameByDomain = new Map<string, string>();
    const domains: string[] = [];
    for (const entry of raw as Array<unknown>) {
      const rawDomain = typeof entry === 'string'
        ? entry
        : String((entry as Record<string, unknown>)?.domain ?? '');
      const d = normalizeDomain(rawDomain);
      if (!d || domains.includes(d)) continue;
      domains.push(d);
      const nm = typeof entry === 'object' && entry
        ? String((entry as Record<string, unknown>).company_name ?? '').trim()
        : '';
      if (nm && nm !== '\\N') nameByDomain.set(d, nm.slice(0, 120));
    }
    const force = body.force === true;

    /* ── Cache ───────────────────────────────────────────────── */
    const cached = new Map<string, Classification>();
    // A platform job (pool classification) has no organization. crm_companies
    // is org-scoped, so there is nothing to read and nothing it should write —
    // its results go to the global lead_pool_verified instead. Skipping keeps
    // shared-infrastructure work out of any tenant's CRM.
    const orgScoped = Boolean(caller.organization_id);
    if (!force && orgScoped) {
      const { data, error } = await supabase
        .from('crm_companies')
        .select('normalized_domain, industry, enrichment_data')
        .eq('organization_id', caller.organization_id)
        .in('normalized_domain', domains);

      if (error) throw new Error(`cache lookup failed: ${error.message}`);

      for (const row of data ?? []) {
        const cls = (row.enrichment_data ?? {})?.classification;
        // Only a row classified by THIS pipeline counts as a hit — a company
        // created by an import has an `industry` from the same untrusted source
        // we are trying to replace.
        if (row.normalized_domain && cls?.category) {
          cached.set(row.normalized_domain, {
            domain: row.normalized_domain,
            category: cls.category,
            confidence: cls.confidence ?? 'low',
            location: cls.location ?? null,
            evidence: cls.evidence ?? null,
          });
        }
      }
    }

    const todo = domains.filter((d) => !cached.has(d));
    if (todo.length === 0) {
      return json({
        success: true,
        classified: 0,
        from_cache: cached.size,
        unreachable: 0,
        data: [...cached.values()],
      });
    }

    /* ── Metadata ────────────────────────────────────────────── */
    const metas = await mapLimit(todo, FETCH_CONCURRENCY, fetchMeta);
    const withText = metas.filter((m) => (m.title + m.description + m.h1).trim().length >= 12);
    // No readable page means no evidence of what the company does. There is no
    // name-based fallback: see the note in company-taxonomy.ts. These come back
    // as `unreachable` so the caller can decide (retry later, scrape, or drop).
    const unreachable = metas.filter((m) => !withText.includes(m));

    /* ── Model ───────────────────────────────────────────────── */
    const results: Classification[] = [];
    let servedModel: string | undefined;
    // Surfaced in the response, not just console: a model that returns a shape
    // this can't parse fails SILENTLY as "classified: 0", which looks identical
    // to "nothing to do". Swapping models is routine, so the failure has to be
    // visible at the call site.
    const parseErrors: Array<Record<string, unknown>> = [];
    if (withText.length > 0) {
      const model = typeof body.model === 'string' && body.model ? body.model : DEFAULT_MODEL;

      let openRouterApiKey: string | undefined;
      if (!model.startsWith('ollama:')) {
        if (orgScoped) {
          const { data: keyRow } = await supabase
            .from('api_keys')
            .select('key_encrypted')
            .eq('organization_id', caller.organization_id)
            .eq('provider', 'openrouter')
            .maybeSingle();
          if (!keyRow?.key_encrypted) {
            throw new ApiError(
              'No OpenRouter key for this organization. Add one in Settings, or pass an ollama: model.',
              400,
            );
          }
          openRouterApiKey = await decryptApiKey(keyRow.key_encrypted);
        } else {
          // Platform job (bulk pool classification): no org, so no tenant key
          // to read — and reaching for one would bill a customer for work that
          // benefits every org. Uses the platform's own key, same reasoning as
          // MOLTSETS_API_KEY in pool-enrich-tick.
          openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
          if (!openRouterApiKey) {
            throw new ApiError(
              'Platform classification requires OPENROUTER_API_KEY to be configured. ' +
                'It must not fall back to a tenant key: classifying the shared pool ' +
                'benefits everyone and cannot be billed to one organization.',
              500,
            );
          }
        }
      }

      for (let i = 0; i < withText.length; i += LLM_BATCH) {
        const slice = withText.slice(i, i + LLM_BATCH);
        const inputs: ClassificationInput[] = slice.map((m) => ({
          domain: m.domain,
          title: m.title,
          description: m.description,
          h1: m.h1,
        }));

        const response = await fetchChatCompletions(
          {
            model,
            messages: [{ role: 'user', content: buildPrompt(inputs) }],
            // Deterministic: same page must yield the same slug on every run,
            // or the cache would encode whatever the model felt like that day.
            temperature: 0,
            // Generous: a reasoning-capable model spends budget before it
            // emits, and a truncated reply parses as zero classifications.
            max_tokens: 4000,
            // Ask OpenRouter to keep reasoning minimal where the model
            // supports it — this task needs a lookup, not deliberation.
            reasoning: { enabled: false },
          },
          { openRouterApiKey, supabase, organizationId: caller.organization_id },
        );

        if (!response.ok) {
          throw new ApiError(`model call failed: ${(await response.text()).slice(0, 200)}`, 502);
        }
        const payload = await response.json();
        // What the provider actually SERVED, which can differ from what was
        // requested — OpenRouter routes a slug to whichever backend is up. The
        // cached category outlives the model that produced it, so record the
        // served id: without it you cannot tell which rows to re-classify when
        // you change models or a model changes under you.
        servedModel = String(payload?.model ?? servedModel ?? model);
        const choice = payload?.choices?.[0] ?? {};
        // Reasoning models return an empty `content` and put their output in
        // `reasoning`, or spend the whole token budget thinking and emit
        // nothing at all (finish_reason='length'). Both look like success at
        // the HTTP layer, so fall back explicitly rather than silently
        // classifying zero rows.
        const content = choice?.message?.content || choice?.message?.reasoning || '';
        const finish = String(choice?.finish_reason ?? '');
        try {
          results.push(...parseResponse(String(content), inputs));
        } catch (err) {
          // One unparseable batch must not lose the others.
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[classify-company] parse failed', msg);
          parseErrors.push({
            error: msg,
            finish_reason: finish,
            usage: payload?.usage ?? null,
            sample: String(content).slice(0, 400),
          });
        }
      }

    }

    /* ── Cache write ─────────────────────────────────────────── */
    // Platform jobs skip this entirely: crm_companies belongs to a tenant, and
    // pool classification is shared-infrastructure work whose results land in
    // the global lead_pool_verified. Writing here would put thousands of
    // unrelated companies into whichever org happened to trigger the sweep.
    for (const r of orgScoped ? results : []) {
      const meta = withText.find((m) => m.domain === r.domain);
      const { data: existing } = await supabase
        .from('crm_companies')
        .select('id, enrichment_data')
        .eq('organization_id', caller.organization_id)
        .eq('normalized_domain', r.domain)
        .maybeSingle();

      const enrichment = {
        ...(existing?.enrichment_data ?? {}),
        classification: {
          category: r.category,
          confidence: r.confidence,
          location: r.location,
          evidence: r.evidence,
          source: 'metadata',
          model: servedModel ?? null,
          classified_at: new Date().toISOString(),
        },
        page_meta: meta ? { title: meta.title, description: meta.description } : undefined,
      };

      if (existing?.id) {
        await supabase.from('crm_companies')
          .update({ enrichment_data: enrichment, enrichment_source: 'classifier', enrichment_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('crm_companies').insert({
          organization_id: caller.organization_id,
          // Prefer the caller's company name over the page title. Titles are
          // marketing copy at best ("Home", "Trusted HVAC Experts in ...") and
          // an error string at worst — rows landed named "403 Forbidden".
          name: nameByDomain.get(r.domain)
            || meta?.title?.split(/[|\-–]/)[0]?.trim()
            || r.domain,
          domain: r.domain,
          normalized_domain: r.domain,
          enrichment_data: enrichment,
          enrichment_source: 'classifier',
          enrichment_updated_at: new Date().toISOString(),
        });
      }
    }

    return json({
      success: true,
      model: servedModel ?? null,
      classified: results.length,
      from_metadata: withText.length,
      from_cache: cached.size,
      unreachable: unreachable.length,
      unreachable_domains: unreachable.map((m) => ({ domain: m.domain, reason: m.reason ?? 'conn_failed' })),
      parse_errors: parseErrors.length ? parseErrors : undefined,
      data: [...cached.values(), ...results],
    });
  },
}));
