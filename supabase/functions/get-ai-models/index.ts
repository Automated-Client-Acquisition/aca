import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { resolveOllamaConfig } from '../_shared/llm-client.ts';
import { resolveEffectiveOrgId } from '../_shared/resolve-api-key.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Fetch image generation models from OpenRouter (server-side to avoid CORS).
// Uses the official /api/v1/models list — the undocumented
// /api/frontend/models/find endpoint this used to scrape now 404s.
async function fetchOpenRouterImageModels(): Promise<any[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models');

  if (!response.ok) {
    throw new Error(`OpenRouter API error ${response.status}`);
  }

  const data = await response.json();
  const models = data?.data || [];

  // Map to a consistent shape, excluding the auto router
  return models
    .filter((m: any) =>
      m.id !== 'openrouter/auto' &&
      (m.architecture?.output_modalities || []).includes('image')
    )
    .map((m: any) => ({
      model_id: m.id,
      name: m.id,
      display_name: m.name,
      description: m.description || '',
      provider: 'openrouter',
      categories: ['text-to-image'],
      is_featured: false,
      is_active: true,
    }));
}

// List the calling user's org Ollama models via GET <base>/api/tags.
// Org membership is checked so one org can't read another's server.
async function fetchOllamaModels(req: Request, requestedOrgId?: string): Promise<any[]> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Authorization required for Ollama model listing');
  const { data: { user }, error: authError } = await admin.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (authError || !user) throw new Error('Invalid auth token');

  let organizationId = requestedOrgId;
  if (organizationId) {
    const { data: membership } = await admin
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) organizationId = undefined;
  }
  if (!organizationId) {
    // deno-lint-ignore no-explicit-any
    organizationId = (await resolveEffectiveOrgId(admin as any, user.id)) ?? undefined;
  }
  if (!organizationId) throw new Error('No organization found for user');

  const config = await resolveOllamaConfig(admin, organizationId);
  if (!config) {
    return []; // No Ollama key configured — empty list, not an error
  }

  const headers: Record<string, string> = {};
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const response = await fetch(`${config.baseUrl}/api/tags`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Ollama server returned ${response.status}`);
  }

  const data = await response.json();
  return (data.models || []).map((m: any) => ({
    model_id: `ollama:${m.name}`,
    name: m.name,
    display_name: m.name,
    description: m.details?.parameter_size
      ? `${m.details.family || ''} ${m.details.parameter_size} (${m.details.quantization_level || ''})`.trim()
      : '',
    provider: 'ollama',
    categories: ['text-generation'],
    is_featured: false,
    is_active: true,
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { source } = body;

    // If source is 'openrouter', fetch live from OpenRouter API (bypasses CORS)
    if (source === 'openrouter') {
      const models = await fetchOpenRouterImageModels();
      return new Response(
        JSON.stringify({ models }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If source is 'ollama', list the org's Ollama server models live
    // (server-side proxy: avoids CORS and keeps the key/host out of the browser)
    if (source === 'ollama') {
      const models = await fetchOllamaModels(req, body.organization_id);
      return new Response(
        JSON.stringify({ models }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: query from database
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { providers, category, search, limit = 50, featured_only = false, curated_only = false } = body;

    // Build query
    let query = supabase
      .from('ai_models')
      .select('*')
      .eq('is_active', true);

    // Filter by providers
    if (providers && providers.length > 0) {
      query = query.in('provider', providers);
    }

    // Filter by category
    if (category) {
      query = query.contains('categories', [category]);
    }

    // Filter by curated (has normalized_capabilities for execute-stage compatibility)
    if (curated_only) {
      query = query.eq('is_curated', true);
    }

    // Filter by featured
    if (featured_only) {
      query = query.eq('is_featured', true);
    }

    // Search filter
    if (search && search.trim()) {
      query = query.or(`name.ilike.%${search}%,display_name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Sort by featured first, then popularity, then name
    query = query
      .order('is_featured', { ascending: false })
      .order('popularity_score', { ascending: false })
      .order('name', { ascending: true })
      .limit(limit);

    const { data: models, error } = await query;

    if (error) {
      console.error('Database query error:', error);
      throw error;
    }

    return new Response(
      JSON.stringify({ models: models || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Get models error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
