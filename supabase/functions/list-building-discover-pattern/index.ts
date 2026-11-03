/**
 * ACA Discovery Layer — Pattern Discovery Agent (§9.4).
 *
 * Cache-miss path: when `domain_pattern_cache` has no usable entry for a
 * domain, this agent crawls public sources to find a verifiable email at
 * the domain, then infers the pattern (§9.5) and seeds the cache.
 *
 * Phase 1 sources (cheap, high-signal first):
 *   1. Company website pages: `/`, `/contact`, `/about`, `/team`, `/leadership`
 *      → extract `mailto:` links + plain-text emails + nearby name hints.
 *   2. WHOIS via RDAP (rdap.org / domains.google).
 *   3. DNS TXT records (DMARC `rua=mailto:` reporting addresses).
 *   4. Google dorks (only when `SERPAPI_KEY` is configured).
 *
 * Stops on the first email that passes a quick MX + SMTP RCPT check.
 *
 * Spec: ACA Discovery Layer Implementation Brief v1.2, §9.4 + §9.5.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { resolveMx } from '../_shared/dns-utils.ts';
import { verifyEmail } from '../_shared/list-building/smtp-verifier.ts';
import { parseFromPair } from '../_shared/list-building/name-parser.ts';
import { inferPatternFromEmail } from '../_shared/list-building/pattern-inference.ts';
import { PatternCache } from '../_shared/list-building/pattern-cache.ts';

interface RequestBody {
  organization_id: string;
  domain: string;
  contact_id?: string;
}

interface EmailEvidence {
  email: string;
  source: 'mailto' | 'plain_text' | 'whois' | 'dns_txt' | 'google_dork';
  source_url: string;
  hinted_name?: { first: string; last: string };
}

const PAGE_PATHS = ['/', '/contact', '/about', '/team', '/leadership', '/people', '/legal'];
const PER_PAGE_TIMEOUT_MS = 6_000;
const MAX_TOTAL_TIMEOUT_MS = 25_000;

const EMAIL_REGEX = /\b([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))\b/g;
const MAILTO_REGEX = /<a[^>]+href="mailto:([^"@]+@([^"]+))"[^>]*>([^<]*)<\/a>/gi;
const NAME_NEAR_EMAIL = /([A-Z][a-z]+)\s+([A-Z][a-z]+)[^<]{0,80}([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))/g;

async function fetchPage(url: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'ACA-Discovery/1.0 (+https://aca.app)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
      },
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractEvidenceFromHtml(html: string, domain: string, sourceUrl: string): EmailEvidence[] {
  const out: EmailEvidence[] = [];
  const lowerDomain = domain.toLowerCase();
  const seen = new Set<string>();

  // mailto: links — highest confidence (confirmed working contact)
  let m: RegExpExecArray | null;
  MAILTO_REGEX.lastIndex = 0;
  while ((m = MAILTO_REGEX.exec(html)) !== null) {
    const email = m[1].trim().toLowerCase();
    const linkDomain = m[2].toLowerCase();
    const anchorText = (m[3] || '').trim();
    if (linkDomain !== lowerDomain) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    const nameMatch = anchorText.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
    out.push({
      email,
      source: 'mailto',
      source_url: sourceUrl,
      hinted_name: nameMatch ? { first: nameMatch[1], last: nameMatch[2] } : undefined,
    });
  }

  // Name+email proximity (plain text)
  NAME_NEAR_EMAIL.lastIndex = 0;
  while ((m = NAME_NEAR_EMAIL.exec(html)) !== null) {
    const first = m[1];
    const last = m[2];
    const email = m[3].toLowerCase();
    const linkDomain = m[4].toLowerCase();
    if (linkDomain !== lowerDomain) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, source: 'plain_text', source_url: sourceUrl, hinted_name: { first, last } });
  }

  // Plain-text emails (no name hint) as a fallback
  EMAIL_REGEX.lastIndex = 0;
  while ((m = EMAIL_REGEX.exec(html)) !== null) {
    const email = m[1].toLowerCase();
    const linkDomain = m[2].toLowerCase();
    if (linkDomain !== lowerDomain) continue;
    if (seen.has(email)) continue;
    // Skip role-only inboxes — they don't help with pattern inference
    if (/^(info|contact|hello|admin|support|sales|press)@/.test(email)) continue;
    seen.add(email);
    out.push({ email, source: 'plain_text', source_url: sourceUrl });
  }

  return out;
}

async function harvestWebsite(domain: string, deadline: number): Promise<EmailEvidence[]> {
  const out: EmailEvidence[] = [];
  for (const path of PAGE_PATHS) {
    if (Date.now() > deadline) break;
    const url = `https://${domain}${path}`;
    const html = await fetchPage(url, PER_PAGE_TIMEOUT_MS);
    if (!html) continue;
    out.push(...extractEvidenceFromHtml(html, domain, url));
    if (out.length >= 5) break;
  }
  return out;
}

async function harvestDmarcRua(domain: string): Promise<EmailEvidence[]> {
  try {
    const url = `https://dns.google/resolve?name=_dmarc.${domain}&type=TXT`;
    const resp = await fetch(url, { headers: { Accept: 'application/dns-json' } });
    if (!resp.ok) return [];
    const json = await resp.json();
    const txts: string[] = (json.Answer ?? []).map((a: { data: string }) =>
      a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, ''),
    );
    const out: EmailEvidence[] = [];
    for (const txt of txts) {
      const ruaMatch = txt.match(/rua=mailto:([^,;\s]+)/i);
      if (ruaMatch) {
        out.push({
          email: ruaMatch[1].toLowerCase(),
          source: 'dns_txt',
          source_url: `https://dns.google/resolve?name=_dmarc.${domain}&type=TXT`,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function harvestRdap(domain: string): Promise<EmailEvidence[]> {
  try {
    const resp = await fetch(`https://rdap.org/domain/${domain}`, {
      headers: { Accept: 'application/rdap+json' },
    });
    if (!resp.ok) return [];
    const json = await resp.json();
    const ents = (json.entities ?? []) as Array<{ vcardArray?: unknown }>;
    const out: EmailEvidence[] = [];
    for (const ent of ents) {
      const vcard = ent.vcardArray;
      if (!Array.isArray(vcard) || vcard.length < 2) continue;
      const fields = vcard[1] as Array<unknown>;
      for (const f of fields) {
        if (!Array.isArray(f) || f.length < 4) continue;
        const [name, , , value] = f as [string, unknown, unknown, string];
        if (name === 'email' && typeof value === 'string' && value.endsWith(`@${domain}`)) {
          out.push({
            email: value.toLowerCase(),
            source: 'whois',
            source_url: `https://rdap.org/domain/${domain}`,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function quickVerify(email: string): Promise<boolean> {
  const at = email.indexOf('@');
  if (at <= 0) return false;
  const domain = email.slice(at + 1);
  const mx = await resolveMx(domain);
  if (mx.length === 0) return false;
  const result = await verifyEmail(email, { mxHosts: mx, timeoutMs: 8_000 });
  return result.status === 'verified';
}

async function persistEvidence(
  supabase: SupabaseClient,
  orgId: string,
  domain: string,
  ev: EmailEvidence,
  pattern: string | null,
  confidence: number,
): Promise<void> {
  await supabase.from('pattern_evidence').insert({
    organization_id: orgId,
    domain: domain.toLowerCase(),
    email: ev.email.toLowerCase(),
    source: ev.source,
    source_url: ev.source_url,
    pattern_inferred: pattern,
    confidence,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as RequestBody;
    if (!body?.organization_id || !body?.domain) {
      return new Response(JSON.stringify({ error: 'organization_id and domain required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, body.organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }
    const domain = body.domain.toLowerCase();
    const cache = new PatternCache(supabase, body.organization_id);

    const deadline = Date.now() + MAX_TOTAL_TIMEOUT_MS;

    // Source priority: website (cheapest, highest signal) → DMARC → WHOIS → Google dorks
    const sources = [
      () => harvestWebsite(domain, deadline),
      () => harvestDmarcRua(domain),
      () => harvestRdap(domain),
    ];

    const allEvidence: EmailEvidence[] = [];
    for (const source of sources) {
      if (Date.now() > deadline) break;
      const evidence = await source();
      allEvidence.push(...evidence);
      if (allEvidence.length >= 3) break;
    }

    if (allEvidence.length === 0) {
      await cache.markDiscoveryAttempted(domain, true /* exhausted */);
      return new Response(JSON.stringify({ ok: true, exhausted: true, evidence: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Try to verify and infer pattern from the strongest evidence first
    for (const ev of allEvidence) {
      if (Date.now() > deadline) break;
      const verified = await quickVerify(ev.email);
      if (!verified) {
        await persistEvidence(supabase, body.organization_id, domain, ev, null, 0);
        continue;
      }

      if (!ev.hinted_name) {
        // No name attached — record evidence but can't infer pattern
        await persistEvidence(supabase, body.organization_id, domain, ev, null, 0);
        continue;
      }

      const parsed = parseFromPair(ev.hinted_name.first, ev.hinted_name.last);
      const inferred = inferPatternFromEmail(ev.email, parsed, 1);
      await persistEvidence(
        supabase,
        body.organization_id,
        domain,
        ev,
        inferred.pattern,
        inferred.confidence,
      );

      if (inferred.pattern && inferred.confidence >= 70) {
        await cache.recordHit(domain, inferred.pattern, 1, false /* catchAll */, true /* mxValid */);
        await cache.markDiscoveryAttempted(domain, false /* not exhausted; we got a hit */);
        return new Response(
          JSON.stringify({
            ok: true,
            domain,
            pattern: inferred.pattern,
            confidence: inferred.confidence,
            evidence_email: ev.email,
            source: ev.source,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Sources exhausted without a usable pattern.
    await cache.markDiscoveryAttempted(domain, true /* exhausted */);
    return new Response(
      JSON.stringify({ ok: true, exhausted: true, evidence: allEvidence.length, pattern: null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[discover-pattern] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
