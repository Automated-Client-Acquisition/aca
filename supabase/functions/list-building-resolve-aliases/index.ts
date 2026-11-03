/**
 * ACA Discovery Layer — Domain Alias Resolver (§9.7).
 *
 * Detects sub-domain / regional / acquisition / redirect relationships between
 * a primary domain and candidate alias domains. Stores findings in
 * `domain_aliases` so the Pattern Engine can fall back from an unsolved alias
 * to the parent domain's pattern.
 *
 * Inputs:
 *   POST { organization_id, primary_domain, candidates?: string[] }
 *
 * If `candidates` is omitted, the agent attempts to auto-discover aliases:
 *   1. Fetch the homepage at `https://<primary_domain>` and parse outbound
 *      hrefs whose anchor text contains regional / brand cues
 *      ("EU site", "Visit our blog", "Old website").
 *   2. Compare MX records between primary and each candidate — shared MX is
 *      a strong signal of the same operating org.
 *   3. Follow redirect chains: if a candidate 301/302s to the primary, mark
 *      it as a `redirect` alias.
 *
 * Stops short of WHOIS registrant matching for v1 — that requires a paid
 * batch WHOIS provider and false-positive rates are high. Phase 2 candidate.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { resolveMx } from '../_shared/dns-utils.ts';
import { PatternCache } from '../_shared/list-building/pattern-cache.ts';

interface RequestBody {
  organization_id: string;
  primary_domain: string;
  candidates?: string[];
}

const PER_FETCH_TIMEOUT_MS = 5_000;
const REGIONAL_HINT = /\b(EU|US|UK|APAC|EMEA|GLOBAL|FR|DE|JP|CN|UAE|AU|CA|MX|BR|previously\s+at|formerly|now\s+available)\b/i;
const HREF_REGEX = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

async function fetchPage(url: string): Promise<{ status: number; finalUrl: string; html: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ACA-Discovery/1.0 (+https://aca.app)' },
    });
    const html = await resp.text();
    return { status: resp.status, finalUrl: resp.url, html };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

interface CandidateInsight {
  candidate: string;
  primary: string;
  is_redirect: boolean;          // candidate 30x's to primary
  share_mx: boolean;              // candidate and primary resolve to same MX set
  link_text_hint: string | null;  // regional / branding cue from primary's homepage
  relationship: 'subsidiary' | 'redirect' | 'rebranding' | 'regional' | 'acquisition' | 'manual';
  discovered_via: 'whois' | 'mx' | 'website_link' | 'press_release' | 'manual';
}

async function inspectCandidate(
  primary: string,
  candidate: string,
  primaryMx: string[],
  linkTextHint: string | null,
): Promise<CandidateInsight | null> {
  const candidateInfo = await fetchPage(`https://${candidate}`);
  let is_redirect = false;
  if (candidateInfo) {
    const finalDomain = extractDomain(candidateInfo.finalUrl);
    if (finalDomain && finalDomain === primary) is_redirect = true;
  }

  const candidateMx = await resolveMx(candidate);
  const sharedMx =
    candidateMx.length > 0 &&
    primaryMx.length > 0 &&
    candidateMx.some((m) => primaryMx.includes(m));

  if (!is_redirect && !sharedMx && !linkTextHint) return null;

  let relationship: CandidateInsight['relationship'] = 'subsidiary';
  let discovered_via: CandidateInsight['discovered_via'] = 'website_link';
  if (is_redirect) {
    relationship = 'redirect';
    discovered_via = 'website_link';
  } else if (sharedMx) {
    relationship = 'subsidiary';
    discovered_via = 'mx';
  } else if (linkTextHint && /(EU|US|UK|APAC|FR|DE|JP|CN)/i.test(linkTextHint)) {
    relationship = 'regional';
    discovered_via = 'website_link';
  }

  return {
    candidate,
    primary,
    is_redirect,
    share_mx: sharedMx,
    link_text_hint: linkTextHint,
    relationship,
    discovered_via,
  };
}

async function autoDiscover(primary: string): Promise<Array<{ domain: string; hint: string | null }>> {
  const home = await fetchPage(`https://${primary}`);
  if (!home || home.status >= 400) return [];

  const out = new Map<string, string | null>();
  let m: RegExpExecArray | null;
  HREF_REGEX.lastIndex = 0;
  while ((m = HREF_REGEX.exec(home.html)) !== null) {
    const url = m[1];
    const anchorRaw = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const candidateDomain = extractDomain(url);
    if (!candidateDomain) continue;
    if (candidateDomain === primary) continue;
    if (candidateDomain.endsWith(primary)) continue; // already a sub-domain — handled separately
    if (
      /(facebook|twitter|x\.com|linkedin|youtube|instagram|tiktok|github|google|apple|amazon|cdn|jsdelivr|gravatar)/.test(
        candidateDomain,
      )
    ) {
      continue;
    }
    const hint = REGIONAL_HINT.test(anchorRaw) ? anchorRaw.slice(0, 80) : null;
    if (!out.has(candidateDomain)) out.set(candidateDomain, hint);
    if (out.size >= 10) break;
  }
  return Array.from(out.entries()).map(([domain, hint]) => ({ domain, hint }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as RequestBody;
    if (!body?.organization_id || !body?.primary_domain) {
      return new Response(JSON.stringify({ error: 'organization_id and primary_domain required' }), {
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
    const primary = body.primary_domain.toLowerCase();
    const cache = new PatternCache(supabase, body.organization_id);

    const candidatesWithHints =
      body.candidates && body.candidates.length > 0
        ? body.candidates.map((c) => ({ domain: c.toLowerCase(), hint: null }))
        : await autoDiscover(primary);

    const primaryMx = await resolveMx(primary);

    const insights: CandidateInsight[] = [];
    for (const c of candidatesWithHints) {
      const ins = await inspectCandidate(primary, c.domain, primaryMx, c.hint);
      if (ins) insights.push(ins);
    }

    for (const ins of insights) {
      await cache.upsertAlias({
        primary_domain: ins.primary,
        alias_domain: ins.candidate,
        relationship: ins.relationship,
        discovered_via: ins.discovered_via,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, primary, aliases_added: insights.length, insights }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[resolve-aliases] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
