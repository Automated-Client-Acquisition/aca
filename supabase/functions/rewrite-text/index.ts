/**
 * One-click rewrites on the Review screen ("Shorter", "Punchier hook", …).
 *
 * Returns a suggestion only. Nothing is saved and no pipeline stage runs, so
 * rewriting a caption never re-draws the image (regenerate-content goes
 * through execute-stage → approve-stage, which triggers the next stages).
 *
 * POST { output_id, text, instruction }
 *   or { idea_id, text, instruction } for an idea's talking point
 *   ("Remove the number" on the Guidelines card)
 * → { success: true, text, model } | { success: false, error, code? }
 * User-fixable problems return 200 with success: false so the client can show
 * the message (supabase-js drops the body of non-2xx replies).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey, llmChatCompletion } from '../_shared/llm-client.ts';
import { normalizeDashes } from '../_shared/sanitize-ai-output.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FALLBACK_MODEL = 'anthropic/claude-haiku-4.5';
const OWN_SERVER_PREFIXES = ['ollama:', 'alibaba:', 'opencode:'];
const MAX_TEXT_CHARS = 20_000;
const MAX_INSTRUCTION_CHARS = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function brandVoiceNotes(brand: Record<string, unknown> | null | undefined): string {
  if (!brand || typeof brand !== 'object') return '';
  const parts: string[] = [];
  if (typeof brand.name === 'string' && brand.name) parts.push(`Brand voice: ${brand.name}`);
  if (typeof brand.tone === 'string' && brand.tone) parts.push(`Tone: ${brand.tone}`);
  if (typeof brand.style_guidelines === 'string' && brand.style_guidelines) parts.push(`Style guidelines: ${brand.style_guidelines.slice(0, 1500)}`);
  return parts.join('\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const outputId: string = String(body.output_id || '');
    const ideaId: string = String(body.idea_id || '');
    const text: string = String(body.text || '');
    const instruction: string = String(body.instruction || '').trim();

    if (!outputId && !ideaId) return json({ success: false, error: 'output_id or idea_id is required' }, 400);
    if (!text.trim()) return json({ success: false, error: 'There is no text to rewrite.' });
    if (!instruction) return json({ success: false, error: 'Say how to rewrite it.' });
    if (text.length > MAX_TEXT_CHARS) return json({ success: false, error: 'This text is too long to rewrite in one go.' });
    if (instruction.length > MAX_INSTRUCTION_CHARS) return json({ success: false, error: 'Keep the instruction under 500 characters.' });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    let output: { organization_id: string; pipeline?: string | null; generation_params?: unknown } | null = null;
    if (outputId) {
      const { data, error: outputError } = await supabase
        .from('content_outputs')
        .select('id, organization_id, pipeline, generation_params')
        .eq('id', outputId)
        .maybeSingle();
      if (outputError) throw outputError;
      if (!data) return json({ success: false, error: 'This piece no longer exists.' }, 404);
      output = data;
    } else {
      const { data, error: ideaError } = await supabase
        .from('content_ideas')
        .select('id, organization_id')
        .eq('id', ideaId)
        .maybeSingle();
      if (ideaError) throw ideaError;
      if (!data) return json({ success: false, error: 'This idea no longer exists.' }, 404);
      output = { organization_id: data.organization_id, pipeline: 'idea_point', generation_params: {} };
    }

    try {
      await assertOrgAccess(req, supabase, output.organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const params = (output.generation_params ?? {}) as Record<string, any>;
    const runModel: string = params.model_config?.text_llm?.model_id || '';
    const runProvider: string = params.model_config?.text_llm?.provider || '';
    const ownServer = OWN_SERVER_PREFIXES.some((p) => runModel.startsWith(p));
    // Same model as the run when it's an OpenRouter or own-server model, so the voice matches.
    const model = ownServer || (runModel && (runProvider === 'openrouter' || runModel.includes('/'))) ? runModel : FALLBACK_MODEL;

    let openRouterApiKey: string | undefined;
    if (!ownServer) {
      const key = await resolveApiKey(supabase, output.organization_id, 'openrouter');
      if (!key) {
        return json({ success: false, code: 'MISSING_API_KEY', error: 'Rewrites need a working OpenRouter API key. Add or update it in Settings > Integrations.' });
      }
      openRouterApiKey = await decryptApiKey(key.key_encrypted);
    }

    const kind = output.pipeline === 'rich_article'
      ? 'article'
      : output.pipeline === 'idea_point' ? 'one-sentence talking point for a social media post' : 'social media post';
    const voice = brandVoiceNotes(params.library_elements?.brand ?? params.library_elements?.library_brand_voices);
    const system = [
      `You edit a ${kind}. Rewrite it following the instruction.`,
      'Keep the author\'s voice, language, facts, numbers, names, links, hashtags and line-break style unless the instruction says otherwise.',
      'Do not use em dashes. Do not add a preamble, notes, quotes around the text, or a title that was not there.',
      'Return only the rewritten text.',
      voice ? `\n${voice}` : '',
    ].join('\n');

    const result = await llmChatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `INSTRUCTION: ${instruction}\n\nTEXT:\n${text}` },
      ],
      temperature: 0.7,
      max_tokens: Math.min(6000, Math.max(800, Math.ceil(text.length / 2.5))),
      openRouterApiKey,
      supabase,
      organizationId: output.organization_id,
      timeoutMs: 55_000,
    });

    const rewritten = normalizeDashes(result.content.trim()).replace(/^"([\s\S]*)"$/, '$1');
    if (!rewritten) return json({ success: false, error: 'The model returned nothing. Try again.' });

    return json({ success: true, text: rewritten, model: result.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[rewrite-text]', message);
    const friendly = /402|credits/i.test(message)
      ? 'Your OpenRouter balance is too low for a rewrite.'
      : /401|invalid/i.test(message)
        ? 'OpenRouter rejected the API key. Update it in Settings > Integrations.'
        : /timeout|abort/i.test(message)
          ? 'The rewrite took too long. Try again.'
          : 'The rewrite failed. Try again in a moment.';
    return json({ success: false, error: friendly, detail: message.slice(0, 300) }, 200);
  }
});
