import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Missing Authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: orgRows } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userData.user.id);
    const orgIds = (orgRows as Array<{ organization_id: string }> | null)?.map((r) => r.organization_id) ?? [];
    if (orgIds.length === 0) {
      return new Response(JSON.stringify({ total_domains: 0, hit_rate: 0, avg_confidence: 0, by_tier: {}, expiring_soon_count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: rows } = await supabase
      .from('domain_pattern_cache')
      .select('tier, confidence, negative_result, expires_at')
      .in('organization_id', orgIds);

    const list = (rows as Array<{ tier: number | null; confidence: number; negative_result: boolean; expires_at: string | null }>) ?? [];
    const total = list.length;
    const positives = list.filter((r) => !r.negative_result).length;
    const hitRate = total > 0 ? Math.round((positives / total) * 100) : 0;
    const avgConfidence = total > 0 ? Math.round(list.reduce((s, r) => s + (r.confidence || 0), 0) / total) : 0;

    const byTier: Record<string, number> = {};
    for (const r of list) {
      const k = r.tier == null ? 'unknown' : String(r.tier);
      byTier[k] = (byTier[k] ?? 0) + 1;
    }

    const now = Date.now();
    const soon = now + 7 * 24 * 3600 * 1000;
    const expiringSoon = list.filter((r) => {
      if (!r.expires_at) return false;
      const t = new Date(r.expires_at).getTime();
      return t > now && t < soon;
    }).length;

    return new Response(
      JSON.stringify({
        total_domains: total,
        hit_rate: hitRate,
        avg_confidence: avgConfidence,
        by_tier: byTier,
        expiring_soon_count: expiringSoon,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[lb-cache-stats] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
