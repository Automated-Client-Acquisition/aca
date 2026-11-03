/**
 * M365 Admin Consent Callback Edge Function
 *
 * Microsoft redirects here after an M365 admin grants/denies consent.
 *
 * Simplified single-app flow:
 * - One app ("ACA Email Infra") with both Graph + EXO permissions
 * - One consent grants everything
 * - AADSTS650052 = tenant needs a Business Basic license (not an SP issue)
 *
 * State parameter: "{rowId}" (or "{rowId}:exo" / "{rowId}:graph" for backward compat)
 *
 * /adminconsent returns:
 *   Success: admin_consent=True&tenant=<guid>&state=<encoded>
 *   Error:   error=<code>&error_description=<msg>&state=<encoded>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const url = new URL(req.url);
  const adminConsent = url.searchParams.get('admin_consent');
  const tenantGuid = url.searchParams.get('tenant');
  const rawState = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Log ALL params for debugging — Microsoft's callback params vary
  const allParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { allParams[k] = v; });
  console.log(`[M365 Callback] Full params: ${JSON.stringify(allParams)}`);

  const htmlHeaders = new Headers({
    ...corsHeaders,
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });

  const styledPage = (title: string, body: string, script?: string) =>
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0f0f23;color:#e0e0e0}.card{max-width:420px;padding:32px 40px;background:#1a1a2e;border-radius:16px;border:1px solid rgba(255,255,255,.08);text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4)}h2{font-size:18px;margin-bottom:12px;font-weight:600}p{color:#8888a8;font-size:14px;line-height:1.6;margin:8px 0}.ok{color:#4ade80}.err{color:#f87171}.warn{color:#fbbf24}.icon{font-size:36px;margin-bottom:12px}</style></head>
<body><div class="card">${body}</div>${script ? `<script>${script}</script>` : ''}</body></html>`;

  // Helper: return a self-closing HTML page for popup windows.
  // Posts a message to window.opener so the parent app can immediately call
  // validate without waiting for poll intervals.
  const selfClosingPage = (message: string, isError = false, postRowId?: string) => {
    const postMsg = postRowId
      ? `try{window.opener&&window.opener.postMessage({type:'m365_consent_complete',rowId:${JSON.stringify(postRowId)},success:${!isError}},'*');}catch(e){}`
      : '';
    return new Response(
      styledPage(
        isError ? 'Error' : 'Success',
        `<div class="icon">${isError ? '&#10060;' : '&#9989;'}</div>
         <h2>${isError ? 'Something went wrong' : 'Done!'}</h2>
         <p class="${isError ? 'err' : 'ok'}">${message}</p>
         <p style="font-size:12px;margin-top:16px;color:#555">This window will close automatically.</p>`,
        `${postMsg}setTimeout(()=>window.close(),2000);`
      ),
      { status: 200, headers: htmlHeaders }
    );
  };

  // Parse state: "{rowId}" or "{rowId}:graph" or "{rowId}:exo" or "{rowId}:bootstrap"
  // All suffixes are treated the same now — single consent covers everything.
  const [rowId] = (rawState || '').split(':');

  // Handle denied consent or error
  if (error || adminConsent !== 'True') {
    console.warn(`[M365 Callback] Consent denied or error: ${error} | ${errorDescription} (state: ${rawState})`);

    const errorMsg = errorDescription || error || 'unknown reason';
    const isExoSpMissing = errorMsg.includes('AADSTS650052') || errorMsg.includes('00000002-0000-0ff1-ce00-000000000000');

    // AADSTS650052 = tenant lacks Exchange Online license
    if (isExoSpMissing && rowId) {
      console.log(`[M365 Callback] AADSTS650052 — tenant needs Business Basic license (row: ${rowId})`);

      await supabase
        .from('m365_tenants')
        .update({
          status: 'error',
          last_error: 'Tenant needs a Microsoft 365 Business Basic license (or higher) with Exchange Online.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', rowId);

      return selfClosingPage(
        'Your tenant needs a Microsoft 365 Business Basic license (or higher) with Exchange Online. ' +
        'Purchase one in M365 Admin Center > Billing > Purchase services, then try again.',
        true
      );
    }

    // For other errors, update the tenant row
    if (rowId) {
      await supabase
        .from('m365_tenants')
        .update({
          status: 'error',
          last_error: `Admin consent was denied: ${error || 'unknown'}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rowId);
    }

    return selfClosingPage(`Consent was denied: ${errorMsg}`, true);
  }

  if (!rowId) {
    console.error('[M365 Callback] Missing state parameter');
    return selfClosingPage('Missing state parameter.', true);
  }

  console.log(`[M365 Callback] Consent granted for tenant ${tenantGuid || 'unknown'}, row: ${rowId}`);

  // Read current status — for re-consent on already-connected tenants we must
  // not regress them back to consent_pending.
  const { data: existingRow } = await supabase
    .from('m365_tenants')
    .select('status')
    .eq('id', rowId)
    .single();

  const isReconsent = existingRow?.status === 'connected';

  // Single consent covers both Graph + EXO — set both flags
  const { error: updateError } = await supabase
    .from('m365_tenants')
    .update({
      consent_granted: true,
      consent_granted_at: new Date().toISOString(),
      exo_consent_granted: true,
      exo_consent_granted_at: new Date().toISOString(),
      // Preserve 'connected' on re-consent; only fresh consents enter consent_pending
      status: isReconsent ? 'connected' : 'consent_pending',
      last_error: null,
      ...(tenantGuid ? { tenant_id: tenantGuid } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);

  if (updateError) {
    console.error(`[M365 Callback] Failed to update tenant row: ${updateError.message}`);
    return selfClosingPage('Error saving consent. Close this window and try again.', true);
  }

  return selfClosingPage('Permissions granted! Graph API and Exchange Online access configured.', false, rowId);
});
