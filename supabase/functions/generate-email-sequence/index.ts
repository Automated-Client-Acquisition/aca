/**
 * Generate Email Sequence Edge Function
 *
 * Generates a personalized multi-email sequence for a contact using their enrichment data.
 * The user provides a prompt with {{variables}} that get resolved per-contact.
 * Requires company analysis to be run first (enrichment_data must exist).
 *
 * Endpoint: POST /generate-email-sequence
 * Body: {
 *   contactId: string,
 *   emailCount: number (1-7),
 *   config: {
 *     prompt: string,               // Main creative brief with {{variables}}
 *     delayPattern?: string,        // Legacy - 'aggressive' | 'standard' | 'gentle'
 *     tone?: string,                // Legacy
 *     ctaType?: string,             // Legacy
 *     customCta?: string,           // Legacy
 *     productId?: string,           // Legacy
 *     outcomes?: string[],          // Legacy
 *   },
 *   model?: string,                 // LLM model to use
 * }
 */

import { sanitizeAIEmailBody } from '../_shared/sanitize-ai-output.ts';
import { repairSenderPlaceholders } from '../_shared/repair-sender-placeholders.ts';
import { DEFAULT_FAST_TEXT_MODEL } from '../_shared/default-models.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { isOllamaModel, resolveOllamaConfig, resolveChatEndpoint, type ChatEndpoint } from '../_shared/llm-client.ts';
import { retrieveChunksByDocIds } from '../_shared/knowledge-retrieval.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateEmailSequenceRequest {
  contactId: string;
  emailCount: number;
  config: {
    prompt: string;
    // Legacy fields for backward compatibility
    delayPattern?: string;
    tone?: string;
    ctaType?: string;
    customCta?: string;
    productId?: string;
    outcomes?: string[];
    knowledgeDocumentIds?: string[];
  };
  model?: string;
  /** 0-1 creativity. Defaults to 0.7 when omitted. */
  temperature?: number;
  sequenceName?: string;
  /**
   * Generate and return the emails WITHOUT persisting them. Used by the Preview
   * button in Lead processing setup so testing a brief runs the exact production
   * path — same system prompt, product context, enrichment and model — without
   * archiving the contact's real generated sequences.
   */
  preview?: boolean;
}

interface GeneratedEmail {
  step: number;
  subject: string;
  body: string;
  delay_days: number;
}

type PromptVariableResolution = {
  name: string;
  value: string;
  source: 'Contact' | 'Company analysis' | 'Buying signal' | 'Product context' | 'Workflow context' | 'Sender' | 'Missing';
};

// No mailbox/sending account is chosen until send-time rotation, so there is no
// real value to substitute here — but these ARE valid variables (see
// src/lib/message-variables.ts), just resolved later. Left as literal {{tokens}}
// in the resolved brief (instead of being deleted by the strip-unknown safety
// net below) so an AI writer that's told to reference the sender by name can
// echo the token into its output for email-sequence-processor / sequence-sender
// to resolve at actual send time — same pass-through idea as {{email_body_N}}.
const SENDER_PASSTHROUGH_TOKENS = new Set(['sender_name', 'sender_first_name', 'sender_last_name']);

// Delay patterns in days between emails - default standard cadence
const DELAY_PATTERNS: Record<string, number[]> = {
  aggressive: [0, 1, 2, 2, 3, 3, 4],
  standard: [0, 2, 3, 4, 5, 7, 7],
  gentle: [0, 3, 5, 7, 10, 14, 14],
};

// growth_signals is an array of { signal, evidence, interpretation, confidence,
// email_usability, safe_use } objects, not plain strings - extract the short label.
function growthSignalLabels(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((s) => (s && typeof s === 'object' ? String((s as Record<string, unknown>).signal ?? '') : String(s ?? '')))
    .filter(Boolean);
}

// Full per-signal breakdown for the generation prompt - same evidence/confidence/
// safe-use treatment as the primary_need block, so the model doesn't have to guess
// which signals are stated fact vs. inference.
function formatGrowthSignalsForPrompt(val: unknown): string {
  if (!Array.isArray(val) || val.length === 0) return 'N/A';
  return val
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return `- ${String(raw)}`;
      const s = raw as Record<string, unknown>;
      return [
        `- Signal: ${s.signal || 'N/A'}`,
        s.evidence ? `  Evidence: ${s.evidence}` : '',
        s.confidence ? `  Confidence: ${s.confidence}` : '',
        s.email_usability ? `  Email usability: ${s.email_usability}` : '',
        s.safe_use ? `  Safe use: ${s.safe_use}` : '',
      ].filter(Boolean).join('\n');
    })
    .join('\n');
}

/**
 * Resolve {{variable}} tokens in a prompt using contact and enrichment data.
 * Aligned with replaceTemplateVariables() from workflow-utils.ts.
 */
function resolvePromptVariables(
  prompt: string,
  contact: Record<string, unknown>,
  enrichmentData: Record<string, unknown>,
  productData?: Record<string, unknown> | null,
  extraVars?: Record<string, string>,
  discoveryMetadata?: Record<string, unknown> | null,
  onResolved?: (resolutions: PromptVariableResolution[]) => void,
): string {
  let result = prompt;

  // Helper to safely stringify a value (arrays get joined with commas)
  const str = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  };

  // Contact fields
  const jobTitle = str(contact.job_title) || '';
  const contactVars: Record<string, string> = {
    first_name: str(contact.first_name) || str(contact.display_name)?.split(' ')[0] || 'there',
    last_name: str(contact.last_name) || '',
    full_name: str(contact.display_name) || '',
    company: str(contact.company) || '',
    job_title: jobTitle,
    // {{position}} is the picker's own label for this same field (src/lib/message-variables.ts)
    // — without this alias it fell straight through to the strip-unknown safety net.
    position: jobTitle,
    primary_email: str(contact.primary_email) || '',
    city: str(contact.city) || '',
    country: str(contact.country) || '',
    // {{location}} is documented as a contact variable but crm_contacts has no
    // `location` column (campaign-processor's `contact.location` reference is
    // always undefined for the same reason) — derive it from city/country instead.
    location: [str(contact.city), str(contact.country)].filter(Boolean).join(', '),
    // company_industry is the canonical typed firmographics column (2026-09-04
    // migration); crm_contacts has never had a plain `industry` column.
    industry: str(contact.company_industry) || '',
    company_website: str(contact.company_website) || '',
  };

  // Enrichment fields (ai_ prefixed, matching workflow-utils convention)
  const enrichmentVars: Record<string, string> = {
    ai_primary_need: str(enrichmentData.primary_need),
    ai_primary_need_reason: str(enrichmentData.primary_need_reasoning),
    ai_primary_need_evidence: str(enrichmentData.primary_need_evidence),
    ai_primary_need_confidence: str(enrichmentData.primary_need_confidence),
    ai_cold_email_angle: str(enrichmentData.cold_email_angle),
    ai_company_niche: str(enrichmentData.company_niche),
    ai_company_offering: str(enrichmentData.company_offering),
    ai_company_target: str(enrichmentData.company_target),
    ai_company_tagline: str(enrichmentData.company_tagline),
    ai_best_hook: str(enrichmentData.best_post_hook),
    ai_linkedin_topic_1: Array.isArray(enrichmentData.linkedin_topics) && enrichmentData.linkedin_topics.length > 0
      ? String(enrichmentData.linkedin_topics[0])
      : '',
    ai_priority_1: Array.isArray(enrichmentData.company_priorities) && enrichmentData.company_priorities.length > 0
      ? String(enrichmentData.company_priorities[0])
      : '',
    ai_growth_signal_1: growthSignalLabels(enrichmentData.growth_signals)[0] || '',
    ai_latest_funding: str(enrichmentData.latest_funding_round),
    ai_funding_amount: str(enrichmentData.funding_amount),
    // Full array versions (joined with commas)
    ai_company_verbiage: str(enrichmentData.company_verbiage),
    ai_company_priorities: str(enrichmentData.company_priorities),
    ai_growth_signals: growthSignalLabels(enrichmentData.growth_signals).join(', '),
    ai_linkedin_topics: str(enrichmentData.linkedin_topics),
    ai_company_tone: str(enrichmentData.company_tone),
    ai_selected_outcome: str(enrichmentData.selected_outcome),
    ai_icp_score: str(enrichmentData.icp_score),
    // ICP qualification fields (analyze-company's icp_score section) — captured
    // for scoring/filtering but never exposed as a message variable until now.
    ai_company_size: str(enrichmentData.estimated_company_size),
    ai_revenue_model: str(enrichmentData.revenue_model),
    // Aliases for names that don't match this resolver's own convention but
    // are close enough that a user reasonably expects them to work: the
    // canonical picker/preview label ("Observed Evidence", "Need Confidence",
    // "Safe Cold-Email Angle") reads naturally as these shorter tokens.
    ai_observed_evidence: str(enrichmentData.primary_need_evidence),
    ai_need_confidence: str(enrichmentData.primary_need_confidence),
    ai_safe_cold_email_angle: str(enrichmentData.cold_email_angle),
    linkedin_topic: Array.isArray(enrichmentData.linkedin_topics) && enrichmentData.linkedin_topics.length > 0
      ? String(enrichmentData.linkedin_topics[0])
      : '',
  };

  // Buying-signal fields from crm_contacts.discovery_metadata. Mirrors the
  // send-time mapping in workers/sequence-sender and campaign-processor: the
  // event block uses bare `signal_*` keys, the company/person block uses
  // `ai_signal_*` keys. Without these, every {{ai_signal_*}} token in a creative
  // brief fell through to the safety net below and was stripped, so the writer
  // never saw the signal it was told to open with.
  const discovery = discoveryMetadata || {};
  const signalVars: Record<string, string> = {
    ai_signal_type: str(discovery.signal_type),
    ai_signal_date: str(discovery.signal_date),
    ai_signal_detail: str(discovery.signal_detail),
    ai_signal_context: str(discovery.signal_outreach_context),
    // Bare aliases — discovery_metadata's OWN storage keys for these fields
    // (signal_type/signal_date/signal_detail) drop the ai_ prefix, so a brief
    // written against "what's actually in the data" instead of the ai_signal_*
    // picker convention was silently losing every one of these.
    signal_type: str(discovery.signal_type),
    signal_date: str(discovery.signal_date),
    signal_detail: str(discovery.signal_detail),
    signal_context: str(discovery.signal_outreach_context),
    ai_signal_source_url: str(discovery.signal_source_url || discovery.directory_evidence_url),
    ai_signal_amount: str(discovery.ai_signal_amount),
    ai_signal_investors: str(discovery.ai_signal_investors),
    ai_signal_person: str(discovery.ai_signal_person),
    ai_signal_new_role: str(discovery.ai_signal_new_role),
    ai_signal_company_website: str(discovery.ai_signal_company_website),
    ai_signal_company_linkedin: str(discovery.ai_signal_company_linkedin),
    ai_signal_company_industry: str(discovery.ai_signal_company_industry),
    // push-moltsets-to-aca stopped mirroring these into ai_signal_* keys, so
    // fall back to the canonical company_* keys it still writes.
    ai_signal_company_size: str(discovery.ai_signal_company_size || discovery.company_employee_range),
    ai_signal_revenue: str(discovery.ai_signal_revenue || discovery.company_revenue_range),
  };

  // Product fields (from library_products)
  const productVars: Record<string, string> = productData ? {
    product_name: str(productData.name),
    product_description: str(productData.description),
    product_features: str(productData.features),
    // library_products stores benefits in `key_benefits` (that's what the query selects);
    // `benefits` doesn't exist, so {{product_benefits}} was always resolving to empty.
    product_benefits: str(productData.key_benefits ?? productData.benefits),
  } : {};

  // Replace all {{variable}} tokens (case-insensitive)
  const variableGroups: Array<[PromptVariableResolution['source'], Record<string, string>]> = [
    ['Contact', contactVars],
    ['Company analysis', enrichmentVars],
    ['Buying signal', signalVars],
    ['Product context', productVars],
    ['Workflow context', extraVars || {}],
  ];
  const allVars = Object.assign({}, ...variableGroups.map(([, variables]) => variables));

  if (onResolved) {
    const tokens = [...new Set(Array.from(prompt.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), (match) => match[1]))];
    onResolved(tokens.map((name) => {
      const key = name.toLowerCase();
      const group = [...variableGroups].reverse().find(([, variables]) => key in variables);
      if (group) return { name, value: allVars[key] || '', source: group[0] };
      if (SENDER_PASSTHROUGH_TOKENS.has(key)) return { name, value: '(resolved at send)', source: 'Sender' };
      return { name, value: '', source: 'Missing' };
    }));
  }

  for (const [key, value] of Object.entries(allVars)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), value);
  }

  // SAFETY NET: strip any remaining {{...}} tokens so the raw variable name never
  // leaks into the email the LLM writes (e.g. {{product_name}} when no product was
  // selected, or a mistyped variable). Without this, the model tends to echo the
  // literal token into the copy. We remove the token and collapse the leftover
  // whitespace/empty-delimiter debris (e.g. "(Description:  | Features: )").
  // Sender tokens are exempt — see SENDER_PASSTHROUGH_TOKENS above.
  const unresolved = [...new Set((result.match(/\{\{\s*[\w.]+\s*\}\}/g) || []))]
    .filter((token) => {
      const key = token.replace(/[{}]/g, '').trim().toLowerCase();
      return !SENDER_PASSTHROUGH_TOKENS.has(key);
    });
  if (unresolved.length > 0) {
    console.warn(`resolvePromptVariables: stripping ${unresolved.length} unresolved token(s): ${unresolved.join(', ')}`);
    result = result
      .replace(/\{\{\s*[\w.]+\s*\}\}/g, (match) => {
        const key = match.replace(/[{}]/g, '').trim().toLowerCase();
        return SENDER_PASSTHROUGH_TOKENS.has(key) ? match : '';
      })
      // Tidy up "(Description:  | Features: )" style debris left behind
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.;:)])/g, '$1')
      .replace(/\(\s*[|,;:\s]*\)/g, '')
      .replace(/ +\n/g, '\n');
  }

  return result;
}

/**
 * Build a legacy prompt from old-style config fields (tone, ctaType, outcomes).
 * Used as fallback when config.prompt is missing but legacy fields exist.
 */
function buildLegacyPrompt(config: GenerateEmailSequenceRequest['config']): string {
  const parts: string[] = [];

  if (config.tone) {
    const toneMap: Record<string, string> = {
      professional: 'Use a professional, business-appropriate tone.',
      casual: 'Use a friendly, conversational tone.',
      consultative: 'Use a consultative tone, position as a helpful advisor.',
      friendly: 'Use a warm, personable tone.',
    };
    parts.push(toneMap[config.tone] || '');
  }

  if (config.outcomes && config.outcomes.length > 0) {
    parts.push(`Outcomes we deliver: ${config.outcomes.join(', ')}.`);
  }

  if (config.ctaType) {
    const ctaMap: Record<string, string> = {
      meeting: 'End with a soft ask for a brief call or meeting.',
      reply: 'End with an open-ended question that encourages a reply.',
      demo: 'End with an invitation to see a demo.',
      download: 'End with a resource offer.',
      custom: config.customCta ? `End with: "${config.customCta}"` : 'End with a soft call-to-action.',
    };
    parts.push(ctaMap[config.ctaType] || '');
  }

  return parts.filter(Boolean).join('\n') || 'Write personalized cold outreach emails.';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const body: GenerateEmailSequenceRequest = await req.json();
    const { contactId, emailCount, config, model, temperature, sequenceName, preview } = body;

    // Validate required fields
    if (!contactId) {
      return new Response(
        JSON.stringify({ success: false, error: 'contactId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1 is allowed: lead processing derives the count from the destination
    // sequence, which may well be a single-email sequence.
    if (!emailCount || emailCount < 1 || emailCount > 7) {
      return new Response(
        JSON.stringify({ success: false, error: 'emailCount must be between 1 and 7' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default model
    const llmModel = model || DEFAULT_FAST_TEXT_MODEL;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!encryptionKey) {
      console.error('Missing ENCRYPTION_KEY environment variable');
      return new Response(
        JSON.stringify({ success: false, error: 'Server encryption key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch contact with enrichment data
    const { data: contact, error: contactError } = await supabase
      .from('crm_contacts')
      .select('id, organization_id, display_name, first_name, last_name, company, job_title, primary_email, city, country, company_website, company_industry, enrichment_data, enriched_at, notion_preview_url, discovery_metadata')
      .eq('id', contactId)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ success: false, error: 'Contact not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, contact.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // STRICT: Require enrichment data
    const enrichmentData = contact.enrichment_data as Record<string, unknown> | null;
    // Buying signal, when the contact came from a signal pack / signal agent.
    // Optional — a contact with no signal just gets no signal block.
    const discoveryMetadata = contact.discovery_metadata as Record<string, unknown> | null;
    if (!enrichmentData || Object.keys(enrichmentData).length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Company analysis required. Please run "Analyze Companies" first to generate personalization data.',
          requiresAnalysis: true,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for key enrichment fields
    if (!enrichmentData.primary_need && !enrichmentData.company_niche) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Insufficient enrichment data. Please re-run company analysis to generate primary_need and company context.',
          requiresAnalysis: true,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch product data if productId is provided (injects product context into AI prompt)
    let productData: Record<string, unknown> | null = null;
    let productScore: Record<string, unknown> | null = null;

    if (config.productId) {
      const { data: product } = await supabase
        .from('library_products')
        .select('name, description, features, key_benefits, category')
        .eq('id', config.productId)
        .eq('organization_id', contact.organization_id)
        .single();

      if (product) {
        productData = product;

        // Fetch linked ICPs for buyer intelligence
        const { data: icpFits } = await supabase
          .from('product_icp_fit')
          .select('fit_score, library_icps(name, pain_points, desires, objections)')
          .eq('product_id', config.productId)
          .order('fit_score', { ascending: false })
          .limit(3);

        if (icpFits?.length) {
          const icps = icpFits.map((f: Record<string, unknown>) => f.library_icps).filter(Boolean) as Record<string, unknown>[];
          productData.icp_pain_points = icps.flatMap((i) => (i.pain_points as string[]) || []).filter(Boolean);
          productData.icp_desires = icps.flatMap((i) => (i.desires as string[]) || []).filter(Boolean);
          productData.icp_objections = icps.flatMap((i) => (i.objections as string[]) || []).filter(Boolean);
        }

        // Fetch linked marketing blocks (hooks, angles)
        const { data: blockFits } = await supabase
          .from('product_block_fit')
          .select('fit_score, library_blocks(block_type, name, content)')
          .eq('product_id', config.productId)
          .order('fit_score', { ascending: false })
          .limit(10);

        if (blockFits?.length) {
          const blocks = blockFits.map((f: Record<string, unknown>) => f.library_blocks).filter(Boolean) as Record<string, unknown>[];
          const byType = (type: string) => blocks.filter((b) => b.block_type === type).map((b) => String(b.content || b.name));
          productData.marketing_hooks = byType('hook');
          productData.marketing_primary_angle = byType('angle')[0] || null;
        }

        // Fetch product-specific score for this contact
        const { data: scoreData } = await supabase
          .from('contact_product_scores')
          .select('icp_score, primary_need, primary_need_reasoning, selected_outcome')
          .eq('contact_id', contactId)
          .eq('product_id', config.productId)
          .order('analyzed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (scoreData) {
          productScore = scoreData;
        }

        console.log(`Product data loaded: ${product.name}, painPoints=${(productData.icp_pain_points as string[] || []).length}, hooks=${(productData.marketing_hooks as string[] || []).length}, hasScore=${!!productScore}`);
      } else {
        console.warn(`Product ${config.productId} not found, continuing without product context`);
      }
    }

    // Get OpenRouter API key (optional when the selected model runs on Ollama -
    // still used for knowledge-base embeddings when present)
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', contact.organization_id)
      .eq('provider', 'openrouter')
      .maybeSingle();

    const usingOllama = isOllamaModel(llmModel);
    if (!apiKeyData && !usingOllama) {
      console.error('No OpenRouter API key found for organization:', contact.organization_id);
      return new Response(
        JSON.stringify({ success: false, error: 'OpenRouter API key not configured. Please add your OpenRouter API key in Settings → API Keys.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let openRouterKey = '';
    if (apiKeyData) {
      try {
        openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
      } catch (decryptError) {
        console.error('Failed to decrypt OpenRouter API key:', decryptError);
        if (!usingOllama) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to decrypt API key. Please re-add your OpenRouter API key in Settings.' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    let chatEndpoint: ChatEndpoint;
    if (usingOllama) {
      const ollamaConfig = await resolveOllamaConfig(supabase, contact.organization_id);
      if (!ollamaConfig) {
        return new Response(
          JSON.stringify({ success: false, error: 'Ollama is not configured for this organization' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      chatEndpoint = await resolveChatEndpoint({ model: llmModel, ollamaConfig });
    } else {
      chatEndpoint = await resolveChatEndpoint({ model: llmModel, openRouterApiKey: openRouterKey, referer: supabaseUrl });
    }

    // Retrieve knowledge base context if documents are specified
    let knowledgeContext = '';
    if (config.knowledgeDocumentIds && config.knowledgeDocumentIds.length > 0 && openRouterKey) {
      try {
        const kbQuery = `${contact.company || ''} ${enrichmentData.company_niche || ''} ${enrichmentData.primary_need || ''} ${config.prompt?.slice(0, 200) || ''}`.trim();
        const kbResult = await retrieveChunksByDocIds(
          supabase,
          contact.organization_id,
          config.knowledgeDocumentIds,
          kbQuery,
          openRouterKey,
          4,
        );
        if (kbResult.chunks.length > 0) {
          knowledgeContext = kbResult.chunks.map((chunk, i) => `[${i + 1}] ${chunk.content}`).join('\n\n---\n\n');
          console.log(`KB retrieval: ${kbResult.chunks.length} chunks retrieved for ${contact.display_name}`);
        }
      } catch (kbError) {
        console.warn('Knowledge base retrieval failed (non-fatal):', kbError);
      }
    }

    // Resolve the user's prompt - use new prompt-centric flow or legacy fallback
    const rawPrompt = config.prompt || buildLegacyPrompt(config);
    let variableResolutions: PromptVariableResolution[] = [];
    const resolvedPrompt = resolvePromptVariables(
      rawPrompt,
      contact,
      enrichmentData,
      productData,
      {
        notion_preview_url: contact.notion_preview_url || '',
        ...(productScore?.selected_outcome ? { ai_selected_outcome: String(productScore.selected_outcome) } : {}),
        // The system prompt already tells the model "Generate a N-email sequence"
        // separately, but a brief that also writes {{emailCount}} or {{email_count}}
        // inline (e.g. "Write a {{emailCount}}-email sequence...") had that token
        // silently stripped — emailCount was a request parameter, never a
        // resolvable variable. Both spellings map to the same value since the
        // replace regex is case-insensitive but not separator-insensitive.
        email_count: String(emailCount),
        emailcount: String(emailCount),
      },
      discoveryMetadata,
      (resolutions) => { variableResolutions = resolutions; },
    );

    // Get delay pattern (default to standard)
    const delays = DELAY_PATTERNS[config.delayPattern || 'standard'] || DELAY_PATTERNS.standard;

    // Build conditional product context for the AI system prompt
    const productContextBlock = productData ? `
**YOUR PRODUCT/SOLUTION** (this is what the sender sells - use it when the creative brief references it):
- Product: ${productData.name || 'Unknown'}
${productData.description ? `- What it does: ${productData.description}` : ''}
${productData.features ? `- Core capabilities: ${productData.features}` : ''}
${(productData.key_benefits as string[] | undefined)?.length ? `- Results it delivers: ${(productData.key_benefits as string[]).join('; ')}` : ''}
${(productData.icp_pain_points as string[] | undefined)?.length ? `- Pain points it solves: ${(productData.icp_pain_points as string[]).slice(0, 5).join('; ')}` : ''}
${(productData.icp_desires as string[] | undefined)?.length ? `- What buyers want: ${(productData.icp_desires as string[]).slice(0, 5).join('; ')}` : ''}
${productData.marketing_primary_angle ? `- Key angle: ${productData.marketing_primary_angle}` : ''}
${(productData.marketing_hooks as string[] | undefined)?.length ? `- Proven hooks: ${(productData.marketing_hooks as string[]).slice(0, 3).join('; ')}` : ''}
${productScore?.selected_outcome ? `- Best outcome for THIS prospect: ${productScore.selected_outcome}` : ''}
${productScore?.primary_need ? `- Their specific need (product-fit, unconfirmed hypothesis): ${productScore.primary_need}` : ''}

**HOW TO USE PRODUCT CONTEXT**:
- This is the sender's actual product/service. When the creative brief references {{product_name}}, {{product_description}}, or {{ai_selected_outcome}}, use the product data above to write accurately about what the sender offers.
- Write as a domain expert who uses this product to deliver results - not as a generic salesperson
- Use the product's pain points, benefits, and outcomes to frame the value proposition naturally
- Do NOT invent capabilities, services, or outcomes that aren't listed above - stay accurate to the product data
- Frame in terms of results and outcomes, not feature lists

**HOW TO USE THE PROSPECT'S "NEED"**:
- Any "Primary Need" / "specific need" text below is an unconfirmed commercial HYPOTHESIS, not a fact about this prospect - never state it in the email as something you know to be true (avoid "I noticed you're struggling with X").
- The Safe Cold-Email Angle is an INSTRUCTION for you, not a line to copy into the email verbatim - it tells you what's safe to ask about or reference, and what you must NOT imply or claim. Write your own natural phrasing from it; do not paste it as-is.
- When a Confidence value is given and it's low or medium, write from the Safe Cold-Email Angle's instruction rather than the Primary Need hypothesis - phrase your own line as a genuine, low-pressure question, not an assertion.
- Never invent urgency, pain, or a negative narrative (e.g. "feast-or-famine", "stuck relying on X") that isn't directly stated in the Observed Evidence. If the evidence just shows something healthy (e.g. most business comes from referrals), do not spin that into a problem - ask about it neutrally instead.
- Do not add specifics (industries, geographies, scale) beyond what the Observed Evidence and Safe Cold-Email Angle actually state, even if they seem plausible from other context in this prompt.
` : '';

    // Build URL guardrail instruction
    const notionUrl = contact.notion_preview_url || '';
    const urlGuardrail = notionUrl
      ? `\n**DELIVERABLE URL**: The EXACT URL to use when referencing a deliverable, preview doc, or analysis is: ${notionUrl}\nDo NOT alter this URL. Do NOT make up any other URLs. Use this exact URL verbatim.`
      : `\n**URL POLICY**: There is NO deliverable URL for this contact. Do NOT reference any external document, preview page, analysis page, or URL. Do NOT make up or hallucinate any URLs. If the creative brief mentions a deliverable link, IGNORE that instruction - no link exists.`;

    // Build the AI prompt - optimized for reply rates
    const systemPrompt = `You are an elite B2B cold email copywriter. Follow the creative brief exactly - it defines the sequence structure, tone, style, CTAs, and rules.

**YOUR MISSION**: Generate a ${emailCount}-email sequence following the creative brief provided below.
${productContextBlock}
**SIGNATURE RULE**: NEVER end the email with a signature, sign-off name, or closing (e.g. "Best,", "Cheers,", "Regards,"), or placeholders like "[Your Name]", "[Signature]", "{{signature}}". The signature is appended automatically after the email body. This rule is about the CLOSING only - it does not forbid naming the sender earlier in the email (see SENDER NAME below).

**SENDER NAME**: The actual sender is picked later (mailbox rotation at send time), so you never know the real name while writing. If the creative brief asks you to introduce yourself by name in the body (e.g. "I'm [name] from {{company_name}}", not a sign-off), write the literal placeholder {{sender_first_name}} (and {{sender_last_name}} if a last name is asked for) exactly as shown, character for character, in place of the name - e.g. "I'm {{sender_first_name}} from Acme." Do NOT invent a name, and do NOT drop the self-introduction and fall back to naming only the company (e.g. never write "I'm from Acme" when the brief calls for a personal introduction) - the placeholder will be replaced with the real sender's first name before the email is sent.

**PUNCTUATION RULE**: NEVER use an em dash or an en dash. Use a plain hyphen, a comma, or a full stop. Em dashes are the single clearest tell that a cold email was written by AI, and these emails go to real prospects.

**OUTPUT FORMAT**:
Return a JSON array of exactly ${emailCount} emails:
[
  {
    "step": 1,
    "subject": "subject line here",
    "body": "<div>First sentence or greeting.</div><br><div>Next paragraph of the email body.</div><br><div>Closing line or question.</div><br>"
  },
  ...
]

**BODY HTML FORMATTING** (CRITICAL - follow exactly):
- Wrap each line or sentence group in a <div>...</div> tag
- Separate each <div> block with a <br> tag between them
- The body MUST start with a <div> and end with a <br> after the last </div>
- Do NOT use <p>, <span>, or any other tags - ONLY <div> and <br>
- Do NOT include any style attributes
- Example body: "<div>Hi John,</div><br><div>I noticed your team is scaling fast.</div><br><div>What's been the biggest bottleneck?</div><br>"

Return ONLY valid JSON. No markdown, no explanation.`;

    // Build product fit intelligence section for user prompt (if product score available)
    const productFitSection = productScore ? `
**PRODUCT FIT INTELLIGENCE** (from our analysis of this prospect against our product):
- Product-Specific Need (unconfirmed hypothesis - do not state as fact): ${productScore.primary_need || 'Not scored'}
- Why This Need: ${productScore.primary_need_reasoning || 'N/A'}
- Best Outcome We Can Deliver: ${productScore.selected_outcome || 'Not identified'}
- ICP Fit Score: ${productScore.icp_score || 'N/A'}/100` : '';

    // Buying-signal context. Resolving {{ai_signal_*}} inside the brief is not
    // enough on its own: a brief that says "open with why we reached out now"
    // gives the model nothing to work from unless the signal is also in front of
    // it. Only rendered when a signal actually exists, so ordinary contacts are
    // unaffected.
    const signalLines = [
      ['What happened', discoveryMetadata?.signal_detail],
      ['Why it matters for outreach', discoveryMetadata?.signal_outreach_context],
      ['Signal type', discoveryMetadata?.signal_type],
      ['When', discoveryMetadata?.signal_date],
      ['Person involved', discoveryMetadata?.ai_signal_person],
      ['Their new role', discoveryMetadata?.ai_signal_new_role],
      ['Amount', discoveryMetadata?.ai_signal_amount],
      ['Investors', discoveryMetadata?.ai_signal_investors],
      ['Source', discoveryMetadata?.signal_source_url || discoveryMetadata?.directory_evidence_url],
    ]
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(([label, value]) => `- ${label}: ${value}`);

    const signalContextBlock = signalLines.length > 0 ? `
**BUYING SIGNAL** (the reason we are reaching out NOW - this is the strongest personalization available, use it in email 1 unless the creative brief says otherwise):
${signalLines.join('\n')}

**HOW TO USE THE SIGNAL**:
- Reference it the way a peer who reads the news would: specific, brief, no congratulation-bait.
- Do NOT restate every field. Pick the one detail that earns the opening line.
- Do NOT invent details beyond what is listed above, and do NOT paste the source URL into the email unless the brief asks for it.
` : '';

    const userPrompt = `**YOUR CREATIVE BRIEF** (HIGHEST PRIORITY - these instructions override system defaults when they conflict):
${resolvedPrompt}

**CONTACT DETAILS**:
- Name: ${contact.first_name || contact.display_name?.split(' ')[0] || 'there'}
- Full Name: ${contact.display_name || 'Unknown'}
- Company: ${contact.company || 'their company'}
- Role: ${contact.job_title || 'Unknown'}

**ENRICHMENT DATA** (use this to personalize beyond what the brief specifies):
- Observed Evidence: ${enrichmentData.primary_need_evidence || 'None recorded'}
- Commercial Hypothesis (unconfirmed - phrase as a possibility, never a fact): ${enrichmentData.primary_need || 'Not specified'}
- Confidence: ${enrichmentData.primary_need_confidence || 'Unknown'}
- Safe Cold-Email Angle: ${enrichmentData.cold_email_angle || 'N/A'}
- Why This Matters: ${enrichmentData.primary_need_reasoning || 'N/A'}
- Company Niche: ${enrichmentData.company_niche || 'N/A'}
- What They Sell: ${enrichmentData.company_offering || 'N/A'}
- Their Customers: ${enrichmentData.company_target || 'N/A'}
- Their Language: ${Array.isArray(enrichmentData.company_verbiage) ? enrichmentData.company_verbiage.join(', ') : 'N/A'}
- Their Priorities: ${Array.isArray(enrichmentData.company_priorities) ? enrichmentData.company_priorities.join(', ') : 'N/A'}
- Their Tone: ${enrichmentData.company_tone || 'professional'}
- Growth Signals (each has its own Evidence/Confidence/Safe use - do not claim more than "Safe use" allows):
${formatGrowthSignalsForPrompt(enrichmentData.growth_signals)}
${enrichmentData.linkedin_topics ? `- LinkedIn Topics: ${Array.isArray(enrichmentData.linkedin_topics) ? enrichmentData.linkedin_topics.join(', ') : 'N/A'}` : ''}
${enrichmentData.best_post_hook ? `- LinkedIn Angle: ${enrichmentData.best_post_hook}` : ''}
${signalContextBlock}
${productFitSection}
${urlGuardrail}
${knowledgeContext ? `
**KNOWLEDGE BASE** (use this information to add specific, accurate details about what we do and offer):
${knowledgeContext}
` : ''}
**SETTINGS**:
- Number of Emails: ${emailCount}

Generate the email sequence now.`;

    console.log(`Generating ${emailCount}-email sequence for contact ${contactId} using model ${llmModel}`);

    // max_tokens is the budget for EVERYTHING the model emits, and on a
    // reasoning model (qwen3.x, grok, o-series…) the thinking pass is billed
    // against it first. A flat 4000 was enough for one email and nothing else:
    // a 5-email sequence with a detailed creative brief burned the whole budget
    // thinking, so the JSON came back truncated ("Failed to parse generated
    // emails") or never started ("No content in AI response") — while a
    // non-reasoning model on the identical prompt succeeded. Scaling the budget
    // alone still wasn't enough (qwen3.7-flash ate all 8500 of a 3-email run),
    // because nothing bounded the thinking pass — so cap it explicitly below and
    // size the budget from the JSON we actually need plus reasoning headroom.
    const contentBudget = 700 + emailCount * 900;
    const baseMaxTokens = Math.min(32000, contentBudget + 6000);

    // OpenRouter splits max_tokens between reasoning and content by effort:
    // 'low' hands the thinking pass ~20% and leaves the rest for the JSON.
    // Non-reasoning models ignore the field; Ollama's /v1 endpoint doesn't
    // speak it, so only send it to OpenRouter.
    const reasoningCap = chatEndpoint.provider === 'openrouter'
      ? { reasoning: { effort: 'low' } }
      : {};

    let content: string | undefined;
    let finishReason: string | undefined;
    let maxTokens = baseMaxTokens;

    // One automatic retry on truncation with a doubled budget. Telling the user
    // to "generate fewer emails" is a worse answer than just paying for the
    // tokens the model turned out to need.
    for (let attempt = 0; attempt < 2; attempt++) {
      // Call the LLM (OpenRouter or the org's Ollama server)
      const aiResponse = await fetch(chatEndpoint.url, {
        method: 'POST',
        headers: chatEndpoint.headers,
        body: JSON.stringify({
          model: chatEndpoint.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: typeof temperature === 'number' ? Math.min(1, Math.max(0, temperature)) : 0.7,
          max_tokens: maxTokens,
          ...reasoningCap,
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error('OpenRouter error:', aiResponse.status, errorText);
        // Everything that wasn't 401/429 used to collapse into "API error",
        // which sent people hunting for a broken prompt when the real answer
        // was a billing wall: a spend-capped key answers 403 "Key limit
        // exceeded" and an out-of-credit account answers 402. Name the
        // account-level cases, and pass the provider's own message through for
        // the rest so the next unknown status isn't invisible too.
        let providerMessage = '';
        try {
          providerMessage = JSON.parse(errorText)?.error?.message || '';
        } catch { /* not JSON — fall through to the generic text below */ }

        const reason = aiResponse.status === 401
          ? 'Invalid API key'
          : aiResponse.status === 429
            ? 'Rate limited'
            : aiResponse.status === 402
              ? `Out of AI credits${providerMessage ? ` - ${providerMessage}` : ''}`
              : aiResponse.status === 403
                ? `AI key limit reached${providerMessage ? ` - ${providerMessage}` : ''}`
                : `API error ${aiResponse.status}${providerMessage ? ` - ${providerMessage}` : ''}`;

        return new Response(
          JSON.stringify({ success: false, error: `AI generation failed: ${reason}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const aiData = await aiResponse.json();
      const choice = aiData.choices?.[0];
      content = choice?.message?.content;
      finishReason = choice?.finish_reason;

      if (content && finishReason !== 'length') break;

      console.warn('Truncated AI response:', JSON.stringify({
        attempt, maxTokens, finishReason, hasContent: !!content,
        usage: aiData.usage, model: chatEndpoint.model,
      }));

      if (attempt === 0) maxTokens = Math.min(48000, maxTokens * 2);
    }

    if (!content) {
      // Say which of the two it was. "No content in AI response" sent everyone
      // hunting for a broken prompt when the real answer was a model that spent
      // its whole output budget thinking.
      throw new Error(finishReason === 'length'
        ? `${llmModel} used its entire ${maxTokens}-token output budget on reasoning before writing any email, even after a retry with a larger budget. Pick a model with a smaller reasoning pass.`
        : `${llmModel} returned an empty response${finishReason ? ` (finish_reason: ${finishReason})` : ''}.`);
    }

    console.log('AI response received, parsing...');

    // Parse the generated emails
    let generatedEmails: GeneratedEmail[];
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                       content.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, content];
      const jsonText = jsonMatch[1] || content;
      const parsed = JSON.parse(jsonText.trim());

      // Add delay_days to each email based on pattern
      generatedEmails = parsed.map((email: { step: number; subject: string; body: string }, index: number) => ({
        step: email.step || index + 1,
        subject: repairSenderPlaceholders(sanitizeAIEmailBody(email.subject)),
        body: repairSenderPlaceholders(sanitizeAIEmailBody(email.body)),
        delay_days: delays[index] || delays[delays.length - 1],
      }));

      console.log(`Successfully parsed ${generatedEmails.length} emails`);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Raw content:', content);
      throw new Error(finishReason === 'length'
        ? `${llmModel} was cut off mid-sequence at its ${maxTokens}-token output budget even after a retry with a larger budget, so the emails came back incomplete. Use a model with a smaller reasoning pass, or generate fewer emails.`
        : 'Failed to parse generated emails');
    }

    // Validate we got the right number of emails
    if (generatedEmails.length !== emailCount) {
      console.warn(`Expected ${emailCount} emails, got ${generatedEmails.length}`);
    }

    // Preview: hand back exactly what production would have written, but persist
    // nothing — no archiving of the contact's existing sequences, no new row.
    if (preview) {
      console.log(`Preview only for contact ${contactId}: returning ${generatedEmails.length} emails unsaved`);
      return new Response(
        JSON.stringify({
          success: true,
          preview: true,
          contactId,
          emailCount: generatedEmails.length,
          resolvedPrompt,
          variableResolutions,
          emails: generatedEmails,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Archive existing ready/draft sequences for this contact
    const { error: archiveError } = await supabase
      .from('contact_email_sequences')
      .update({ status: 'archived' })
      .eq('contact_id', contactId)
      .eq('organization_id', contact.organization_id)
      .in('status', ['ready', 'draft']);

    if (archiveError) {
      console.warn('Failed to archive old sequences (non-fatal):', archiveError.message);
    }

    // Create the sequence record
    const sequenceRecord = {
      organization_id: contact.organization_id,
      contact_id: contactId,
      name: sequenceName || `Sequence for ${contact.display_name}`,
      email_count: generatedEmails.length,
      generation_config: {
        prompt: config.prompt,
        model: llmModel,
        ...(config.delayPattern ? { delayPattern: config.delayPattern } : {}),
      },
      emails: generatedEmails,
      status: 'ready',
      generated_at: new Date().toISOString(),
      notion_preview_url: contact.notion_preview_url || null,
      knowledge_document_ids: config.knowledgeDocumentIds || [],
    };

    const { data: savedSequence, error: saveError } = await supabase
      .from('contact_email_sequences')
      .insert(sequenceRecord)
      .select('id')
      .single();

    if (saveError) {
      console.error('Failed to save sequence:', saveError);
      throw new Error(`Failed to save sequence: ${saveError.message}`);
    }

    console.log(`Sequence saved with ID: ${savedSequence.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        sequenceId: savedSequence.id,
        contactId,
        emailCount: generatedEmails.length,
        emails: generatedEmails,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating email sequence:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
