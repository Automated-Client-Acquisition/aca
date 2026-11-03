/**
 * Duplicate Email Sequence
 *
 * Copies a sequence's content and configuration into a brand new sequence,
 * optionally carrying its audience across.
 *
 *   { sequenceId }                        — steps + settings only
 *   { sequenceId, copyLeadLists: true }   — also attach the same lead lists
 *
 * The copy is always created as a DRAFT: duplicating must never start sending.
 *
 * Copying the AUDIENCE is a separate call, by design: the caller follows this
 * with enroll-leads { sequenceId: <copy>, sourceSequenceId: <original> }. That
 * work pages five figures of enrollments and runs the admission guards, which
 * needs its own request budget — an in-request handoff (EdgeRuntime.waitUntil)
 * was tried and silently dropped the moment this response returned.
 *
 * Two things it deliberately does NOT copy:
 *   - A/B variant identity. Variant ids live inside steps JSON and are the PK of
 *     email_ab_variants, so a verbatim copy would re-point the ORIGINAL's variant
 *     rows (and their stats) at the duplicate. New ids, fresh counters.
 *   - Enrollment progress. Copied leads start at step 0 with a first send time
 *     computed from the copy's own send window — not mid-sequence.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SequenceStep {
  order: number;
  type: string;
  variants?: Array<{
    id?: string;
    variant_label?: string;
    subject?: string;
    body?: string;
    split_percentage?: number;
  }>;
  [key: string]: unknown;
}

interface NewVariantRow {
  id: string;
  sequence_id: string;
  step_index: number;
  variant_label: string;
  subject: string;
  body: string;
  split_percentage: number;
}

/**
 * Deep-copy the steps, minting a fresh id for every A/B variant so the copy owns
 * its own email_ab_variants rows. Returns the rewritten steps plus the variant
 * rows to insert (stats left at their column defaults — a duplicate starts at 0).
 */
function copyStepsWithFreshVariants(
  steps: SequenceStep[],
  newSequenceId: string,
): { steps: SequenceStep[]; variantRows: NewVariantRow[] } {
  const variantRows: NewVariantRow[] = [];

  const copied = steps.map((step) => {
    if (step.type !== 'ab_test' || !Array.isArray(step.variants)) {
      return { ...step };
    }
    const variants = step.variants.map((v) => {
      const id = crypto.randomUUID();
      variantRows.push({
        id,
        sequence_id: newSequenceId,
        step_index: step.order,
        variant_label: v.variant_label ?? '',
        subject: v.subject ?? '',
        body: v.body ?? '',
        split_percentage: v.split_percentage ?? 0,
      });
      return { ...v, id };
    });
    return { ...step, variants };
  });

  return { steps: copied, variantRows };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const {
      sequenceId,
      organizationId: requestedOrgId,
      name: requestedName,
      copyLeadLists = false,
    } = body as {
      sequenceId?: string;
      /** Required for internal (service-role) calls only; ignored otherwise. */
      organizationId?: string;
      name?: string;
      /** Attach the same lead lists (and carry the auto-enroll + enrollment filter setup). */
      copyLeadLists?: boolean;
    };

    if (!sequenceId) {
      return new Response(JSON.stringify({ error: 'sequenceId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service-role callers (the MCP server) present the service key directly and
    // must name the org explicitly, so tenant isolation still holds. Everyone
    // else goes through the normal user-JWT / CLI-token path.
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const presented = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const isInternal = !!serviceKey && presented === serviceKey;

    let organizationId: string;
    if (isInternal) {
      if (!requestedOrgId) {
        return new Response(
          JSON.stringify({ error: 'organizationId is required for internal duplication' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      organizationId = requestedOrgId;
    } else {
      try {
        const caller = await authenticateRequest(
          req,
          supabase as unknown as Parameters<typeof authenticateRequest>[1],
        );
        organizationId = caller.organization_id;
      } catch (err) {
        return unauthorized(err, corsHeaders);
      }
      if (requestedOrgId && requestedOrgId !== organizationId) {
        return new Response(
          JSON.stringify({ error: 'organizationId does not match the authenticated caller' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // ===== 1. Load the source, scoped to the caller's org =====
    const { data: source, error: srcErr } = await supabase
      .from('email_sequences')
      .select('*')
      .eq('id', sequenceId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (srcErr) throw srcErr;
    if (!source) {
      return new Response(JSON.stringify({ error: 'Sequence not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newSequenceId = crypto.randomUUID();
    const { steps, variantRows } = copyStepsWithFreshVariants(
      (source.steps as SequenceStep[]) || [],
      newSequenceId,
    );

    const name = (requestedName || '').trim() || `${source.name} (copy)`;

    // ===== 2. Insert the copy (always a draft) =====
    const insertRow: Record<string, unknown> = {
      id: newSequenceId,
      organization_id: organizationId,
      name,
      steps,
      status: 'draft',
      settings: source.settings ?? {},
      campaign_id: source.campaign_id ?? null,
      source_type: source.source_type ?? 'manual',
      autopilot_config: source.autopilot_config ?? {},
      agent_profile_id: source.agent_profile_id ?? null,
      knowledge_document_ids: source.knowledge_document_ids ?? [],
      tracking_domain_id: source.tracking_domain_id ?? null,
      // Who may enter is sequence configuration, not audience — it travels with
      // the copy either way, so a duplicate can't quietly admit leads the
      // original would have rejected.
      enroll_filter_criteria: source.enroll_filter_criteria ?? {},
      // Audience wiring only when asked for. A DB trigger keeps lead_list_id in
      // sync with the array, but set both so the copy is correct pre-trigger.
      lead_list_ids: copyLeadLists ? (source.lead_list_ids ?? []) : [],
      lead_list_id: copyLeadLists ? (source.lead_list_id ?? null) : null,
      auto_enroll_new_members: copyLeadLists ? source.auto_enroll_new_members === true : false,
    };

    const { data: created, error: insErr } = await supabase
      .from('email_sequences')
      .insert(insertRow)
      .select()
      .single();

    if (insErr) throw insErr;

    // ===== 3. A/B variants get their own rows under the new ids =====
    if (variantRows.length > 0) {
      const { error: varErr } = await supabase.from('email_ab_variants').insert(variantRows);
      // Non-fatal: the sequence exists and the steps carry the variants; the
      // builder re-syncs variant rows on the next edit.
      if (varErr) console.error(`[duplicate-email-sequence] variant copy failed: ${varErr.message}`);
    }

    console.log(
      `[duplicate-email-sequence] ${sequenceId} → ${newSequenceId} (lists=${copyLeadLists})`,
    );

    return new Response(
      JSON.stringify({ sequence: created }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[duplicate-email-sequence] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
