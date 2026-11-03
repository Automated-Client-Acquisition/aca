/**
 * Phase 8.2.3 — DMARC report ingestion endpoint.
 *
 * Accepts DMARC aggregate reports in three flavors:
 *
 *   POST application/xml                       — raw XML body
 *   POST application/json { report_xml: "..." } — JSON-wrapped XML (easier for Cloudflare/Zapier)
 *   POST application/gzip / multipart           — gzipped XML (most common from receivers)
 *
 * Auth: HMAC signature header `X-ACA-DMARC-Signature` over the raw body using
 * an org-specific secret from `organization_settings.dmarc_ingest_secret`.
 * No JWT required — the secret is the auth, and the org_id query param scopes it.
 *
 * Forwarding flow the user configures once per org:
 *   1. Cloudflare Email Routing on the apex: dmarc@<your-tld> → POST to this URL
 *      OR: an external service like Postmark DMARC Monitor (free tier 10K reports/mo)
 *   2. Reports get parsed, persisted to email_dmarc_reports, surfaced in the UI
 *
 * Usage example for testing:
 *   curl -X POST "$URL/functions/v1/infra-dmarc-ingest?org=$ORG_ID" \
 *     -H "Content-Type: application/xml" \
 *     -H "X-ACA-DMARC-Signature: $(printf %s "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')" \
 *     --data-binary @report.xml
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { parseDmarcReport, decompressGz } from '../_shared/dmarc-parser.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hmacHexSha256(secret: string, message: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, message);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const url = new URL(req.url);
  const organization_id = url.searchParams.get('org') ?? url.searchParams.get('organization_id');
  if (!organization_id) return jsonResponse({ success: false, error: 'org query param required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: org } = await supabase
    .from('organizations')
    .select('id, dmarc_ingest_secret_encrypted, dmarc_ingest_secret')
    .eq('id', organization_id)
    .maybeSingle();
  if (!org) return jsonResponse({ success: false, error: 'Unknown organization' }, 404);

  // The org needs an HMAC secret configured. We support it on either the
  // organizations table (via a future column) or a sentinel env-var fallback
  // for the very first deployment.
  const secret = (org.dmarc_ingest_secret as string | null) ?? Deno.env.get('DMARC_INGEST_FALLBACK_SECRET');
  if (!secret) {
    return jsonResponse({
      success: false,
      error: 'DMARC ingest secret not configured for this organization. Generate one in settings → email infrastructure.',
    }, 401);
  }

  // Verify HMAC over the raw body
  const sigHeader = req.headers.get('x-aca-dmarc-signature');
  if (!sigHeader) return jsonResponse({ success: false, error: 'Missing X-ACA-DMARC-Signature' }, 401);

  const rawBytes = new Uint8Array(await req.arrayBuffer());
  const expectedSig = await hmacHexSha256(secret, rawBytes);
  if (!constantTimeEqual(expectedSig, sigHeader.trim())) {
    return jsonResponse({ success: false, error: 'Invalid signature' }, 401);
  }

  // Decode body to XML based on Content-Type
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  let xml = '';
  try {
    if (contentType.includes('application/gzip') || contentType.includes('application/x-gzip')) {
      xml = await decompressGz(rawBytes);
    } else if (contentType.includes('application/json')) {
      const json = JSON.parse(new TextDecoder().decode(rawBytes)) as { report_xml?: string; report_xml_gz_base64?: string };
      if (json.report_xml_gz_base64) {
        const bytes = Uint8Array.from(atob(json.report_xml_gz_base64), (c) => c.charCodeAt(0));
        xml = await decompressGz(bytes);
      } else if (json.report_xml) {
        xml = json.report_xml;
      } else {
        return jsonResponse({ success: false, error: 'JSON body must include report_xml or report_xml_gz_base64' }, 400);
      }
    } else {
      // Treat as raw XML (also handles application/xml, text/xml, application/octet-stream)
      xml = new TextDecoder().decode(rawBytes);
      // Heuristic: if it doesn't look like XML, try gunzip
      if (!xml.trim().startsWith('<')) {
        try { xml = await decompressGz(rawBytes); } catch { /* fall through */ }
      }
    }
  } catch (e) {
    return jsonResponse({
      success: false,
      error: `Failed to decode body: ${e instanceof Error ? e.message : 'unknown'}`,
    }, 400);
  }

  const parsed = parseDmarcReport(xml);
  if (!parsed) return jsonResponse({ success: false, error: 'Could not parse DMARC report XML' }, 400);

  // Find the matching domain (by policy_published.domain)
  let domainId: string | null = null;
  if (parsed.policy_domain) {
    const { data: domain } = await supabase
      .from('email_sending_domains')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('domain', parsed.policy_domain.toLowerCase())
      .maybeSingle();
    domainId = (domain as { id: string } | null)?.id ?? null;
  }

  const { error: upsertErr } = await supabase
    .from('email_dmarc_reports')
    .upsert({
      organization_id,
      domain_id: domainId,
      report_id: parsed.report_id,
      org_name: parsed.org_name,
      report_email: parsed.report_email,
      report_date_range_begin: parsed.date_range_begin.toISOString(),
      report_date_range_end: parsed.date_range_end.toISOString(),
      policy_domain: parsed.policy_domain,
      policy_p: parsed.policy_p,
      policy_pct: parsed.policy_pct,
      total_messages: parsed.total_messages,
      spf_pass_count: parsed.spf_pass_count,
      dkim_pass_count: parsed.dkim_pass_count,
      dmarc_pass_count: parsed.dmarc_pass_count,
      alignment_failures: parsed.alignment_failures,
      raw_xml: xml.length > 1024 * 200 ? null : xml, // skip storing huge XML
    }, { onConflict: 'organization_id,report_id,org_name' });

  if (upsertErr) return jsonResponse({ success: false, error: upsertErr.message }, 500);

  return jsonResponse({
    success: true,
    report_id: parsed.report_id,
    org_name: parsed.org_name,
    domain: parsed.policy_domain,
    total_messages: parsed.total_messages,
    dmarc_pass_count: parsed.dmarc_pass_count,
    alignment_failure_count: parsed.alignment_failures.length,
  });
});
