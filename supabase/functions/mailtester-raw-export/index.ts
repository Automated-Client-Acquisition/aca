import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

interface ExportBody {
  list_id?: string;
  verified_after?: string;
  verified_before?: string;
}

interface VerificationRow {
  email: string;
  email_lower: string;
  domain: string | null;
  status: string;
  provider: string;
  verified_at: string;
  raw_response: unknown;
}

const IN_CHUNK_SIZE = 500;

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
  });
}

function defaultVerifiedAfter(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ success: false, error: 'Missing Authorization' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ success: false, error: 'Invalid token' }, 401);
  }

  let body: ExportBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: memberships, error: membershipErr } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userData.user.id);
  if (membershipErr) {
    return jsonResponse({ success: false, error: membershipErr.message }, 500);
  }
  const orgIds = ((memberships ?? []) as Array<{ organization_id: string }>).map((r) => r.organization_id);
  if (orgIds.length === 0) {
    return jsonResponse({ success: false, error: 'No organization membership found' }, 403);
  }

  let organizationId = orgIds[0];
  let emailFilter: string[] | null = null;
  let listName: string | null = null;

  if (body.list_id) {
    const { data: list, error: listErr } = await supabase
      .from('lead_lists')
      .select('id, name, organization_id')
      .eq('id', body.list_id)
      .maybeSingle();
    if (listErr) return jsonResponse({ success: false, error: listErr.message }, 500);
    if (!list) return jsonResponse({ success: false, error: 'List not found' }, 404);
    if (!orgIds.includes((list as { organization_id: string }).organization_id)) {
      return jsonResponse({ success: false, error: 'Forbidden' }, 403);
    }
    organizationId = (list as { organization_id: string }).organization_id;
    listName = (list as { name: string }).name;

    const { data: emails, error: emailsErr } = await supabase.rpc('get_lead_list_member_emails', {
      p_list_id: body.list_id,
    });
    if (emailsErr) return jsonResponse({ success: false, error: emailsErr.message }, 500);
    emailFilter = Array.from(new Set(((emails ?? []) as string[]).map((e) => e?.trim().toLowerCase()).filter(Boolean)));
  }

  const verifiedAfter = body.verified_after || defaultVerifiedAfter();
  const verifiedBefore = body.verified_before;
  const rows: VerificationRow[] = [];

  const runQuery = async (emails?: string[]) => {
    let query = supabase
      .from('email_address_verifications')
      .select('email, email_lower, domain, status, provider, verified_at, raw_response')
      .eq('organization_id', organizationId)
      .eq('provider', 'mailtester_ninja')
      .gte('verified_at', verifiedAfter)
      .order('verified_at', { ascending: false });

    if (verifiedBefore) query = query.lte('verified_at', verifiedBefore);
    if (emails) query = query.in('email_lower', emails);

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as VerificationRow[]));
  };

  try {
    if (emailFilter) {
      for (let i = 0; i < emailFilter.length; i += IN_CHUNK_SIZE) {
        await runQuery(emailFilter.slice(i, i + IN_CHUNK_SIZE));
      }
    } else {
      await runQuery();
    }
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }

  const exportPayload = {
    exported_at: new Date().toISOString(),
    organization_id: organizationId,
    list_id: body.list_id ?? null,
    list_name: listName,
    verified_after: verifiedAfter,
    verified_before: verifiedBefore ?? null,
    total_records: rows.length,
    records: rows,
  };

  const filenameDate = new Date().toISOString().slice(0, 10);
  return jsonResponse(exportPayload, 200, {
    'Content-Disposition': `attachment; filename="mailtester-raw-${filenameDate}.json"`,
  });
});
