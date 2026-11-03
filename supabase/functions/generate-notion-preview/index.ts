/**
 * Generate Notion Preview (v2 — Blueprint System)
 *
 * Creates a premium, consulting-grade Notion page for a contact using
 * opinionated blueprint structures with rich Notion formatting.
 *
 * Supports two modes:
 * 1. Blueprint mode (new): Pass blueprintId — the function fetches all data
 *    and builds the AI prompt from the blueprint definition.
 * 2. Legacy mode: Pass prompt (resolved) — uses the original flat generation.
 *
 * Worker delegation (Fly.io):
 * - buildMessagesOnly=true: returns AI messages without calling OpenRouter
 *   (so the worker can call OpenRouter with a longer timeout).
 * - preGeneratedDocDef: skips AI entirely, uses the worker-provided
 *   NotionDocumentDef to create the Notion page directly.
 *
 * Endpoint: POST /generate-notion-preview
 * Body: {
 *   contactId: string,
 *   productId?: string,
 *   connectionId: string,
 *   databaseId: string,
 *   organizationId: string,
 *   blueprintId?: string,          // New: blueprint type
 *   customPrompt?: string,         // For 'custom' blueprint only
 *   prompt?: string,               // Legacy: resolved prompt string
 *   model?: string,                // Optional: override AI model
 *   buildMessagesOnly?: boolean,   // Return AI request without calling OpenRouter
 *   preGeneratedDocDef?: unknown,  // Pre-generated NotionDocumentDef from worker
 * }
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { isOllamaModel, resolveOllamaConfig, resolveChatEndpoint, type ChatEndpoint } from '../_shared/llm-client.ts';
import { compileDocument } from '../_shared/notion-block-compiler.ts';
import { buildAIMessages } from '../_shared/notion-blueprint-prompts.ts';
import type { NotionDocumentDef, NotionBlockDef } from '../_shared/notion-block-types.ts';
import { DEFAULT_FAST_TEXT_MODEL } from '../_shared/default-models.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateNotionPreviewRequest {
  contactId: string;
  productId?: string;
  connectionId: string;
  databaseId: string;
  organizationId: string;
  blueprintId?: string;
  blueprintIds?: string[];
  customPrompt?: string;
  prompt?: string;
  model?: string;
  force?: boolean;
  buildMessagesOnly?: boolean;  // Phase 1: return AI messages without calling OpenRouter
  preGeneratedDocDef?: unknown; // Phase 2: skip AI, use this pre-generated NotionDocumentDef
}

// ============================================================================
// Legacy flat generation (backward compatibility)
// ============================================================================

interface LegacyNotionSection {
  heading: string;
  type: 'bullets' | 'paragraph' | 'callout';
  items?: string[];
  content?: string;
  emoji?: string;
}

function buildLegacyBlocks(sections: LegacyNotionSection[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  for (const section of sections) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: section.heading } }],
      },
    });
    if (section.type === 'bullets' && section.items) {
      for (const item of section.items) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: item } }],
          },
        });
      }
    } else if (section.type === 'callout') {
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: section.content || '' } }],
          icon: { type: 'emoji', emoji: section.emoji || '💡' },
        },
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: section.content || '' } }],
        },
      });
    }
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }
  if (blocks.length > 0 && blocks[blocks.length - 1].type === 'divider') {
    blocks.pop();
  }
  return blocks;
}

const LEGACY_SYSTEM_PROMPT = `You generate structured content for a Notion page based on the user's brief.
Output ONLY valid JSON in this format:
{
  "title": "Page title here",
  "sections": [
    { "heading": "Section Title", "type": "bullets", "items": ["Point 1", "Point 2"] },
    { "heading": "Another Section", "type": "paragraph", "content": "A paragraph of text..." },
    { "heading": "Key Insight", "type": "callout", "content": "An important callout", "emoji": "💡" }
  ]
}
Rules:
- Be specific to this company, generic content is useless
- Use their own language and terminology
- Frame everything as observations and opportunities, not a sales pitch
- Keep each section concise (3-5 bullets max, paragraphs under 3 sentences)
- The title should include the company name
- Output ONLY valid JSON. No markdown, no explanation.`;

// ============================================================================
// JSON Parsing Helper
// ============================================================================

function extractJSON(content: string): string {
  // Try code fence extraction first
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                    content.match(/```\s*([\s\S]*?)\s*```/);
  if (jsonMatch?.[1]) return jsonMatch[1].trim();

  // Try to find a JSON object directly
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0].trim();

  return content.trim();
}

/**
 * Last-resort JSON repair for AI output with common formatting issues:
 * trailing commas, truncated output (unclosed braces/brackets), control characters.
 */
function repairJSON(content: string): string {
  let text = extractJSON(content);

  // Remove trailing commas before ] or }
  text = text.replace(/,\s*([\]}])/g, '$1');

  // Remove control characters that break JSON (preserve \n \r \t)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Close unclosed braces/brackets if the JSON was truncated
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  for (const char of text) {
    if (escape) { escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') openBraces++;
    if (char === '}') openBraces--;
    if (char === '[') openBrackets++;
    if (char === ']') openBrackets--;
  }

  // If we're inside an unclosed string, close it first
  if (inString) text += '"';

  for (let i = 0; i < openBrackets; i++) text += ']';
  for (let i = 0; i < openBraces; i++) text += '}';

  // Clean up any trailing commas introduced by truncation repair
  text = text.replace(/,\s*([\]}])/g, '$1');

  return text;
}

/**
 * Extracts a clean URL from a value that may be a plain URL or an iframe/script embed snippet.
 * Specifically targets <iframe src="..."> to avoid matching <script src="...">.
 */
function extractEmbedUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.includes('<iframe')) {
    const iframeMatch = trimmed.match(/<iframe[^>]+src="([^"]+)"/);
    if (iframeMatch?.[1]) return iframeMatch[1];
  }
  // If it's already a URL, return as-is
  if (trimmed.startsWith('http')) return trimmed;
  return null;
}

// ============================================================================
// Research Data Blocks (deterministic — appended after AI content)
// ============================================================================

// deno-lint-ignore no-explicit-any
function addResearchLine(blocks: NotionBlockDef[], label: string, value: any): void {
  if (value === null || value === undefined || value === '') return;
  const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value);
  if (!text) return;
  blocks.push({
    type: 'bulleted_list_item',
    text: [{ content: `${label}: `, bold: true }, { content: text }],
  });
}

// deno-lint-ignore no-explicit-any
function buildResearchBlocks(contact: any, enrichment: Record<string, unknown>, _product: any, productScore: any): NotionBlockDef[] {
  const blocks: NotionBlockDef[] = [];

  // Divider before research section
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'heading_1',
    text: [{ content: 'Our Research', bold: true }],
  });
  blocks.push({
    type: 'callout',
    text: [{ content: 'Below is the data and analysis we gathered before putting this document together. Full transparency on our research process.' }],
    emoji: '🔍',
    color: 'gray_background',
  });

  // ── Company Profile ──
  blocks.push({ type: 'heading_2', text: [{ content: '🏢 Company Profile' }] });
  addResearchLine(blocks, 'Company', contact.company);
  addResearchLine(blocks, 'Contact', contact.display_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim());
  addResearchLine(blocks, 'Title', contact.job_title);
  addResearchLine(blocks, 'Location', [contact.city, contact.country].filter(Boolean).join(', '));
  addResearchLine(blocks, 'Website', enrichment.company_website);
  addResearchLine(blocks, 'Niche', enrichment.company_niche);
  addResearchLine(blocks, 'Offering', enrichment.company_offering);
  addResearchLine(blocks, 'Target Audience', enrichment.company_target);
  addResearchLine(blocks, 'Tagline', enrichment.company_tagline);
  addResearchLine(blocks, 'Company Tone', enrichment.company_tone);
  addResearchLine(blocks, 'Language/Verbiage', enrichment.company_verbiage);

  // ── Company Metrics ──
  const hasMetrics = enrichment.linkedin_employee_count || enrichment.estimated_company_size || enrichment.revenue_model;
  if (hasMetrics) {
    blocks.push({ type: 'heading_2', text: [{ content: '📊 Company Metrics' }] });
    addResearchLine(blocks, 'Employees', enrichment.linkedin_employee_count);
    addResearchLine(blocks, 'Employee Growth (6mo)', enrichment.linkedin_employee_growth_6mo ? `${enrichment.linkedin_employee_growth_6mo}%` : null);
    addResearchLine(blocks, 'Company Size', enrichment.estimated_company_size);
    addResearchLine(blocks, 'Revenue Model', enrichment.revenue_model);
    addResearchLine(blocks, 'B2B', enrichment.is_b2b);
    if (enrichment.latest_funding_round) {
      addResearchLine(blocks, 'Latest Funding', `${enrichment.latest_funding_round}${enrichment.funding_amount ? ` (${enrichment.funding_amount})` : ''}`);
    }
  }

  // ── Business Priorities (prospect-safe subset — no internal ICP scores) ──
  const hasPriorities = enrichment.company_priorities || enrichment.primary_need;
  if (hasPriorities) {
    blocks.push({ type: 'heading_2', text: [{ content: '🎯 Business Priorities' }] });
    const primaryNeed = productScore?.primary_need || enrichment.primary_need;
    addResearchLine(blocks, 'Primary Need', primaryNeed);
    addResearchLine(blocks, 'Priorities', enrichment.company_priorities);
  }

  // ── Growth & Outbound Signals ──
  const hasSignals = enrichment.growth_signals || enrichment.has_outbound_motion || enrichment.outbound_signals || enrichment.sales_tools_detected;
  if (hasSignals) {
    blocks.push({ type: 'heading_2', text: [{ content: '📡 Growth & Outbound Signals' }] });
    addResearchLine(
      blocks,
      'Growth Signals',
      Array.isArray(enrichment.growth_signals)
        ? enrichment.growth_signals.map((s: unknown) => (s && typeof s === 'object' ? (s as Record<string, unknown>).signal : s))
        : enrichment.growth_signals,
    );
    addResearchLine(blocks, 'Has Outbound Motion', enrichment.has_outbound_motion);
    addResearchLine(blocks, 'Outbound Signals', enrichment.outbound_signals);
    addResearchLine(blocks, 'Sales Tools Detected', enrichment.sales_tools_detected);
    addResearchLine(blocks, 'Hiring Sales Roles', enrichment.hiring_sales_roles);
    addResearchLine(blocks, 'Open Sales Roles', enrichment.sales_roles_open);
  }

  // ── LinkedIn Activity ──
  const posts = enrichment.recent_linkedin_posts as Array<{ text?: string; date?: string; engagement?: number }> | undefined;
  if (posts && posts.length > 0) {
    blocks.push({ type: 'heading_2', text: [{ content: '💼 LinkedIn Activity' }] });
    addResearchLine(blocks, 'Topics', enrichment.linkedin_topics);
    addResearchLine(blocks, 'Best Hook', enrichment.best_post_hook);

    for (const post of posts.slice(0, 5)) {
      const postText = post.text ? (post.text.length > 400 ? post.text.slice(0, 400) + '...' : post.text) : '(no text)';
      const dateStr = post.date || 'unknown date';
      const engagement = post.engagement ?? 'n/a';
      blocks.push({
        type: 'toggle',
        text: [
          { content: `[${dateStr}] `, bold: true, color: 'gray' },
          { content: `Engagement: ${engagement}`, italic: true, color: 'gray' },
        ],
        children: [
          { type: 'paragraph', text: [{ content: postText }] },
        ],
      });
    }
  }

  // Product fit details intentionally excluded — internal data not shown to prospects

  return blocks;
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  let parsedContactId: string | null = null;
  let parsedOrganizationId: string | null = null;

  try {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) throw new Error('ENCRYPTION_KEY not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: GenerateNotionPreviewRequest = await req.json();
    const { contactId, productId, connectionId, databaseId, organizationId, customPrompt, prompt, model, force } = body;

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough). The
    // worker-delegation modes return the org's decrypted LLM credentials or skip
    // the AI call, so only the Fly workers (service key) may use them.
    try {
      await assertOrgAccess(req, supabase as unknown as Parameters<typeof assertOrgAccess>[1], organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }
    if ((body.buildMessagesOnly || body.preGeneratedDocDef) && !isServiceRoleRequest(req)) {
      return unauthorized({ status: 403, message: 'Forbidden' }, corsHeaders);
    }

    parsedContactId = contactId;
    parsedOrganizationId = organizationId;
    // Support both blueprintIds (array) and blueprintId (string) for backward compat
    const resolvedBlueprintIds: string[] | undefined = body.blueprintIds?.length
      ? body.blueprintIds
      : body.blueprintId
        ? [body.blueprintId]
        : undefined;

    // Validate required fields
    if (!contactId || !organizationId || !connectionId || !databaseId) {
      throw new Error('Missing required fields: contactId, organizationId, connectionId, databaseId');
    }
    if (!resolvedBlueprintIds && !prompt) {
      throw new Error('Either blueprintIds/blueprintId or prompt must be provided');
    }
    if (body.preGeneratedDocDef && !resolvedBlueprintIds) {
      throw new Error('preGeneratedDocDef is only supported in blueprint mode');
    }

    const useBlueprintMode = !!resolvedBlueprintIds;

    // ── Fetch contact (with full data for blueprint mode) ──
    const contactSelect = useBlueprintMode
      ? 'id, display_name, first_name, last_name, company, job_title, primary_email, city, country, company_website, enrichment_data, notion_preview_url, notion_page_id'
      : 'display_name, company, company_website, enrichment_data, notion_preview_url, notion_page_id';

    const { data: contact, error: contactError } = await supabase
      .from('crm_contacts')
      .select(contactSelect)
      .eq('id', contactId)
      .eq('organization_id', organizationId)
      .single();

    if (contactError || !contact) throw new Error(`Contact not found: ${contactId}`);

    // ── Dedup: if contact already has a Notion page, return it instead of creating a duplicate ──
    // Unless force=true (regeneration), in which case clear the old references and proceed.
    // We also use notion_page_id='generating' as an atomic claim to prevent concurrent generation.
    if (contact.notion_preview_url && contact.notion_page_id && contact.notion_page_id !== 'generating') {
      if (!force) {
        console.log(`Contact ${contactId} already has Notion page: ${contact.notion_preview_url} — skipping generation`);
        return new Response(
          JSON.stringify({
            success: true,
            notionPageUrl: contact.notion_preview_url,
            notionPageId: contact.notion_page_id,
            skipped: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`Force regeneration for contact ${contactId} — replacing existing Notion page`);
    }

    // ── Fetch product + related ICP & block data ──
    // deno-lint-ignore no-explicit-any
    let product: any = null;
    if (productId) {
      const { data: productData } = await supabase
        .from('library_products')
        .select('name, description, features, key_benefits, category, specifications, booking_url, testimonial_embed')
        .eq('id', productId)
        .eq('organization_id', organizationId)
        .single();

      if (productData) {
        product = { ...productData };

        // Fetch linked ICPs via junction table
        const { data: icpFits } = await supabase
          .from('product_icp_fit')
          .select('fit_score, library_icps(name, pain_points, desires, objections, language_style)')
          .eq('product_id', productId)
          .order('fit_score', { ascending: false })
          .limit(3);

        if (icpFits?.length) {
          // deno-lint-ignore no-explicit-any
          const icps = icpFits.map((f: any) => f.library_icps).filter(Boolean);
          // Merge pain points, desires from all linked ICPs
          product.icp_pain_points = icps.flatMap((i: any) => i.pain_points || []).filter(Boolean);
          product.icp_desires = icps.flatMap((i: any) => i.desires || []).filter(Boolean);
          product.icp_objections = icps.flatMap((i: any) => i.objections || []).filter(Boolean);
        }

        // Fetch linked blocks (hooks, angles, CTAs) via junction table
        const { data: blockFits } = await supabase
          .from('product_block_fit')
          .select('fit_score, library_blocks(block_type, name, content)')
          .eq('product_id', productId)
          .order('fit_score', { ascending: false })
          .limit(20);

        if (blockFits?.length) {
          // deno-lint-ignore no-explicit-any
          const blocks = blockFits.map((f: any) => f.library_blocks).filter(Boolean);
          // deno-lint-ignore no-explicit-any
          const byType = (type: string) => blocks.filter((b: any) => b.block_type === type).map((b: any) => b.content || b.name);
          product.marketing_hooks = byType('hook');
          product.marketing_primary_angle = byType('angle')[0] || null;
          product.marketing_alternative_angles = byType('angle').slice(1);
          product.affiliate_key_messages = byType('cta');
        }
      }
    }

    // ── Fetch product-specific score (blueprint mode) ──
    // deno-lint-ignore no-explicit-any
    let productScore: any = null;
    if (useBlueprintMode && productId) {
      const { data: scoreData } = await supabase
        .from('contact_product_scores')
        .select('icp_score, icp_score_reasoning, primary_need, primary_need_reasoning, selected_outcome')
        .eq('contact_id', contactId)
        .eq('product_id', productId)
        .eq('organization_id', organizationId)
        .order('analyzed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      productScore = scoreData;
    }

    // ── Build AI messages ──
    const aiModel = model || DEFAULT_FAST_TEXT_MODEL;
    let messages: Array<{ role: string; content: string }>;
    let maxTokens: number;
    let temperature: number;
    const enrichment = (contact.enrichment_data || {}) as Record<string, unknown>;

    if (useBlueprintMode) {
      const aiMessages = buildAIMessages(
        resolvedBlueprintIds!,
        contact,
        enrichment,
        product,
        productScore,
        customPrompt,
      );
      messages = aiMessages;
      // Generous token budget for thorough, 3000+ word deliverable-quality documents
      maxTokens = resolvedBlueprintIds!.length > 1 ? 24000 : 16000;
      temperature = 0.6;
    } else {
      // Legacy mode
      messages = [
        { role: 'system', content: LEGACY_SYSTEM_PROMPT },
        { role: 'user', content: prompt! },
      ];
      maxTokens = 4000;
      temperature = 0.7;
    }

    console.log(`Generating preview for ${contact.company} [mode=${useBlueprintMode ? `blueprints:${resolvedBlueprintIds!.join('+')}` : 'legacy'}, model=${aiModel}]`);

    // ── Worker delegation: return AI messages for external generation ──
    // This returns BEFORE the claim block — Phase 1 does NOT set notion_page_id.
    // The worker will call OpenRouter, then call back with preGeneratedDocDef (Phase 3),
    // which will go through the claim block below.
    if (body.buildMessagesOnly) {
      // Ollama models: hand the worker the resolved endpoint (url/headers/model)
      // so it can call the org's Ollama server directly.
      if (isOllamaModel(aiModel)) {
        const ollamaConfig = await resolveOllamaConfig(supabase, organizationId);
        if (!ollamaConfig) throw new Error('Ollama is not configured for this organization');
        const endpoint = await resolveChatEndpoint({ model: aiModel, ollamaConfig });
        return new Response(
          JSON.stringify({
            success: true,
            buildMessagesOnly: true,
            aiRequest: {
              messages,
              maxTokens,
              temperature,
              model: endpoint.model,
              endpoint,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Decrypt OpenRouter key here so the worker doesn't need ENCRYPTION_KEY
      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', organizationId)
        .eq('provider', 'openrouter')
        .maybeSingle();

      if (!apiKeyData) throw new Error('OpenRouter API key not configured');
      const openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);

      return new Response(
        JSON.stringify({
          success: true,
          buildMessagesOnly: true,
          aiRequest: {
            messages,
            maxTokens,
            temperature,
            model: aiModel,
            openRouterKey,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Clean existing state for claiming ──
    // This runs AFTER buildMessagesOnly returns (Phase 1 must NOT claim).
    if (force) {
      // Force mode: clear ANY existing notion_page_id so the null-claim succeeds.
      // This covers real page IDs, stale 'generating' claims, and anything else.
      const { data: cleaned } = await supabase
        .from('crm_contacts')
        .update({ notion_page_id: null })
        .eq('id', contactId)
        .eq('organization_id', organizationId)
        .not('notion_page_id', 'is', null)
        .select('id')
        .maybeSingle();
      if (cleaned) {
        console.log(`Force-cleared existing notion_page_id for contact ${contactId}`);
      }
    } else {
      // Normal mode: only clear stale 'generating' claims (>5 min old)
      const { data: cleaned } = await supabase
        .from('crm_contacts')
        .update({ notion_page_id: null })
        .eq('id', contactId)
        .eq('organization_id', organizationId)
        .eq('notion_page_id', 'generating')
        .lt('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
        .select('id')
        .maybeSingle();
      if (cleaned) {
        console.log(`Cleared stale 'generating' claim for contact ${contactId}`);
      }
    }

    // ── Atomic claim: prevent concurrent generation ──
    // Both force and normal paths arrive here with notion_page_id = null
    // (force mode cleared it above, normal mode relies on it being unset).
    {
      const { data: claimed, error: claimError } = await supabase
        .from('crm_contacts')
        .update({ notion_page_id: 'generating' })
        .eq('id', contactId)
        .eq('organization_id', organizationId)
        .is('notion_page_id', null)
        .select('id')
        .maybeSingle();

      if (claimError) {
        console.error(`Claim error for ${contactId}:`, claimError);
      }

      if (!claimed && !claimError) {
        const { data: recheckContact } = await supabase
          .from('crm_contacts')
          .select('notion_preview_url, notion_page_id')
          .eq('id', contactId)
          .eq('organization_id', organizationId)
          .single();

        if (recheckContact?.notion_preview_url && recheckContact.notion_page_id !== 'generating') {
          console.log(`Contact ${contactId} Notion page completed by another call: ${recheckContact.notion_preview_url}`);
          return new Response(
            JSON.stringify({
              success: true,
              notionPageUrl: recheckContact.notion_preview_url,
              notionPageId: recheckContact.notion_page_id,
              skipped: true,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`Contact ${contactId} Notion generation already in progress by another call — skipping`);
        return new Response(
          JSON.stringify({
            success: true,
            notionPageUrl: null,
            notionPageId: null,
            skipped: true,
            reason: 'generation_in_progress',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ── Fetch Notion connection (only needed for actual generation) ──
    const { data: connection, error: connectionError } = await supabase
      .from('email_tool_connections')
      .select('*')
      .eq('id', connectionId)
      .eq('organization_id', organizationId)
      .single();

    if (connectionError || !connection) throw new Error(`Notion connection not found: ${connectionId}`);
    if (connection.tool_type !== 'notion') {
      throw new Error(`Invalid connection type: expected notion, got ${connection.tool_type}`);
    }

    const notionToken = await decryptApiKey(connection.api_key_encrypted, encryptionKey);

    // ── Call AI (skip when worker already provided pre-generated content) ──
    let content: string | null = null;
    let chatEndpoint: ChatEndpoint | null = null;
    if (!body.preGeneratedDocDef) {
      // Resolve the LLM endpoint (only needed when calling AI ourselves)
      if (isOllamaModel(aiModel)) {
        const ollamaConfig = await resolveOllamaConfig(supabase, organizationId);
        if (!ollamaConfig) throw new Error('Ollama is not configured for this organization');
        chatEndpoint = await resolveChatEndpoint({ model: aiModel, ollamaConfig });
      } else {
        const { data: apiKeyData } = await supabase
          .from('api_keys')
          .select('key_encrypted')
          .eq('organization_id', organizationId)
          .eq('provider', 'openrouter')
          .maybeSingle();

        if (!apiKeyData) throw new Error('OpenRouter API key not configured');
        const openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
        chatEndpoint = await resolveChatEndpoint({ model: aiModel, openRouterApiKey: openRouterKey, referer: supabaseUrl });
      }

      const aiController = new AbortController();
      const aiTimeout = setTimeout(() => aiController.abort(), 150_000); // 150s timeout for large blueprints
      const aiResponse = await fetch(chatEndpoint.url, {
        method: 'POST',
        headers: chatEndpoint.headers,
        body: JSON.stringify({
          model: chatEndpoint.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: aiController.signal,
      });
      clearTimeout(aiTimeout);

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error('OpenRouter error:', aiResponse.status, errorText);
        throw new Error(`AI generation failed: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      content = aiData.choices?.[0]?.message?.content;
      if (!content) throw new Error('No content in AI response');
    }

    // ── Parse & Create Page ──
    let pageId: string;
    let pageUrl: string;

    if (useBlueprintMode) {
      // Blueprint mode: parse NotionDocumentDef, compile to Notion blocks
      let docDef: NotionDocumentDef | null = null;

      if (body.preGeneratedDocDef) {
        // Worker already called OpenRouter and parsed the JSON — skip AI call entirely
        docDef = body.preGeneratedDocDef as NotionDocumentDef;
        if (!docDef || !docDef.title || !Array.isArray(docDef.blocks)) {
          throw new Error('Invalid preGeneratedDocDef: missing title or blocks array');
        }
        console.log(`Using pre-generated content: ${docDef.blocks.length} blocks for "${docDef.title}"`);
      } else {
        // Attempt 1: direct parse
        try {
          const jsonText = extractJSON(content!);
          docDef = JSON.parse(jsonText);
        } catch {
          // Attempt 2: repair common JSON issues before expensive AI retry
          try {
            const repaired = repairJSON(content!);
            docDef = JSON.parse(repaired);
            console.log('Initial JSON repaired successfully (no retry needed)');
          } catch {
            // Repair failed — proceed with AI retry
          }
        }

        if (!docDef) {
          console.error('Blueprint JSON parse failed, retrying with stricter prompt...');
          console.error('Raw content (first 500 chars):', content!.slice(0, 500));

          // Attempt 3: retry with stricter AI instruction
          const retryController = new AbortController();
          const retryTimeout = setTimeout(() => retryController.abort(), 150_000); // 150s timeout for large blueprints
          if (!chatEndpoint) throw new Error('LLM endpoint unavailable for JSON retry');
          const retryResponse = await fetch(chatEndpoint.url, {
            method: 'POST',
            headers: chatEndpoint.headers,
            body: JSON.stringify({
              model: chatEndpoint.model,
              messages: [
                ...messages,
                { role: 'assistant', content: content! },
                { role: 'user', content: 'Your output was not valid JSON. Please output ONLY the JSON object with no additional text, no markdown fences, no explanation. Start with { and end with }.' },
              ],
              temperature: 0.3,
              max_tokens: maxTokens,
              response_format: { type: 'json_object' },
            }),
            signal: retryController.signal,
          });
          clearTimeout(retryTimeout);

          if (!retryResponse.ok) throw new Error(`AI retry failed: ${retryResponse.status}`);
          const retryData = await retryResponse.json();
          const retryContent = retryData.choices?.[0]?.message?.content;
          if (!retryContent) throw new Error('No content in AI retry response');

          try {
            const retryJson = extractJSON(retryContent);
            docDef = JSON.parse(retryJson);
          } catch {
            // Attempt 4: repair the retry content
            try {
              const repaired = repairJSON(retryContent);
              docDef = JSON.parse(repaired);
              console.log('JSON repaired successfully after retry');
            } catch {
              console.error('Retry and repair both failed, raw:', retryContent.slice(0, 500));
              throw new Error('Failed to parse AI-generated Notion content after retry');
            }
          }
        }

        console.log(`AI generated ${docDef!.blocks.length} blocks for "${docDef!.title}"`);
      }

      // Validate basic structure
      if (!docDef || !docDef.title || !Array.isArray(docDef.blocks)) {
        throw new Error('Invalid document structure: missing title or blocks array');
      }

      // ── Strip AI-generated testimonial/booking sections & link blocks ──
      // The AI sometimes ignores instructions and adds these sections itself.
      // We remove them here since we inject deterministic embed blocks below.
      {
        const stripHeadings = [
          'what others are saying',
          'book your strategy session',
          'book your session',
          'schedule your strategy session',
          'schedule a call',
        ];

        // Build list of URLs to strip (booking + testimonial links the AI may have inserted)
        const stripLinkDomains: string[] = [];
        if (product?.booking_url) {
          const bUrl = extractEmbedUrl(product.booking_url as string);
          if (bUrl) {
            try { stripLinkDomains.push(new URL(bUrl).hostname); } catch { /* ignore */ }
          }
        }
        if (product?.testimonial_embed) {
          const tUrl = extractEmbedUrl(product.testimonial_embed as string);
          if (tUrl) {
            try { stripLinkDomains.push(new URL(tUrl).hostname); } catch { /* ignore */ }
          }
        }
        // Common embed domains to strip
        stripLinkDomains.push('testimonial.to', 'leadconnectorhq.com', 'msgsndr.com');

        let i = 0;
        while (i < docDef.blocks.length) {
          const block = docDef.blocks[i];

          // Strip heading-based sections (heading + everything under it)
          if (
            (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') &&
            block.text?.length &&
            stripHeadings.some(h => block.text[0].content?.toLowerCase().includes(h))
          ) {
            let end = i + 1;
            while (end < docDef.blocks.length) {
              const next = docDef.blocks[end];
              if (next.type === 'heading_1' || next.type === 'heading_2' || next.type === 'heading_3' || next.type === 'divider') break;
              end++;
            }
            if (i > 0 && docDef.blocks[i - 1].type === 'divider') {
              docDef.blocks.splice(i - 1, end - i + 1);
              i = i - 1;
            } else {
              docDef.blocks.splice(i, end - i);
            }
            continue;
          }

          // Strip standalone paragraphs that are just a booking/testimonial link CTA
          if (block.type === 'paragraph' && block.text?.length && stripLinkDomains.length > 0) {
            const hasEmbedLink = block.text.some(
              (seg: { link?: string; content?: string }) =>
                seg.link && stripLinkDomains.some(d => seg.link!.includes(d))
            );
            // Only strip if the paragraph is essentially just the link (1-2 text segments)
            if (hasEmbedLink && block.text.length <= 2) {
              docDef.blocks.splice(i, 1);
              continue;
            }
          }

          i++;
        }
      }

      // ── Inject website screenshot hero ──
      // Fallback chain: direct column → enrichment fields → nested company object → email domain
      const companyObj = enrichment.company as Record<string, unknown> | undefined;
      const companyWebsite =
        contact.company_website ||
        enrichment.company_website ||
        enrichment.website ||
        companyObj?.website ||
        (companyObj?.domain ? `https://${companyObj.domain}` : null) ||
        (contact.primary_email ? `https://${contact.primary_email.split('@')[1]}` : null);
      if (companyWebsite && typeof companyWebsite === 'string') {
        const cleanUrl = companyWebsite.replace(/^https?:\/\//, '').replace(/\/$/, '');
        let screenshotUrl: string | null = null;

        // Primary: crawl4ai screenshot (above-the-fold only via fixed viewport)
        const crawlerBaseUrl = Deno.env.get('CRAWLER_BASE_URL');
        if (crawlerBaseUrl) {
          try {
            const ssController = new AbortController();
            const ssTimeout = setTimeout(() => ssController.abort(), 30_000);
            const ssResponse = await fetch(`${crawlerBaseUrl}/crawl`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                urls: [`https://${cleanUrl}`],
                browser_config: {
                  viewport_width: 1280,
                  viewport_height: 800,
                },
                crawler_config: {
                  screenshot: true,
                  screenshot_wait_for: 3.0,
                },
              }),
              signal: ssController.signal,
            });
            clearTimeout(ssTimeout);

            if (ssResponse.ok) {
              const ssResult = await ssResponse.json();
              const screenshotBase64 = ssResult?.result?.results?.[0]?.screenshot
                || ssResult?.results?.[0]?.screenshot;
              if (screenshotBase64) {
                // Decode base64 PNG and upload to Supabase Storage
                const binaryStr = atob(screenshotBase64);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

                const storagePath = `screenshots/${contactId}-${Date.now()}.png`;
                const { error: uploadError } = await supabase.storage
                  .from('content-media')
                  .upload(storagePath, bytes, { contentType: 'image/png', upsert: true });

                if (!uploadError) {
                  const { data: { publicUrl } } = supabase.storage
                    .from('content-media')
                    .getPublicUrl(storagePath);
                  screenshotUrl = publicUrl;
                  console.log(`crawl4ai viewport screenshot uploaded: ${screenshotUrl}`);
                } else {
                  console.warn('Screenshot upload failed:', uploadError.message);
                }
              }
            } else {
              console.log(`crawl4ai screenshot failed: HTTP ${ssResponse.status}`);
            }
          } catch (ssError) {
            console.warn('crawl4ai screenshot error:', ssError instanceof Error ? ssError.message : ssError);
          }
        }

        // Fallback: thum.io (external service)
        if (!screenshotUrl) {
          screenshotUrl = `https://image.thum.io/get/width/1200/crop/600/https://${cleanUrl}`;
          console.log('Using thum.io fallback for screenshot');
        }

        docDef.blocks.unshift({
          type: 'image',
          url: screenshotUrl,
          caption: [{ content: companyWebsite }],
        });
      }

      // ── Inject testimonial embed widget (deterministic — not AI-generated) ──
      if (product?.testimonial_embed) {
        const testimonialUrl = extractEmbedUrl(product.testimonial_embed as string);
        if (testimonialUrl) {
          docDef.blocks.push({ type: 'divider' });
          docDef.blocks.push({
            type: 'heading_2',
            text: [{ content: 'What Others Are Saying' }],
          });
          docDef.blocks.push({
            type: 'paragraph',
            text: [{ content: 'Don\'t just take our word for it — see what our clients have to say about working with us.' }],
          });
          docDef.blocks.push({
            type: 'embed',
            url: testimonialUrl,
            caption: [{ content: 'Client testimonials' }],
          });
        }
      }

      // ── Inject booking/calendar embed widget (deterministic — not AI-generated) ──
      if (product?.booking_url) {
        const bookingUrl = extractEmbedUrl(product.booking_url as string);
        if (bookingUrl) {
          docDef.blocks.push({ type: 'divider' });
          docDef.blocks.push({
            type: 'heading_2',
            text: [{ content: 'Book Your Strategy Session' }],
          });
          docDef.blocks.push({
            type: 'paragraph',
            text: [{ content: 'Ready to explore what this looks like for your business? Pick a time that works for you.' }],
          });
          docDef.blocks.push({
            type: 'embed',
            url: bookingUrl,
            caption: [{ content: 'Schedule a call' }],
          });
        }
      }

      // ── Append raw research data sections ──
      const researchBlocks = buildResearchBlocks(contact, enrichment, product, productScore);
      docDef.blocks.push(...researchBlocks);

      {
        // ── Compile and send to Notion API ──
        const compiled = compileDocument(docDef, databaseId);

        // Create page
        const createController = new AbortController();
        const createTimeout = setTimeout(() => createController.abort(), 30_000); // 30s timeout
        const createResponse = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(compiled.createPayload),
          signal: createController.signal,
        });
        clearTimeout(createTimeout);

        const createText = await createResponse.text();
        let createData: Record<string, unknown>;
        try {
          createData = JSON.parse(createText);
        } catch {
          console.error('Notion returned non-JSON:', createResponse.status, createText.slice(0, 500));
          throw new Error(`Notion API error: non-JSON response (${createResponse.status})`);
        }

        if (!createResponse.ok) {
          console.error('Notion API error:', createResponse.status, JSON.stringify(createData).slice(0, 500));
          throw new Error(`Notion API error: ${(createData as Record<string, string>).message || createResponse.status}`);
        }

        pageId = createData.id as string;
        pageUrl = (createData.public_url || createData.url) as string;

        // Append additional blocks if needed (>100 top-level blocks)
        for (const appendBatch of compiled.appendPayloads) {
          const appendController = new AbortController();
          const appendTimeout = setTimeout(() => appendController.abort(), 30_000); // 30s timeout
          const appendResponse = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ children: appendBatch }),
            signal: appendController.signal,
          });
          clearTimeout(appendTimeout);

          if (!appendResponse.ok) {
            const appendError = await appendResponse.text();
            console.error(`Failed to append blocks to ${pageId}:`, appendResponse.status, appendError.slice(0, 300));
            // Non-fatal — page was created, just missing some blocks
            break;
          }
        }
      }
    } else {
      // Legacy mode: parse flat section JSON, build simple blocks
      let legacyContent: { title: string; sections: LegacyNotionSection[] };
      try {
        const jsonText = extractJSON(content!);
        legacyContent = JSON.parse(jsonText);
      } catch {
        console.error('Failed to parse legacy AI response');
        console.error('Raw content:', content!.slice(0, 500));
        throw new Error('Failed to parse AI-generated Notion content');
      }

      console.log(`AI generated ${legacyContent.sections.length} sections for "${legacyContent.title}"`);
      const blocks = buildLegacyBlocks(legacyContent.sections);

      const legacyCreateController = new AbortController();
      const legacyCreateTimeout = setTimeout(() => legacyCreateController.abort(), 30_000); // 30s timeout
      const notionResponse = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: {
            title: { title: [{ text: { content: legacyContent.title } }] },
          },
          children: blocks,
        }),
        signal: legacyCreateController.signal,
      });
      clearTimeout(legacyCreateTimeout);

      const responseText = await notionResponse.text();
      let notionData: Record<string, unknown>;
      try {
        notionData = JSON.parse(responseText);
      } catch {
        console.error('Notion returned non-JSON:', notionResponse.status, responseText.slice(0, 500));
        throw new Error(`Notion API error: non-JSON response (${notionResponse.status})`);
      }

      if (!notionResponse.ok) {
        console.error('Notion API error:', notionResponse.status, JSON.stringify(notionData).slice(0, 500));
        throw new Error(`Notion API error: ${(notionData as Record<string, string>).message || notionResponse.status}`);
      }

      pageId = notionData.id as string;
      pageUrl = (notionData.public_url || notionData.url) as string;
    }

    console.log(`Notion page created: ${pageId} -> ${pageUrl}`);

    // Persist the page URL + ID on the contact (replaces the 'generating' sentinel).
    // The caller (process-email-sequence-job) also does this, but writing here ensures
    // concurrent calls see the real value as early as possible.
    await supabase
      .from('crm_contacts')
      .update({
        notion_preview_url: pageUrl,
        notion_page_id: pageId,
      })
      .eq('id', contactId)
      .eq('organization_id', organizationId);

    return new Response(
      JSON.stringify({
        success: true,
        notionPageId: pageId,
        notionPageUrl: pageUrl,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Generate Notion preview error:', error);

    // Clear the 'generating' sentinel so the contact can be retried later.
    if (parsedContactId && parsedOrganizationId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const cleanupClient = createClient(supabaseUrl, supabaseServiceKey);
        await cleanupClient
          .from('crm_contacts')
          .update({ notion_page_id: null })
          .eq('id', parsedContactId)
          .eq('organization_id', parsedOrganizationId)
          .eq('notion_page_id', 'generating');
      } catch {
        // Best-effort cleanup
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
