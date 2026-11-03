/**
 * Blueprint Studio live preview.
 *
 * Resolves a draft blueprint prompt against a test topic and the workspace's
 * real brand voice / audience / product / person (same resolver and same
 * library defaults as dispatch-generation-job), then writes one sample on a
 * fast, cheap model. Text only; nothing is saved.
 *
 * AI angle variables ({{ai_hook}}, {{ai_talking_points}}, …) resolve empty
 * here: real runs fill them from the idea analysis, previews skip that call.
 *
 * POST { organization_id, pipeline, master_prompt, image_prompt?, topic,
 *        context?, text_model? }
 * → { success, text | null, resolved_prompt, used: { brand?, audience?, product?, person? }, model }
 * POST { organization_id, action: 'describe_look', images: string[] }
 * → { success, description }: a style reference's look in words, saved on the
 * look so runs don't need a vision call (see _shared/image-looks.ts).
 *
 * User-fixable problems return 200 with { success: false, error, code? } so the
 * client can show the message (supabase-js drops the body of non-2xx replies).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey, llmChatCompletion } from '../_shared/llm-client.ts';
import { deriveSlots } from '../_shared/blueprint-variables.ts';
import { fillLibraryElements, type BlueprintContext } from '../_shared/library-defaults.ts';
import { resolvePrompt, transformLibraryKeys } from '../_shared/prompt-resolver.ts';
import { normalizeDashes } from '../_shared/sanitize-ai-output.ts';
import { describeStyleReference } from '../_shared/image-references.ts';
import { MAX_LOOK_IMAGES } from '../_shared/image-looks.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PREVIEW_MODEL = 'anthropic/claude-haiku-4.5';
const OWN_SERVER_PREFIXES = ['ollama:', 'alibaba:', 'opencode:'];
const MAX_PROMPT_CHARS = 30_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const organizationId: string | undefined = body.organization_id;
    const pipeline: string = String(body.pipeline || '');
    const masterPrompt: string = String(body.master_prompt || '');
    const imagePrompt: string = String(body.image_prompt || '');
    const topic: string = String(body.topic || '').trim();
    const context = (body.context ?? null) as BlueprintContext | null;

    if (!organizationId) return json({ success: false, error: 'organization_id is required' }, 400);
    if (body.action === 'describe_look') return await describeLook(req, organizationId, body.images);
    if (!topic) return json({ success: false, error: 'Type a topic to preview.' });
    const template = pipeline === 'image_only' ? imagePrompt || masterPrompt : masterPrompt;
    if (!template.trim()) return json({ success: false, error: 'The brief is empty.' });
    if (template.length > MAX_PROMPT_CHARS) return json({ success: false, error: 'The prompt is too long to preview.' });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Same library elements a run would use for this blueprint.
    const slots = deriveSlots(template) as Array<{ library_table?: string; required?: boolean }>;
    const { elements } = await fillLibraryElements(supabase, {
      organizationId,
      existing: {},
      slots,
      context,
    });
    const libraryElements = transformLibraryKeys(elements);
    const used: Record<string, string> = {};
    for (const [key, label] of [['brand', 'brand'], ['icp', 'audience'], ['product', 'product'], ['character', 'person']] as const) {
      const el = libraryElements[key];
      if (el?.name) used[label] = String(el.name);
    }

    const slotValues: Record<string, string> = { topic, idea: topic, title: topic, context: topic };
    if (typeof body.idea_text === 'string' && body.idea_text.trim()) slotValues.idea_text = body.idea_text.trim();
    const resolved = resolvePrompt(template, slotValues, libraryElements, undefined, undefined, null).trim();

    if (pipeline === 'image_only') {
      // Image previews would spend an image generation; show the prompt instead.
      return json({ success: true, text: null, resolved_prompt: resolved, used, model: null });
    }

    const requested = typeof body.text_model === 'string' ? body.text_model : '';
    const model = OWN_SERVER_PREFIXES.some((p) => requested.startsWith(p)) ? requested : PREVIEW_MODEL;
    let openRouterApiKey: string | undefined;
    if (model === PREVIEW_MODEL) {
      const key = await resolveApiKey(supabase, organizationId, 'openrouter');
      if (!key) {
        return json({ success: false, code: 'MISSING_API_KEY', error: 'Previews need a working OpenRouter API key. Add or update it in Settings > Integrations.' });
      }
      openRouterApiKey = await decryptApiKey(key.key_encrypted);
    }

    const result = await llmChatCompletion({
      model,
      messages: [{ role: 'user', content: resolved }],
      temperature: 0.7,
      max_tokens: pipeline === 'rich_article' ? 3000 : 1200,
      openRouterApiKey,
      supabase,
      organizationId,
      timeoutMs: 55_000,
    });

    return json({
      success: true,
      text: normalizeDashes(result.content.trim()),
      resolved_prompt: resolved,
      used,
      model: result.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[preview-blueprint]', message);
    const friendly = /402|credits/i.test(message)
      ? 'Your OpenRouter balance is too low for a preview.'
      : /401|invalid/i.test(message)
        ? 'OpenRouter rejected the API key. Update it in Settings > Integrations.'
        : /timeout|abort/i.test(message)
          ? 'The preview took too long. Try again.'
          : 'The preview failed. Try again in a moment.';
    return json({ success: false, error: friendly, detail: message.slice(0, 300) }, 200);
  }
});

/** A style reference's look in words, for the Studio's Looks. */
async function describeLook(req: Request, organizationId: string, images: unknown): Promise<Response> {
  const urls = (Array.isArray(images) ? images : [])
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
    .slice(0, MAX_LOOK_IMAGES);
  if (urls.length === 0) return json({ success: false, error: 'Add an image first.' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    await assertOrgAccess(req, supabase, organizationId);
  } catch (authErr) {
    return unauthorized(authErr, corsHeaders);
  }
  const key = await resolveApiKey(supabase, organizationId, 'openrouter');
  if (!key) {
    return json({ success: false, code: 'MISSING_API_KEY', error: 'Describing a look needs a working OpenRouter API key. Add or update it in Settings > Integrations.' });
  }
  const description = await describeStyleReference(
    [{ role: 'style', label: 'look', urls }],
    await decryptApiKey(key.key_encrypted),
  );
  if (!description) return json({ success: false, error: "Couldn't describe this look. Try again, or write it yourself." });
  return json({ success: true, description: normalizeDashes(description) });
}
