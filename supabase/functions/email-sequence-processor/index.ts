/**
 * Email Sequence Processor Edge Function
 *
 * Cron (every 5 min): processes enrollments where next_send_at <= now().
 * Uses rotation engine, respects all settings (gaps, jitter, business hours,
 * provider matching, AI filtering, stop conditions, daily limits).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { isMailboxStillWarming, recordSendResult, selectMailbox } from "../_shared/email-rotation.ts";
import {
  type MailboxSelectionConfig,
  resolveMailboxPool,
} from "../_shared/mailbox-pool.ts";
import {
  getProviderFromRecipient,
  selectMailboxAdvanced,
} from "../_shared/esp-matching.ts";
import { AIFilterSettings, applyAIFilters } from "../_shared/ai-lead-filter.ts";
import {
  buildTextOnlyUnsubscribeHtml,
  buildUnsubscribeAnchor,
  prepareEmailBody,
  TrackingSettings,
} from "../_shared/email-tracking.ts";
import {
  extractSMTPCredentials,
  sendEmailViaSMTP,
} from "../_shared/smtp-client.ts";
import { checkFeatureAccess } from "../_shared/featureAccess.ts";
import { shouldThrottleSend } from "../_shared/esp-rate-limiter.ts";
import { resolveRecipientTimezone } from "../_shared/recipient-timezone.ts";
import {
  DEFAULT_BLOCK_THRESHOLD,
  scoreContent,
} from "../_shared/content-scorer.ts";
import { selectInChunks } from "../_shared/chunked-query.ts";
import {
  decideAllow,
  getOrgVerifierConfig,
  verifyEmailAddress,
} from "../_shared/list-verifier.ts";
import { TRACKING_HOST } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// CRM contact statuses that hard-suppress a sequence send (PECR / opt-out).
const SUPPRESSED_CONTACT_STATUSES = new Set([
  "unsubscribed",
  "do_not_contact",
  "bounced",
]);

// Host serving unsubscribe links when the org has no VERIFIED tracking domain.
// Verified tracking domains CNAME to this same proxy, so both branches serve the
// identical short /u/<id> path.
const UNSUBSCRIBE_FALLBACK_BASE = `https://${TRACKING_HOST}`;

// ============================================================================
// Types
// ============================================================================

interface SequenceSettings {
  /** Read at the enrollment step to scope product-specific copy. */
  product_id?: string;
  mailbox_ids?: string[];
  /** Auto pool rule — see _shared/mailbox-pool.ts. Mirrors the Fly worker. */
  mailbox_selection?: MailboxSelectionConfig | null;
  stop_on_reply?: boolean;
  stop_on_auto_reply?: boolean;
  stop_company_on_reply?: boolean;
  open_tracking?: boolean;
  click_tracking?: boolean;
  custom_tracking_domain?: string | null;
  daily_limit?: number;
  max_new_leads_per_day?: number | null;
  min_time_gap_minutes?: number;
  random_additional_minutes?: number;
  prioritize_new_leads?: boolean;
  send_window?: { start: string; end: string };
  timezone?: string;
  skip_weekends?: boolean;
  provider_matching?: boolean;
  ai_filter_unlikely_reply?: "send" | "skip";
  ai_filter_hostile?: "send" | "skip";
  first_email_text_only?: boolean;
  sisr_enabled?: boolean;
  hypersend_mode?: boolean;
  esp_routing_rules?: Array<{ recipient_domain: string; provider: string }>;
  limit_per_company_domain?: number | null;
  unsubscribe_header?: boolean;
  unsubscribe_link_footer?: boolean;
  unsubscribe_footer_text?: string | null;
  allow_risky_emails?: boolean;
  cc?: string[];
  bcc?: string[];
  // A/B Testing
  auto_optimize_ab?: boolean;
  ab_winning_metric?: "open_rate" | "click_rate" | "reply_rate";
  ab_sample_size?: number;
  // Variable Fallback Defaults
  variable_defaults?: Record<string, string>;
}

// Default settings applied when fields are missing from the database
const DEFAULT_SETTINGS: Partial<SequenceSettings> = {
  send_window: { start: "08:00", end: "18:00" },
  timezone: "America/New_York",
  skip_weekends: true,
  daily_limit: 30,
  min_time_gap_minutes: 9,
  random_additional_minutes: 5,
};

function applyDefaultSettings(raw: SequenceSettings): SequenceSettings {
  return { ...DEFAULT_SETTINGS, ...raw };
}

interface SequenceStep {
  order: number;
  type: "email" | "delay" | "condition" | "ab_test";
  delay_hours?: number;
  subject?: string;
  body?: string;
  condition_type?: "opened" | "clicked" | "replied" | "bounced";
  condition_timeout_hours?: number;
  variants?: Array<
    {
      id: string;
      subject: string;
      body: string;
      split_percentage: number;
      is_winner?: boolean;
    }
  >;
}

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log("[Sequence Processor] Starting processing run...");

    const now = new Date();
    const nowISO = now.toISOString();

    // Reaper: finalize rows orphaned in 'sending' by a prior run that died
    // mid-send (edge-function wall-clock timeout while an SMTP socket hung).
    // Without this, the same lead is retried every cron cycle and the send_log
    // fills with duplicate 'sending' rows that never resolve. 10-minute grace
    // window leaves genuinely in-flight sends from the current run untouched.
    const reapCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const { count: reapedCount } = await supabase
      .from("email_send_log")
      .update({
        status: "failed",
        error_message:
          "reaped: orphaned in sending state (SMTP hang/timeout, never finalized)",
        error_category: "network_error",
      }, { count: "exact" })
      .eq("status", "sending")
      .lt("created_at", reapCutoff);
    if (reapedCount && reapedCount > 0) {
      console.warn(
        `[Sequence Processor] Reaped ${reapedCount} orphaned 'sending' rows older than 10min`,
      );
    }

    // Fetch due enrollments — FIFO order so old enrollments aren't starved
    // when the queue exceeds the LIMIT 100 batch size. Without this, Postgres
    // returned in undefined (insertion-ish) order and ancient enrollments
    // could wait forever behind newer ones.
    const { data: enrollments, error: fetchError } = await supabase
      .from("email_sequence_enrollments")
      .select(`
        id, sequence_id, lead_id, current_step, status,
        next_send_at, mailbox_id, variant_assignments, condition_waiting_since, custom_data, metadata,
        email_sequences:sequence_id (
          id, organization_id, steps, settings, status, tracking_domain_id
        )
      `)
      .eq("status", "active")
      .lte("next_send_at", nowISO)
      .order("next_send_at", { ascending: true })
      .limit(100);

    if (fetchError) {
      throw new Error(`Failed to fetch enrollments: ${fetchError.message}`);
    }

    if (!enrollments || enrollments.length === 0) {
      console.log("[Sequence Processor] No enrollments due");
      return new Response(
        JSON.stringify({ success: true, processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[Sequence Processor] Found ${enrollments.length} enrollments due`,
    );

    // Sort enrollments: for sequences with prioritize_new_leads, process step-0 (new leads) first
    enrollments.sort((a: any, b: any) => {
      const aSettings = (a as any).email_sequences?.settings || {};
      const bSettings = (b as any).email_sequences?.settings || {};
      const aPrioritize = aSettings.prioritize_new_leads ? 1 : 0;
      const bPrioritize = bSettings.prioritize_new_leads ? 1 : 0;
      // Only reorder if the sequence has prioritize_new_leads enabled
      const aScore = aPrioritize && a.current_step === 0 ? 0 : 1;
      const bScore = bPrioritize && b.current_step === 0 ? 0 : 1;
      return aScore - bScore;
    });

    let sentCount = 0;
    let skippedCount = 0;
    let filteredCount = 0;
    let errorCount = 0;

    // Track daily sends per sequence for daily_limit enforcement
    const sequenceDailySends: Record<string, number> = {};
    // Track new leads per sequence today for max_new_leads_per_day
    const sequenceNewLeadsToday: Record<string, number> = {};
    // Track domain sends today for limit_per_company_domain
    const domainSendsToday: Record<string, number> = {};
    // Cache resolved tracking domain strings per tracking_domain_id
    const trackingDomainCache: Record<string, string | null> = {};
    // Cache the org's verified default tracking domain (fallback when a
    // sequence has no tracking_domain_id of its own). Keyed by organization_id.
    const orgDefaultTrackingDomainCache: Record<string, string | null> = {};
    // Cache "is this tracking domain verified?" per organization_id:domain — only a
    // verified domain may host unsubscribe links (see the send path below).
    const trackingDomainVerifiedCache: Record<string, boolean> = {};
    // Phase 8.4.2: org-wide cross-mailbox pacing limit, lazy-loaded per run.
    let orgPacingLimit: number | null = null;

    // Bulk-fetch all leads for this batch to avoid N+1 queries
    const leadIds = [
      ...new Set(enrollments.map((e: any) => e.lead_id)),
    ] as string[];
    const allLeads = await selectInChunks(
      supabase,
      "leads",
      "*, assigned_mailbox_id, last_sequence_email_at",
      "id",
      leadIds,
    );

    // Batch-fetch products referenced by sequences (for {{product_*}} variable resolution)
    const productIds = [
      ...new Set(
        enrollments
          .map((e: any) => e.email_sequences?.settings?.product_id)
          .filter(Boolean),
      ),
    ] as string[];
    // deno-lint-ignore no-explicit-any
    const productMap = new Map<string, Record<string, string>>();
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from("library_products")
        .select("id, name, description, features, key_benefits")
        .in("id", productIds);
      for (const p of (products || [])) {
        productMap.set(p.id, {
          product_name: p.name || "",
          product_description: p.description || "",
          product_features: Array.isArray(p.features)
            ? (p.features as string[]).join(", ")
            : String(p.features || ""),
          product_benefits: Array.isArray(p.key_benefits)
            ? (p.key_benefits as string[]).join(", ")
            : String(p.key_benefits || ""),
        });
      }
    }

    // Batch-fetch org-level custom field placeholder defaults (for {{custom_<key>}}
    // fallback when a lead has no value). Keyed by organization_id, merged with
    // per-sequence settings.variable_defaults at the substitution call site
    // (sequence-level default wins over the org-wide placeholder).
    const orgIds = [
      ...new Set(
        enrollments.map((e: any) => e.email_sequences?.organization_id).filter(
          Boolean,
        ),
      ),
    ] as string[];
    const orgCustomFieldDefaultsMap = new Map<string, Record<string, string>>();
    if (orgIds.length > 0) {
      const { data: customFieldDefs } = await supabase
        .from("crm_custom_field_defs")
        .select("organization_id, field_key, default_value")
        .in("organization_id", orgIds)
        .not("default_value", "is", null);
      for (const def of (customFieldDefs || [])) {
        const existing = orgCustomFieldDefaultsMap.get(def.organization_id) ||
          {};
        existing[`custom_${def.field_key}`] = def.default_value;
        orgCustomFieldDefaultsMap.set(def.organization_id, existing);
      }
    }

    // deno-lint-ignore no-explicit-any
    const leadMap = new Map<string, any>(
      (allLeads || []).map((l: any) => [l.id, l]),
    );

    // Batch-fetch CRM contact statuses for the hard unsubscribe/suppression
    // guard (PECR). The unsubscribe cascade only matches enrollments by lead_id,
    // so re-enrolled contacts, duplicate lead_ids, or statuses set outside the
    // cascade (manual/bulk edit, CSV import) can leave an active enrollment
    // pointing at a suppressed contact. We re-read crm_contacts.status here,
    // independent of the opt-in AI filter.
    const suppressedContactIds = new Set<string>();
    const contactIds = [
      ...new Set(
        (allLeads || [])
          .filter((l: any) => l.source === "crm_contact" && l.source_id)
          .map((l: any) => l.source_id as string),
      ),
    ] as string[];
    if (contactIds.length > 0) {
      const contactStatuses = await selectInChunks<
        { id: string; status: string }
      >(
        supabase,
        "crm_contacts",
        "id, status",
        "id",
        contactIds,
      );
      for (const c of contactStatuses) {
        if (SUPPRESSED_CONTACT_STATUSES.has(c.status)) {
          suppressedContactIds.add(c.id);
        }
      }
    }

    for (const enrollment of enrollments) {
      // Tracks the send_log row opened in 'sending' this iteration so the catch
      // block can finalize it if anything throws before it's resolved.
      let openSendLogId: string | null = null;
      try {
        const sequence = (enrollment as any).email_sequences;
        if (!sequence || sequence.status !== "active") {
          console.log(
            `[Sequence Processor] Skipping enrollment ${enrollment.id}: sequence not active`,
          );
          skippedCount++;
          continue;
        }

        const settings: SequenceSettings = applyDefaultSettings(
          sequence.settings || {},
        );
        // Auto mode re-derives the pool from tags + health each cycle, so
        // recovered mailboxes rejoin without anyone reopening the picker.
        const pool = await resolveMailboxPool(
          supabase,
          sequence.organization_id,
          sequence.id,
          settings,
        );
        const poolMailboxIds = pool.mailboxIds;
        const steps: SequenceStep[] = sequence.steps || [];
        const organizationId = sequence.organization_id;

        // Check feature access for email campaigns
        const featureCheck = await checkFeatureAccess(
          supabase,
          organizationId,
          "email_campaigns",
        );
        if (!featureCheck.allowed) {
          console.warn(
            `[Sequence Processor] Skipping enrollment ${enrollment.id}: org ${organizationId} does not have email_campaigns feature (plan: ${featureCheck.planTier})`,
          );
          skippedCount++;
          continue;
        }

        // Get current step — auto-advance through non-email steps (delay, condition)
        let currentStep = steps.find((s: SequenceStep) =>
          s.order === enrollment.current_step
        );

        if (!currentStep) {
          await completeEnrollment(supabase, enrollment.id);
          skippedCount++;
          continue;
        }

        // Advance past delay/condition steps until we reach a sendable step (email or ab_test)
        let conditionWaiting = false;
        while (
          currentStep && currentStep.type !== "email" &&
          currentStep.type !== "ab_test"
        ) {
          if (currentStep.type === "delay") {
            const nextOrder: number = currentStep.order + 1;
            const nextStep: SequenceStep | undefined = steps.find((
              s: SequenceStep,
            ) => s.order === nextOrder);
            if (!nextStep) {
              await completeEnrollment(supabase, enrollment.id);
              currentStep = undefined as any;
              break;
            }

            // If this is the first step (order 0), the delay was NOT applied by a
            // prior advanceEnrollment call — we need to apply it now and defer.
            if (currentStep.order === 0) {
              const delayHours = currentStep.delay_hours || 0;
              if (delayHours > 0) {
                const delayedSendAt = new Date(
                  Date.now() + delayHours * 60 * 60 * 1000,
                );
                // `lead` is not bound until much later in this loop body, so
                // referencing it here hit the temporal dead zone and threw
                // ReferenceError for any sequence whose first step is a delay.
                // Resolve from leadMap (built above) instead.
                const delayLead = leadMap.get(enrollment.lead_id);
                const adjustedSendAt = adjustToSendWindow(
                  delayedSendAt,
                  settings,
                  { email: delayLead?.email },
                );
                await supabase
                  .from("email_sequence_enrollments")
                  .update({
                    current_step: nextOrder,
                    next_send_at: adjustedSendAt.toISOString(),
                    condition_waiting_since: null,
                    updated_at: nowISO,
                  })
                  .eq("id", enrollment.id);
                enrollment.current_step = nextOrder;
                currentStep = nextStep;
                console.log(
                  `[Sequence Processor] Enrollment ${enrollment.id}: applied step-0 delay of ${delayHours}h, deferred to ${adjustedSendAt.toISOString()}`,
                );
                conditionWaiting = true; // prevent sending this cycle
                break;
              }
            }

            // For non-first delay steps, the delay was already applied by the
            // previous advanceEnrollment call. Just skip past to the next step.
            await supabase
              .from("email_sequence_enrollments")
              .update({
                current_step: nextOrder,
                next_send_at: new Date(Date.now() + 60_000).toISOString(),
                condition_waiting_since: null,
                updated_at: nowISO,
              })
              .eq("id", enrollment.id);
            enrollment.current_step = nextOrder;
            currentStep = nextStep;
            console.log(
              `[Sequence Processor] Enrollment ${enrollment.id}: skipped past delay step ${
                nextOrder - 1
              }`,
            );
            continue;
          } else if (currentStep.type === "condition") {
            // --- Condition gate evaluation ---
            const conditionType = currentStep.condition_type || "replied";
            const timeoutHours = currentStep.condition_timeout_hours || 48;

            // Find the previous email/ab_test step to evaluate against
            const prevEmailStepOrder = findPreviousEmailStep(
              steps,
              currentStep.order,
            );
            if (prevEmailStepOrder === null) {
              // No preceding email step — cannot evaluate, advance past it
              console.log(
                `[Sequence Processor] Enrollment ${enrollment.id}: no preceding email step for condition at ${currentStep.order}, advancing`,
              );
              const nextOrder: number = currentStep.order + 1;
              const nextStep: SequenceStep | undefined = steps.find((
                s: SequenceStep,
              ) => s.order === nextOrder);
              if (!nextStep) {
                await completeEnrollment(supabase, enrollment.id);
                currentStep = undefined as any;
                break;
              }
              await supabase
                .from("email_sequence_enrollments")
                .update({
                  current_step: nextOrder,
                  condition_waiting_since: null,
                  updated_at: nowISO,
                })
                .eq("id", enrollment.id);
              enrollment.current_step = nextOrder;
              currentStep = nextStep;
              continue;
            }

            // Query send_log for the previous email step
            const { data: prevSendLog } = await supabase
              .from("email_send_log")
              .select(
                "id, status, opened_at, clicked_at, replied_at, bounced_at",
              )
              .eq("sequence_id", sequence.id)
              .eq("lead_id", enrollment.lead_id)
              .eq("sequence_step", prevEmailStepOrder)
              .in("status", [
                "sent",
                "delivered",
                "opened",
                "clicked",
                "replied",
                "bounced",
              ])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            const conditionMet = isConditionMet(conditionType, prevSendLog);

            if (conditionMet) {
              // Condition satisfied — advance past it
              console.log(
                `[Sequence Processor] Enrollment ${enrollment.id}: condition "${conditionType}" met at step ${currentStep.order}`,
              );
              const nextOrder: number = currentStep.order + 1;
              const nextStep: SequenceStep | undefined = steps.find((
                s: SequenceStep,
              ) => s.order === nextOrder);
              if (!nextStep) {
                await completeEnrollment(supabase, enrollment.id);
                currentStep = undefined as any;
                break;
              }
              await supabase
                .from("email_sequence_enrollments")
                .update({
                  current_step: nextOrder,
                  condition_waiting_since: null,
                  updated_at: nowISO,
                })
                .eq("id", enrollment.id);
              enrollment.current_step = nextOrder;
              currentStep = nextStep;
              continue;
            }

            // Condition NOT met — check timeout
            const waitingSince = enrollment.condition_waiting_since
              ? new Date(enrollment.condition_waiting_since)
              : null;

            if (!waitingSince) {
              // First time hitting this condition — start the timer
              console.log(
                `[Sequence Processor] Enrollment ${enrollment.id}: entering condition gate "${conditionType}" at step ${currentStep.order}, timeout ${timeoutHours}h`,
              );
              await supabase
                .from("email_sequence_enrollments")
                .update({
                  condition_waiting_since: nowISO,
                  next_send_at: new Date(now.getTime() + 5 * 60 * 1000)
                    .toISOString(),
                  updated_at: nowISO,
                })
                .eq("id", enrollment.id);
              conditionWaiting = true;
              break;
            }

            const elapsedHours = (now.getTime() - waitingSince.getTime()) /
              (1000 * 60 * 60);

            if (elapsedHours >= timeoutHours) {
              // Timeout expired — complete the enrollment
              console.log(
                `[Sequence Processor] Enrollment ${enrollment.id}: condition "${conditionType}" timed out after ${timeoutHours}h at step ${currentStep.order}`,
              );
              await supabase
                .from("email_sequence_enrollments")
                .update({
                  status: "completed",
                  condition_waiting_since: null,
                  next_send_at: null,
                  updated_at: nowISO,
                })
                .eq("id", enrollment.id);
              currentStep = undefined as any;
              break;
            }

            // Still waiting — check stop conditions (reply/bounce) while waiting
            const { data: stopReplies } = await supabase
              .from("email_send_log")
              .select("id, status")
              .eq("sequence_id", sequence.id)
              .eq("lead_id", enrollment.lead_id)
              .in("status", ["replied", "bounced", "spam"])
              .limit(1);

            if (
              stopReplies && stopReplies.length > 0 && settings.stop_on_reply !== false
            ) {
              const replyStatus = stopReplies[0].status;
              await supabase
                .from("email_sequence_enrollments")
                .update({
                  status: replyStatus,
                  condition_waiting_since: null,
                  next_send_at: null,
                  updated_at: nowISO,
                })
                .eq("id", enrollment.id);
              currentStep = undefined as any;
              break;
            }

            // Re-queue for next processor run
            await supabase
              .from("email_sequence_enrollments")
              .update({
                next_send_at: new Date(now.getTime() + 5 * 60 * 1000)
                  .toISOString(),
                updated_at: nowISO,
              })
              .eq("id", enrollment.id);
            conditionWaiting = true;
            break;
          } else {
            // Unknown step type — skip
            console.warn(
              `[Sequence Processor] Unknown step type "${currentStep.type}" at order ${currentStep.order}`,
            );
            break;
          }
        }

        // If we stopped at a non-sendable step (delay, condition waiting) or completed, skip to next enrollment
        if (
          conditionWaiting || !currentStep ||
          (currentStep.type !== "email" && currentStep.type !== "ab_test")
        ) {
          skippedCount++;
          continue;
        }

        // ========================================
        // Guard checks
        // ========================================

        // 1. Weekend check (must run BEFORE business hours so we always reschedule to Monday)
        if (isWeekend(now, settings)) {
          const nextMonday = getNextMonday(now, settings);
          await updateNextSend(supabase, enrollment.id, nextMonday);
          skippedCount++;
          continue;
        }

        // 2. Business hours check (per-mailbox jitter offsets the window start for staggering)
        if (
          !isWithinBusinessHours(
            now,
            settings,
            enrollment.mailbox_id || undefined,
          )
        ) {
          skippedCount++;
          continue;
        }

        // 3. Sequence daily limit
        if (settings.daily_limit) {
          const seqKey = sequence.id;
          if (!sequenceDailySends[seqKey]) {
            sequenceDailySends[seqKey] = await countSequenceSendsToday(
              supabase,
              sequence.id,
            );
          }
          if (sequenceDailySends[seqKey] >= settings.daily_limit) {
            skippedCount++;
            continue;
          }
        }

        // 4. Max new leads per day
        if (
          settings.max_new_leads_per_day != null &&
          enrollment.current_step === 0
        ) {
          const seqKey = `new_${sequence.id}`;
          if (!sequenceNewLeadsToday[seqKey]) {
            sequenceNewLeadsToday[seqKey] = await countNewLeadsSendsToday(
              supabase,
              sequence.id,
            );
          }
          if (sequenceNewLeadsToday[seqKey] >= settings.max_new_leads_per_day) {
            skippedCount++;
            continue;
          }
        }

        // 5. Load lead data from pre-fetched map (avoids N+1 queries)
        const lead = leadMap.get(enrollment.lead_id);

        if (!lead) {
          console.error(
            `[Sequence Processor] Lead not found: ${enrollment.lead_id}`,
          );
          errorCount++;
          continue;
        }

        // 5.5 Hard unsubscribe / suppression guard (PECR) — see batch fetch above.
        if (
          lead.source === "crm_contact" && lead.source_id &&
          suppressedContactIds.has(lead.source_id)
        ) {
          await supabase.from("email_send_log").insert({
            organization_id: organizationId,
            mailbox_id: enrollment.mailbox_id,
            sequence_id: sequence.id,
            sequence_step: enrollment.current_step,
            lead_id: enrollment.lead_id,
            recipient_email: lead.email,
            status: "filtered",
            error_message: "contact_suppressed",
            created_at: nowISO,
          });
          await supabase
            .from("email_sequence_enrollments")
            .update({ status: "unsubscribed", updated_at: nowISO })
            .eq("id", enrollment.id);
          console.log(
            `[Sequence Processor] SUPPRESS ${enrollment.id}: contact ${lead.source_id} suppressed`,
          );
          filteredCount++;
          continue;
        }

        // 6.0 Phase 8.3 — Just-in-time list verification.
        // If we've never verified this address (or the cache expired), call
        // the configured verifier provider once and update lead.email_status.
        // Catches: invalid syntax, no MX, disposable, role, catch_all per
        // the org's settings. Adds ~150-300ms to first send for fresh leads;
        // subsequent sends hit the 30-day cache and skip this entirely.
        try {
          const lead_email = lead.email as string | null | undefined;
          if (
            lead_email &&
            (lead.email_status === "unknown" || lead.email_status == null)
          ) {
            const verifyResult = await verifyEmailAddress(
              supabase,
              organizationId,
              lead_email,
            );
            const orgConfig = await getOrgVerifierConfig(
              supabase,
              organizationId,
            );
            const decision = decideAllow(
              verifyResult,
              orgConfig,
              !!settings.allow_risky_emails,
            );

            // Push verifier output into the lead row so the existing risky-email
            // filter (step 6, below) and other code paths see a coherent status.
            const projectedLeadStatus = verifyResult.status === "valid"
              ? "valid"
              : (verifyResult.status === "invalid" ||
                  verifyResult.status === "disposable")
              ? "invalid"
              : verifyResult.status === "catch_all"
              ? "catch_all"
              : "risky";
            if (projectedLeadStatus !== lead.email_status) {
              await supabase
                .from("leads")
                .update({ email_status: projectedLeadStatus })
                .eq("id", enrollment.lead_id);
              lead.email_status = projectedLeadStatus;
            }

            if (!decision.allow) {
              console.log(
                `[Sequence Processor] Pre-flight verifier blocked ${enrollment.id}: ${decision.reason} (status=${verifyResult.status}, provider=${verifyResult.provider})`,
              );
              await supabase.from("email_send_log").insert({
                organization_id: organizationId,
                mailbox_id: enrollment.mailbox_id,
                sequence_id: sequence.id,
                sequence_step: enrollment.current_step,
                lead_id: enrollment.lead_id,
                recipient_email: lead_email,
                status: "filtered",
                error_message: `verifier:${decision.reason}`,
                created_at: nowISO,
              });
              await advanceEnrollment(supabase, enrollment, steps, settings, {
                email: lead_email,
              });
              filteredCount++;
              continue;
            }
          }
        } catch (e) {
          // Verifier failure is non-fatal: we still try to send. The address
          // may bounce, but blocking on a transient DoH or provider outage
          // would silently halt the entire pipeline.
          console.warn(
            `[Sequence Processor] Verifier exception for enrollment ${enrollment.id}: ${
              e instanceof Error ? e.message : "unknown"
            } — proceeding.`,
          );
        }

        // 6. Risky email filter — skip risky/invalid emails unless allow_risky_emails is enabled
        if (!settings.allow_risky_emails) {
          let emailStatus = lead.email_status || "unknown";

          // If lead has no direct email_status, derive from CRM contact enrichment data
          // (populated by CSV imports with email_status column, or Prospeo/Apollo enrichment)
          if (
            emailStatus === "unknown" && lead.source === "crm_contact" &&
            lead.source_id
          ) {
            const { data: contactEnrichment } = await supabase
              .from("crm_contacts")
              .select("enrichment_data")
              .eq("id", lead.source_id)
              .maybeSingle();

            if (contactEnrichment?.enrichment_data) {
              const enrichment = contactEnrichment.enrichment_data;
              // Check direct email_status field (from CSV import mapping)
              if (enrichment.email_status) {
                emailStatus = deriveEmailStatus(enrichment.email_status);
              } // Fall back to emailConfidence (from Prospeo/Apollo enrichment)
              else if (enrichment.emailConfidence != null) {
                emailStatus = emailStatusFromConfidence(
                  Number(enrichment.emailConfidence),
                );
              }

              // Backfill the leads table for future runs
              if (emailStatus !== "unknown") {
                await supabase
                  .from("leads")
                  .update({ email_status: emailStatus })
                  .eq("id", enrollment.lead_id);
              }
            }
          }

          if (
            emailStatus === "invalid" || emailStatus === "risky" ||
            emailStatus === "bounced"
          ) {
            console.log(
              `[Sequence Processor] Skipping enrollment ${enrollment.id}: lead email status "${emailStatus}" (allow_risky_emails=false)`,
            );
            await supabase.from("email_send_log").insert({
              organization_id: organizationId,
              mailbox_id: enrollment.mailbox_id,
              sequence_id: sequence.id,
              sequence_step: enrollment.current_step,
              lead_id: enrollment.lead_id,
              recipient_email: lead.email,
              status: "filtered",
              error_message: `email_status_${emailStatus}`,
              created_at: nowISO,
            });
            await advanceEnrollment(supabase, enrollment, steps, settings, {
              email: lead.email,
            });
            filteredCount++;
            continue;
          }
        }

        // 6b. Cross-sequence throttle — prevent over-mailing leads in multiple sequences
        if (lead.last_sequence_email_at) {
          const hoursSinceLastEmail =
            (now.getTime() - new Date(lead.last_sequence_email_at).getTime()) /
            3_600_000;
          if (hoursSinceLastEmail < 24) {
            console.log(
              `[Sequence Processor] Throttling enrollment ${enrollment.id}: lead received sequence email ${
                Math.round(hoursSinceLastEmail)
              }h ago`,
            );
            // Re-queue for tomorrow
            const tomorrow = new Date(now.getTime() + 24 * 3_600_000);
            await supabase
              .from("email_sequence_enrollments")
              .update({ next_send_at: tomorrow.toISOString() })
              .eq("id", enrollment.id);
            skippedCount++;
            continue;
          }
        }

        // 7. Domain limiter — daily cap on org-wide sends to a single company domain.
        if (settings.limit_per_company_domain != null) {
          const domain = lead.email?.split("@")[1]?.toLowerCase();
          if (domain) {
            if (!domainSendsToday[domain]) {
              domainSendsToday[domain] = await countDomainSendsToday(
                supabase,
                organizationId,
                domain,
              );
            }
            if (domainSendsToday[domain] >= settings.limit_per_company_domain) {
              skippedCount++;
              continue;
            }
          }
        }

        // 7b. Phase 8.4.2 — Per-recipient cross-mailbox pacing.
        // Even if the daily cap above isn't hit, blasting 5 mailboxes at one
        // company in a single hour reads as bulk spam to Gmail/Outlook.
        // Cap at `org.settings.global_company_pacing_limit` (default 3) sends
        // to a single company domain across the whole org in any 60-minute
        // window. When exceeded we DEFER the send 60-120 min, rather than
        // skipping outright, so the lead still gets the email later.
        {
          const recipientDomain = (lead.email as string | undefined)?.split(
            "@",
          )[1]?.toLowerCase();
          if (recipientDomain) {
            // Pull org pacing limit lazily and cache for the run.
            if (orgPacingLimit === null) {
              const { data: orgRow } = await supabase
                .from("organizations")
                .select("settings")
                .eq("id", organizationId)
                .maybeSingle();
              const cfg = (orgRow?.settings as
                | Record<string, unknown>
                | null
                | undefined) ?? {};
              const raw = cfg.global_company_pacing_limit;
              orgPacingLimit = typeof raw === "number" && raw > 0 ? raw : 3;
            }
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
              .toISOString();
            const { count } = await supabase
              .from("email_send_log")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .ilike("recipient_email", `%@${recipientDomain}`)
              .gte("sent_at", oneHourAgo)
              .in("status", [
                "sent",
                "delivered",
                "opened",
                "clicked",
                "replied",
              ]);
            if ((count ?? 0) >= orgPacingLimit) {
              const jitterMs = (60 + Math.floor(Math.random() * 60)) * 60 *
                1000; // 60-120 min
              const deferTo = adjustToSendWindow(
                new Date(now.getTime() + jitterMs),
                settings,
                { email: lead.email },
              );
              console.log(
                `[Sequence Processor] Cross-mailbox pacing kicked in for ${recipientDomain} (count=${count}, limit=${orgPacingLimit}); deferring enrollment ${enrollment.id} to ${deferTo.toISOString()}`,
              );
              await supabase
                .from("email_send_log")
                .insert({
                  organization_id: organizationId,
                  mailbox_id: enrollment.mailbox_id,
                  sequence_id: sequence.id,
                  sequence_step: enrollment.current_step,
                  lead_id: enrollment.lead_id,
                  recipient_email: lead.email,
                  status: "skipped",
                  error_message: "cross_mailbox_pacing",
                  created_at: nowISO,
                });
              await supabase
                .from("email_sequence_enrollments")
                .update({
                  next_send_at: deferTo.toISOString(),
                  updated_at: nowISO,
                })
                .eq("id", enrollment.id);
              skippedCount++;
              continue;
            }
          }
        }

        // 8. AI filtering
        const aiSettings: Partial<AIFilterSettings> = {
          ai_filter_unlikely_reply: settings.ai_filter_unlikely_reply,
          ai_filter_hostile: settings.ai_filter_hostile,
        };
        const filterResult = await applyAIFilters(
          supabase,
          lead,
          organizationId,
          aiSettings,
        );
        if (filterResult.action === "skip") {
          // Log as filtered
          await supabase.from("email_send_log").insert({
            organization_id: organizationId,
            mailbox_id: enrollment.mailbox_id,
            sequence_id: sequence.id,
            sequence_step: enrollment.current_step,
            lead_id: enrollment.lead_id,
            recipient_email: lead.email,
            status: "filtered",
            error_message: filterResult.reason,
            created_at: nowISO,
          });
          // Advance to next step
          await advanceEnrollment(supabase, enrollment, steps, settings, {
            email: lead.email,
          });
          filteredCount++;
          continue;
        }

        // 8.5. Re-verify enrollment is still active (IMAP poller may have updated it since batch fetch)
        const { data: freshStatus } = await supabase
          .from("email_sequence_enrollments")
          .select("status")
          .eq("id", enrollment.id)
          .single();

        if (freshStatus && freshStatus.status !== "active") {
          console.log(
            `[Sequence Processor] Enrollment ${enrollment.id} no longer active (${freshStatus.status}), skipping`,
          );
          skippedCount++;
          continue;
        }

        // 9. Stop conditions: check if lead has replied or bounced
        const { data: existingReplies } = await supabase
          .from("email_send_log")
          .select("id, status")
          .eq("sequence_id", sequence.id)
          .eq("lead_id", enrollment.lead_id)
          .in("status", ["replied", "bounced", "spam"])
          .limit(1);

        if (existingReplies && existingReplies.length > 0) {
          const replyStatus = existingReplies[0].status;
          await supabase
            .from("email_sequence_enrollments")
            .update({ status: replyStatus, updated_at: nowISO })
            .eq("id", enrollment.id);
          skippedCount++;
          continue;
        }

        // 10. Company-level stop
        if (settings.stop_company_on_reply) {
          const companyDomain = lead.email?.split("@")[1]?.toLowerCase();
          if (companyDomain) {
            const companyReplied = await checkCompanyReplied(
              supabase,
              sequence.id,
              companyDomain,
            );
            if (companyReplied) {
              await supabase
                .from("email_sequence_enrollments")
                .update({ status: "paused", updated_at: nowISO })
                .eq("id", enrollment.id);
              skippedCount++;
              continue;
            }
          }
        }

        // ========================================
        // Mailbox selection (global → enrollment → rotation)
        // ========================================

        let mailboxId = enrollment.mailbox_id;
        let mailbox: any = null;

        // Continuation enrollments (interested-reply follow-ups, MCP/agent enrolls) must keep
        // the SAME mailbox + thread the prospect already replied to. When an anchor resolves,
        // the thread mailbox is authoritative — we wait for it rather than rotate to a stranger.
        const continuation = await resolveContinuationAnchor(
          supabase,
          enrollment,
          organizationId,
        );
        if (continuation) {
          mailboxId = continuation.mailboxId;
        }

        // Pre-compute recipient provider for provider matching checks
        const recipientProvider = settings.provider_matching
          ? getProviderFromRecipient(lead.email)
          : null;

        // Continuation: bind to the thread's mailbox; never rotate to a different sender.
        // On success sets `mailbox`, so the rotation tiers below short-circuit via their guards.
        if (continuation) {
          const { data: pinned } = await supabase
            .from("email_mailboxes")
            .select(
              "id, email_address, provider, health_score, daily_sent, daily_limit, last_send_at, metadata, status, connection_type, display_name, first_name, last_name, bounce_rate",
            )
            .eq("id", mailboxId)
            .eq("status", "ready")
            .eq("imap_connected", true)
            .maybeSingle();

          const pinnedLimit = pinned
            ? ((settings.hypersend_mode && pinned.health_score > 0.80 &&
                (pinned.bounce_rate ?? 0) < 0.05)
              ? pinned.daily_limit * 3
              : pinned.daily_limit)
            : 0;

          if (pinned && pinned.daily_sent < pinnedLimit) {
            mailbox = pinned;
            if (enrollment.mailbox_id !== pinned.id) {
              await supabase
                .from("email_sequence_enrollments")
                .update({ mailbox_id: pinned.id, updated_at: nowISO })
                .eq("id", enrollment.id);
            }
          } else if (pinned) {
            // Healthy but at its daily cap — wait for tomorrow's window rather than switching inbox.
            const tomorrow = adjustToSendWindow(
              new Date(now.getTime() + 24 * 3_600_000),
              settings,
              { email: lead.email },
            );
            await updateNextSend(
              supabase,
              enrollment.id,
              tomorrow.toISOString(),
            );
            console.log(
              `[Sequence Processor] WAIT ${enrollment.id}: continuation mailbox at daily cap, rescheduled to ${tomorrow.toISOString()}`,
            );
            skippedCount++;
            continue;
          } else {
            // Paused/disconnected/missing — back off; after 5 strikes mark terminal so it
            // surfaces in the UI instead of silently switching senders mid-thread.
            const priorSkips =
              ((enrollment.custom_data as any)?.no_mailbox_skips as number) ??
                0;
            const skips = priorSkips + 1;
            if (skips >= 5) {
              await supabase
                .from("email_sequence_enrollments")
                .update({ status: "sender_disconnected", updated_at: nowISO })
                .eq("id", enrollment.id);
              await supabase.from("email_send_log").insert({
                organization_id: organizationId,
                mailbox_id: mailboxId,
                sequence_id: sequence.id,
                sequence_step: enrollment.current_step,
                lead_id: enrollment.lead_id,
                recipient_email: lead.email,
                status: "skipped",
                error_message: "continuation_sender_unavailable",
                created_at: nowISO,
              });
              console.log(
                `[Sequence Processor] ${enrollment.id}: continuation mailbox ${mailboxId} unavailable x${skips} → sender_disconnected`,
              );
              skippedCount++;
              continue;
            }
            const backoffMin = Math.min(
              30 * Math.pow(2, Math.min(priorSkips, 4)),
              360,
            );
            const retryTime = adjustToSendWindow(
              new Date(now.getTime() + backoffMin * 60_000),
              settings,
              { email: lead.email },
            );
            await supabase
              .from("email_sequence_enrollments")
              .update({
                next_send_at: retryTime.toISOString(),
                custom_data: {
                  ...((enrollment.custom_data as Record<string, any>) || {}),
                  no_mailbox_skips: skips,
                },
                updated_at: nowISO,
              })
              .eq("id", enrollment.id);
            console.log(
              `[Sequence Processor] WAIT ${enrollment.id}: continuation mailbox ${mailboxId} unavailable (skip #${skips}), backed off ${backoffMin}min`,
            );
            skippedCount++;
            continue;
          }
        }

        // 1. Check global lead-to-mailbox assignment first
        if (!mailboxId && lead.assigned_mailbox_id) {
          const { data: globalMailbox } = await supabase
            .from("email_mailboxes")
            .select(
              "id, email_address, provider, health_score, daily_sent, daily_limit, last_send_at, metadata, status, connection_type, display_name, first_name, last_name, bounce_rate, warmup_enabled, warmup_day",
            )
            .eq("id", lead.assigned_mailbox_id)
            .eq("status", "ready")
            .eq("imap_connected", true)
            .single();

          if (globalMailbox && isMailboxStillWarming(globalMailbox)) {
            // Pre-assigned while still warming — fall through to rotation for
            // a graduated inbox rather than putting campaign traffic on it.
            console.log(
              `[Sequence Processor] Global assignment ${globalMailbox.id} still warming — falling through to rotation`,
            );
          } else if (globalMailbox) {
            // Provider matching override: skip global assignment if provider doesn't match
            if (
              recipientProvider && globalMailbox.provider &&
              globalMailbox.provider !== recipientProvider
            ) {
              console.log(
                `[Sequence Processor] Provider mismatch on global assignment: mailbox=${globalMailbox.provider}, recipient=${recipientProvider} — falling through to rotation`,
              );
              mailboxId = null;
            } else {
              const effectiveLimit =
                (settings.hypersend_mode && globalMailbox.health_score > 0.80 &&
                    (globalMailbox.bounce_rate ?? 0) < 0.05)
                  ? globalMailbox.daily_limit * 3
                  : globalMailbox.daily_limit;

              if (globalMailbox.daily_sent < effectiveLimit) {
                mailbox = globalMailbox;
                mailboxId = globalMailbox.id;
                // Sync enrollment sticky to match global assignment
                await supabase
                  .from("email_sequence_enrollments")
                  .update({ mailbox_id: mailbox.id, updated_at: nowISO })
                  .eq("id", enrollment.id);
              }
            }
          }
        }

        // 2. Enrollment-level sticky mailbox
        if (mailboxId && !mailbox) {
          const { data: stickyMailbox } = await supabase
            .from("email_mailboxes")
            .select(
              "id, email_address, provider, health_score, daily_sent, daily_limit, last_send_at, metadata, status, connection_type, display_name, first_name, last_name, bounce_rate, warmup_enabled, warmup_day",
            )
            .eq("id", mailboxId)
            .eq("status", "ready")
            .eq("imap_connected", true)
            .single();

          if (stickyMailbox && isMailboxStillWarming(stickyMailbox)) {
            // Sticky to a mailbox that hasn't graduated warmup — drop the
            // stickiness and rotate onto a graduated inbox instead.
            console.log(
              `[Sequence Processor] Sticky mailbox ${stickyMailbox.id} still warming — falling through to rotation`,
            );
            mailboxId = null;
          } else if (stickyMailbox) {
            // Provider matching override: skip sticky if provider doesn't match
            if (
              recipientProvider && stickyMailbox.provider &&
              stickyMailbox.provider !== recipientProvider
            ) {
              console.log(
                `[Sequence Processor] Provider mismatch on sticky mailbox: mailbox=${stickyMailbox.provider}, recipient=${recipientProvider} — falling through to rotation`,
              );
              mailboxId = null;
            } else {
              const effectiveLimit =
                (settings.hypersend_mode && stickyMailbox.health_score > 0.80 &&
                    (stickyMailbox.bounce_rate ?? 0) < 0.05)
                  ? stickyMailbox.daily_limit * 3
                  : stickyMailbox.daily_limit;

              if (stickyMailbox.daily_sent < effectiveLimit) {
                mailbox = stickyMailbox;
              } else {
                // Sticky mailbox unavailable, select a new one
                mailboxId = null;
              }
            }
          } else {
            // Sticky mailbox unavailable — check if enrollment already started
            if (enrollment.current_step > 0) {
              // Emails already sent from this mailbox — mark as sender_disconnected
              // to avoid switching senders mid-conversation thread
              console.warn(
                `[Sequence Processor] Sticky mailbox ${mailboxId} unavailable for enrollment ${enrollment.id} (step ${enrollment.current_step}) — marking sender_disconnected`,
              );
              await supabase
                .from("email_sequence_enrollments")
                .update({ status: "sender_disconnected", updated_at: nowISO })
                .eq("id", enrollment.id);
              skippedCount++;
              continue;
            }
            // Not started yet — clear and fall through to rotation
            mailboxId = null;
          }
        }

        // 3. Fresh rotation (with advanced features when enabled)
        if (!mailboxId) {
          const hasAdvancedFeatures = settings.sisr_enabled ||
            settings.hypersend_mode ||
            (settings.esp_routing_rules &&
              settings.esp_routing_rules.length > 0) ||
            settings.provider_matching;

          if (hasAdvancedFeatures) {
            mailbox = await selectMailboxAdvanced(supabase, {
              organizationId,
              recipientEmail: lead.email,
              mailboxIds: poolMailboxIds ?? undefined,
              providerMatching: settings.provider_matching,
              espRoutingRules: settings.esp_routing_rules,
              sisrEnabled: settings.sisr_enabled,
              hypersendMode: settings.hypersend_mode,
              leadId: enrollment.lead_id,
            });
          } else {
            mailbox = await selectMailbox(supabase, organizationId, {
              mailboxIds: poolMailboxIds,
            });
          }

          if (!mailbox) {
            console.warn(
              `[Sequence Processor] No mailbox available for org ${organizationId} — all mailboxes exhausted or unhealthy`,
            );
            await supabase.from("email_send_log").insert({
              organization_id: organizationId,
              sequence_id: sequence.id,
              sequence_step: enrollment.current_step,
              lead_id: enrollment.lead_id,
              recipient_email: lead.email,
              status: "skipped",
              error_message: pool.mode === "auto" && pool.eligibleCount === 0
                ? "no_mailbox_matches_rule"
                : "no_mailbox_available",
              created_at: nowISO,
            });
            skippedCount++;
            continue;
          }

          // Set sticky mailbox for this enrollment
          await supabase
            .from("email_sequence_enrollments")
            .update({ mailbox_id: mailbox.id, updated_at: nowISO })
            .eq("id", enrollment.id);

          // Set global lead-to-mailbox assignment
          await supabase
            .from("leads")
            .update({ assigned_mailbox_id: mailbox.id, updated_at: nowISO })
            .eq("id", enrollment.lead_id);
        }

        // ========================================
        // Prepare and send email
        // ========================================

        // Resolve A/B variant if applicable
        let subject = currentStep.subject || "";
        let body = currentStep.body || "";
        let variantId: string | null = null;

        if (currentStep.variants && currentStep.variants.length > 0) {
          const variant = await resolveVariant(
            supabase,
            enrollment,
            currentStep,
            sequence.id,
            settings,
          );
          subject = variant.subject;
          body = variant.body;
          variantId = variant.variantId || null;

          // Persist new variant assignment so the same lead always sees the same variant
          if (variant.isNewAssignment && variant.variantId) {
            const assignments = enrollment.variant_assignments || {};
            const stepKey = String(currentStep.order);
            await supabase
              .from("email_sequence_enrollments")
              .update({
                variant_assignments: {
                  ...assignments,
                  [stepKey]: variant.variantId,
                },
                updated_at: nowISO,
              })
              .eq("id", enrollment.id);
          }
        }

        // Per-enrollment content override: if custom_data has custom_email_N_subject/body
        // for this email step, use that instead of the step's own content. This allows
        // AI-generated content to override even manual/static sequences.
        //
        // Skip the override when the step body already references {{email_body_N}}
        // inline — that means the template intentionally wraps the AI content with its
        // own static text (signature, sender name, P.S., unsubscribe), and substituteVariables
        // resolves the token in place. Overriding the whole body here would otherwise
        // silently discard that surrounding text (e.g. {{sender_first_name}}/{{sender_last_name}}
        // never get evaluated because the text they live in is thrown away first).
        const customData = (enrollment as any).custom_data || {};
        const emailStepNumber = steps
          .filter((s: SequenceStep) =>
            (s.type === "email" || s.type === "ab_test") &&
            s.order <= currentStep.order
          )
          .length;
        const customSubject =
          customData[`custom_email_${emailStepNumber}_subject`];
        const customBody = customData[`custom_email_${emailStepNumber}_body`];
        const usesEmailBodyToken = new RegExp(
          `\\{\\{\\s*email_body_${emailStepNumber}\\s*\\}\\}`,
          "i",
        ).test(body);
        if (customSubject && customBody && !usesEmailBodyToken) {
          subject = customSubject;
          body = customBody;
        }

        // Enrich lead with CRM contact data (for richer variable substitution)
        const enrichedLead = await enrichLeadWithCrmData(supabase, lead);
        const mailboxSenderName = (mailbox?.display_name as string) || "";
        // Prefer the dedicated first_name/last_name columns; fall back to splitting the
        // display name on the first space (composed last names stay intact).
        const mailboxContext = {
          signature: (mailbox?.metadata as any)?.signature || "",
          senderName: mailboxSenderName,
          senderFirstName: (mailbox?.first_name as string) ||
            mailboxSenderName.split(" ")[0] || "",
          senderLastName: (mailbox?.last_name as string) ||
            mailboxSenderName.split(" ").slice(1).join(" ") || "",
        };
        const orgCustomFieldDefaults =
          orgCustomFieldDefaultsMap.get(organizationId) || {};
        const variableDefaults = {
          ...orgCustomFieldDefaults,
          ...(settings.variable_defaults || {}),
        };
        const productId = settings.product_id as string | undefined;
        const productContext = productId
          ? (productMap.get(productId) ?? {})
          : {};
        const unresolvedTokens = new Set<string>();
        subject = substituteVariables(
          subject,
          enrichedLead,
          enrollment.id,
          customData,
          mailboxContext,
          variableDefaults,
          productContext,
          unresolvedTokens,
        );
        body = substituteVariables(
          body,
          enrichedLead,
          enrollment.id,
          customData,
          mailboxContext,
          variableDefaults,
          productContext,
          unresolvedTokens,
        );

        // Substitution erases unknown tokens at its final fallback, so capture
        // their names there instead of scanning the already-rendered text.
        // Optional mailbox variables and deferred unsubscribe links return
        // before that fallback and do not block an enrollment.
        const unresolved = [...unresolvedTokens];
        if (unresolved.length > 0) {
          console.error(
            `[Sequence Processor] Unresolved ${unresolved.length} token(s) ${unresolved.map((t) => `{{${t}}}`).join(", ")} for enrollment ${enrollment.id} (step ${enrollment.current_step}) — pausing instead of sending`,
          );
          await supabase
            .from("email_sequence_enrollments")
            .update({
              status: "paused",
              metadata: {
                ...(enrollment.metadata || {}),
                blocked_reason: "unresolved_variable",
                blocked_at: nowISO,
                blocked_detail: `unresolved: ${unresolved.join(", ")}`,
              },
              updated_at: nowISO,
            })
            .eq("id", enrollment.id);
          await supabase.from("email_send_log").insert({
            organization_id: organizationId,
            mailbox_id: mailbox.id,
            sequence_id: sequence.id,
            sequence_step: enrollment.current_step,
            lead_id: enrollment.lead_id,
            recipient_email: lead.email,
            status: "filtered",
            error_message: `unresolved_variable: ${unresolved.slice(0, 5).join(", ")}`,
            created_at: nowISO,
          });
          errorCount++;
          continue;
        }

        // Re: threading — if follow-up step has no subject, inherit from previous email step
        let inReplyTo: string | undefined;
        let emailReferences: string[] | undefined;

        if (continuation) {
          // Continuation: thread onto the original conversation on every step, overriding the
          // step's own subject so it lands in the same thread the prospect replied to.
          const base = (continuation.subject || "").replace(/^Re:\s*/i, "");
          if (base) subject = `Re: ${base}`;
          if (continuation.inReplyTo) {
            inReplyTo = continuation.inReplyTo;
            emailReferences =
              continuation.references && continuation.references.length > 0
                ? continuation.references
                : [continuation.inReplyTo];
          }
        } else if (!subject && enrollment.current_step > 0) {
          // Find the most recent sent email for this lead in this sequence (for subject + threading)
          const { data: prevSend } = await supabase
            .from("email_send_log")
            .select(
              "subject, email_message_id, email_in_reply_to, email_references",
            )
            .eq("sequence_id", sequence.id)
            .eq("lead_id", enrollment.lead_id)
            .in("status", ["sent", "delivered", "opened", "clicked", "replied"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (prevSend) {
            // Inherit subject with Re: prefix (strip any existing Re: to avoid Re: Re: Re:)
            const prevSubject = (prevSend.subject || "").replace(
              /^Re:\s*/i,
              "",
            );
            subject = prevSubject ? `Re: ${prevSubject}` : "";

            // Set threading headers so the follow-up lands in the same thread
            if (prevSend.email_message_id) {
              inReplyTo = prevSend.email_message_id;
              const prevRefs: string[] = prevSend.email_references || [];
              emailReferences = [...prevRefs, prevSend.email_message_id];
            }
          }
        }

        // ============================================================
        // Guard: never send a blank email.
        // ============================================================
        // substituteVariables() resolves an unknown {{var}} to '' by design, so
        // a step written entirely out of per-contact variables
        // ({{email_subject_1}} / {{email_body_1}}) renders to NOTHING when the
        // enrollment carries no custom_data — e.g. a lead pulled in by the
        // auto-enroll cron rather than by lead processing, which is the only
        // path that writes that content. On 2026-08-06 that sent 61 empty
        // emails (23 bounced) before anyone noticed.
        //
        // Fails closed: pause the enrollment rather than looping on it every
        // cron tick, and record why so the UI/operator can see it.
        const bodyText = body
          .replace(/\{\{\s*unsubscribe_link\s*\}\}/gi, "")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .trim();
        if (!subject.trim() || !bodyText) {
          console.error(
            `[Sequence Processor] Blank ${!subject.trim() ? "subject" : ""}${
              !subject.trim() && !bodyText ? " and " : ""
            }${
              !bodyText ? "body" : ""
            } for enrollment ${enrollment.id} (step ${enrollment.current_step}) — pausing instead of sending`,
          );
          await supabase
            .from("email_sequence_enrollments")
            .update({
              status: "paused",
              metadata: {
                ...((enrollment as any).metadata || {}),
                blocked_reason: "missing_content",
                blocked_at: nowISO,
                blocked_detail: !subject.trim() && !bodyText
                  ? "subject and body rendered empty"
                  : (!subject.trim()
                    ? "subject rendered empty"
                    : "body rendered empty"),
              },
              updated_at: nowISO,
            })
            .eq("id", enrollment.id);
          errorCount++;
          continue;
        }

        // Create send_log entry first (for tracking ID)
        const { data: sendLog, error: logError } = await supabase
          .from("email_send_log")
          .insert({
            organization_id: organizationId,
            mailbox_id: mailbox.id,
            campaign_id: null,
            lead_id: enrollment.lead_id,
            sequence_id: sequence.id,
            sequence_step: enrollment.current_step,
            variant_id: variantId,
            recipient_email: lead.email,
            subject,
            body,
            status: "sending",
            created_at: nowISO,
          })
          .select("id")
          .single();

        if (logError || !sendLog) {
          console.error(
            "[Sequence Processor] Failed to create send_log:",
            logError?.message,
          );
          errorCount++;
          continue;
        }
        openSendLogId = sendLog.id;

        // Resolve tracking domain from email_tracking_domains table
        const tdId = sequence.tracking_domain_id;
        let trackingDomain: string | null = null;
        if (tdId) {
          if (tdId in trackingDomainCache) {
            trackingDomain = trackingDomainCache[tdId];
          } else {
            const { data: tdRow } = await supabase
              .from("email_tracking_domains")
              .select("domain")
              .eq("id", tdId)
              .single();
            trackingDomain = tdRow?.domain || null;
            trackingDomainCache[tdId] = trackingDomain;
          }
        }

        // Backward compat: fall back to deprecated custom_tracking_domain in settings
        if (!trackingDomain && settings.custom_tracking_domain) {
          trackingDomain = settings.custom_tracking_domain;
          console.warn(
            `[Sequence Processor] Sequence ${sequence.id}: using deprecated custom_tracking_domain from settings — migrate to tracking domains table`,
          );
        }

        // Fallback: a sequence with no tracking_domain_id of its own should use
        // the org's verified DEFAULT tracking domain rather than failing to send.
        if (!trackingDomain) {
          if (organizationId in orgDefaultTrackingDomainCache) {
            trackingDomain = orgDefaultTrackingDomainCache[organizationId];
          } else {
            const { data: defTd } = await supabase
              .from("email_tracking_domains")
              .select("domain")
              .eq("organization_id", organizationId)
              .eq("is_verified", true)
              .eq("is_default", true)
              .limit(1)
              .maybeSingle();
            trackingDomain = defTd?.domain || null;
            orgDefaultTrackingDomainCache[organizationId] = trackingDomain;
          }
          if (trackingDomain) {
            console.warn(
              `[Sequence Processor] Sequence ${sequence.id}: no tracking_domain_id set — falling back to org default tracking domain`,
            );
          }
        }

        if (!trackingDomain) {
          console.error(
            `[Sequence Processor] No tracking domain for sequence ${sequence.id} — skipping send`,
          );
          await supabase
            .from("email_send_log")
            .update({
              status: "skipped",
              error_message: "missing_tracking_domain",
            })
            .eq("id", sendLog.id);
          skippedCount++;
          continue;
        }

        // Unsubscribe URL — Smartlead/Instantly shape: https://<domain>/u/<send-log-id>.
        // The send log's random v4 UUID IS the token (122 bits, already written, resolves
        // to org + lead server-side), so the link carries no long signed blob. Host is the
        // org's VERIFIED tracking domain, else ACA's proxy host — never supabase.co, which
        // is what made this read like an infra URL at the bottom of a cold email.
        // Keep in sync with workers/sequence-sender/src/index.ts (the live sender).
        const unsubToken = sendLog.id;
        const verifiedCacheKey = `${organizationId}:${trackingDomain}`;
        if (!(verifiedCacheKey in trackingDomainVerifiedCache)) {
          const { data: tdVerified } = await supabase
            .from("email_tracking_domains")
            .select("is_verified")
            .eq("organization_id", organizationId)
            .eq("domain", trackingDomain)
            .maybeSingle();
          trackingDomainVerifiedCache[verifiedCacheKey] =
            tdVerified?.is_verified === true;
        }
        const unsubscribeBase = trackingDomainVerifiedCache[verifiedCacheKey]
          ? `https://${trackingDomain}`
          : UNSUBSCRIBE_FALLBACK_BASE;
        const unsubscribeUrl = `${unsubscribeBase}/u/${unsubToken}`;

        // Late-resolve {{unsubscribe_link}} in subject and body (couldn't resolve earlier without sendLogId).
        // Body renders as HTML except for a text-only first step, so give a manually-placed
        // variable a real hyperlink with human anchor text — never the bare URL.
        const isFirstStep = enrollment.current_step === 0;
        const bodyIsHtml = !(settings.first_email_text_only && isFirstStep);
        const unsubscribeBodyValue = bodyIsHtml
          ? buildUnsubscribeAnchor(
            unsubscribeUrl,
            settings.unsubscribe_footer_text,
          )
          : unsubscribeUrl;
        const hadUnsubVar = body.includes("{{unsubscribe_link}}") ||
          subject.includes("{{unsubscribe_link}}");
        body = body.replace(/\{\{unsubscribe_link\}\}/g, unsubscribeBodyValue);
        subject = subject.replace(/\{\{unsubscribe_link\}\}/g, unsubscribeUrl);

        // Update send_log with resolved body if {{unsubscribe_link}} was used
        if (hadUnsubVar) {
          await supabase
            .from("email_send_log")
            .update({ subject, body })
            .eq("id", sendLog.id);
        }

        // Apply tracking

        const trackingSettings: TrackingSettings = {
          open_tracking: settings.open_tracking ?? false,
          click_tracking: settings.click_tracking ?? true,
          custom_tracking_domain: trackingDomain,
          first_email_text_only: settings.first_email_text_only,
          unsubscribe_link_footer: settings.unsubscribe_link_footer,
          unsubscribe_footer_text: settings.unsubscribe_footer_text,
        };

        const processedBody = prepareEmailBody(
          body,
          sendLog.id,
          lead.email,
          trackingSettings,
          isFirstStep,
          unsubscribeUrl,
        );
        const isHtml = !trackingSettings.first_email_text_only || !isFirstStep;
        const textOnlyHtmlCompanion = isHtml
          ? undefined
          : buildTextOnlyUnsubscribeHtml(body, trackingSettings, unsubscribeUrl);

        // Build headers
        const headers: Record<string, string> = {};
        if (settings.unsubscribe_header !== false) {
          const mailboxDomain = mailbox.email_address.split("@")[1];
          if (mailboxDomain) {
            headers["List-Unsubscribe"] =
              `<${unsubscribeUrl}>, <mailto:unsubscribe@${mailboxDomain}>`;
            headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
          }
        }

        // All sending goes through SMTP (ZapMail only provides inbox infrastructure, not sending)
        const smtpCreds = await extractSMTPCredentials(mailbox.metadata || {});
        if (!smtpCreds) {
          console.error(
            `[Sequence Processor] No SMTP credentials for mailbox ${mailbox.id} — all mailboxes require SMTP credentials to send`,
          );
          errorCount++;
          continue;
        }

        // Pre-send guard: re-validate mailbox hasn't hit daily limit or been paused since selection
        {
          const { data: freshMailbox } = await supabase
            .from("email_mailboxes")
            .select("daily_sent, daily_limit, status")
            .eq("id", mailbox.id)
            .single();

          if (
            !freshMailbox || freshMailbox.status !== "ready" ||
            freshMailbox.daily_sent >= freshMailbox.daily_limit
          ) {
            console.warn(
              `[Sequence Processor] Pre-send check failed: mailbox ${mailbox.id} (sent=${freshMailbox?.daily_sent}/${freshMailbox?.daily_limit}, status=${freshMailbox?.status})`,
            );
            await supabase
              .from("email_send_log")
              .update({
                status: "skipped",
                error_message: "mailbox_limit_or_status_changed",
              })
              .eq("id", sendLog.id);
            // Push next_send_at forward to avoid retry spam when mailbox is exhausted
            const retryAt = adjustToSendWindow(
              new Date(now.getTime() + 60 * 60 * 1000),
              settings,
              { email: lead.email },
            );
            await supabase
              .from("email_sequence_enrollments")
              .update({
                next_send_at: retryAt.toISOString(),
                updated_at: nowISO,
              })
              .eq("id", enrollment.id);
            skippedCount++;
            continue;
          }
        }

        // Phase 8.1.2: ESP-specific rate limiting. Defer this send if Gmail/
        // Outlook/Yahoo would tarpit us based on per-IP/min or per-recipient-
        // domain/hour caps. Cheaper to wait than to burn the IP's reputation.
        {
          const stickyIpId =
            (mailbox.metadata as Record<string, unknown> | null | undefined)
              ?.sticky_ip_id as string | undefined;
          const throttle = await shouldThrottleSend(supabase, {
            organization_id: organizationId,
            mailbox_id: mailbox.id,
            recipient_email: lead.email,
            sticky_ip_id: stickyIpId ?? null,
          });
          if (!throttle.allowed) {
            const waitMs = (throttle.retry_after_seconds ?? 60) * 1000;
            const retryAt = adjustToSendWindow(
              new Date(now.getTime() + waitMs),
              settings,
              { email: lead.email },
            );
            console.log(
              `[Sequence Processor] ESP throttle: ${throttle.reason} — deferring ${enrollment.id} to ${retryAt.toISOString()}`,
            );
            await supabase
              .from("email_send_log")
              .update({
                status: "skipped",
                error_message: `esp_throttle:${throttle.bucket}`,
              })
              .eq("id", sendLog.id);
            await supabase
              .from("email_sequence_enrollments")
              .update({
                next_send_at: retryAt.toISOString(),
                updated_at: nowISO,
              })
              .eq("id", enrollment.id);
            skippedCount++;
            continue;
          }
        }

        // Phase 8.1.4: Content pre-flight scorer. Block obvious spam patterns
        // (unresolved merge vars, ALL CAPS, money symbols, trigger phrases)
        // BEFORE the email leaves the server. Score < threshold = drop.
        // Bypass via settings.allow_risky_emails for users who knowingly accept the risk.
        if (!settings.allow_risky_emails) {
          const scoreResult = scoreContent({
            subject,
            body: processedBody,
            isHtml,
            isFirstStep,
          });
          if (scoreResult.score < DEFAULT_BLOCK_THRESHOLD) {
            const topWarnings = scoreResult.warnings
              .filter((w) => w.severity !== "minor")
              .slice(0, 3)
              .map((w) => w.code)
              .join(",");
            console.warn(
              `[Sequence Processor] Content blocked (score=${scoreResult.score}, warnings=${topWarnings})`,
            );
            await supabase
              .from("email_send_log")
              .update({
                status: "filtered",
                error_message:
                  `content_score:${scoreResult.score}:${topWarnings}`,
              })
              .eq("id", sendLog.id);
            // Advance the enrollment so we don't loop on the same bad content.
            await advanceEnrollment(supabase, enrollment, steps, settings, {
              email: lead.email,
            });
            filteredCount++;
            continue;
          }
        }

        // Phase 8.4.3 — Content variation detector. Hash the rendered body
        // (post merge-vars) and refuse to send the EXACT same body from >5
        // distinct mailboxes in 24h. Gmail/Outlook flag this as bulk-send.
        // The hash is recipient-domain agnostic so identical pitches to
        // multiple companies still count toward the limit.
        let contentHash: string | null = null;
        try {
          const hashInput = `${subject}\n${processedBody}`;
          const enc = new TextEncoder().encode(hashInput);
          const digest = await crypto.subtle.digest("SHA-256", enc);
          contentHash = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            .toISOString();
          const { data: hashRows } = await supabase
            .from("email_content_hash_log")
            .select("mailbox_id")
            .eq("organization_id", organizationId)
            .eq("content_hash", contentHash)
            .gte("sent_at", cutoff24h);
          const distinctMailboxes = new Set<string>(
            ((hashRows ?? []) as Array<{ mailbox_id: string }>).map((r) =>
              r.mailbox_id
            ),
          );
          // The current mailbox doesn't count against the 5-mailbox limit
          // (resending the same body from one mailbox isn't bulk fan-out).
          distinctMailboxes.delete(mailbox.id);
          if (distinctMailboxes.size >= 5) {
            console.warn(
              `[Sequence Processor] Content hash repeat: ${
                contentHash.slice(0, 12)
              } sent from ${
                distinctMailboxes.size + 1
              } mailboxes in 24h — blocking ${enrollment.id}.`,
            );
            await supabase
              .from("email_send_log")
              .update({
                status: "filtered",
                error_message: "content_hash_repeat",
              })
              .eq("id", sendLog.id);
            await advanceEnrollment(supabase, enrollment, steps, settings, {
              email: lead.email,
            });
            filteredCount++;
            continue;
          }
        } catch (e) {
          // Hash failure is non-fatal — keep sending.
          console.warn(
            `[Sequence Processor] Content-hash check failed: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        }

        const sendResult = await sendEmailViaSMTP({
          credentials: smtpCreds,
          from_name: mailbox.display_name || mailbox.email_address,
          from_email: mailbox.email_address,
          to_email: lead.email,
          subject,
          html: isHtml ? processedBody : textOnlyHtmlCompanion,
          text: !isHtml ? processedBody : undefined,
          cc: settings.cc,
          bcc: settings.bcc,
          headers,
          in_reply_to: inReplyTo,
          references: emailReferences,
          send_log_id: sendLog.id,
        });

        if (sendResult.success) {
          // Update send_log to sent (with threading metadata for future Re: steps)
          await supabase
            .from("email_send_log")
            .update({
              status: "sent",
              sent_at: nowISO,
              body: processedBody,
              message_id: sendResult.message_id || null,
              email_message_id: sendResult.message_id || null,
              email_in_reply_to: inReplyTo || null,
              email_references: emailReferences || null,
            })
            .eq("id", sendLog.id);

          // Phase 8.4.3 — log the content hash so future sends see this
          // mailbox as a participant when computing repetition.
          if (contentHash) {
            const recipDomain =
              (lead.email as string | undefined)?.split("@")[1]
                ?.toLowerCase() ?? "";
            await supabase.from("email_content_hash_log").insert({
              organization_id: organizationId,
              mailbox_id: mailbox.id,
              content_hash: contentHash,
              recipient_domain: recipDomain,
              sequence_id: sequence.id,
              sent_at: nowISO,
            });
          }

          // Record successful send on mailbox
          await recordSendResult(supabase, mailbox.id, true);

          // Increment variant sent counter (real-time stats for A/B testing)
          if (variantId) {
            await supabase.rpc("increment_variant_stat", {
              p_variant_id: variantId,
              p_column: "sent",
            });
          }

          // Create CRM conversation + message for inbox visibility
          await createCrmRecordForOutboundEmail(
            supabase,
            organizationId,
            lead,
            mailbox,
            subject,
            processedBody,
            sendLog.id,
            sendResult.message_id,
            isHtml,
          );

          // Advance enrollment
          await advanceEnrollment(supabase, enrollment, steps, settings, {
            email: lead.email,
          });

          // Update cross-sequence throttle timestamp
          await supabase
            .from("leads")
            .update({ last_sequence_email_at: nowISO })
            .eq("id", enrollment.lead_id);

          // Update counters
          const seqKey = sequence.id;
          sequenceDailySends[seqKey] = (sequenceDailySends[seqKey] || 0) + 1;
          if (enrollment.current_step === 0) {
            const newKey = `new_${sequence.id}`;
            sequenceNewLeadsToday[newKey] =
              (sequenceNewLeadsToday[newKey] || 0) + 1;
          }
          const domain = lead.email?.split("@")[1]?.toLowerCase();
          if (domain) {
            domainSendsToday[domain] = (domainSendsToday[domain] || 0) + 1;
          }

          sentCount++;
        } else {
          // Only a recipient-specific hard bounce may suppress a lead or affect
          // mailbox bounce health. Other SMTP failures retain their diagnostic
          // as `failed` so a reputation/policy issue cannot poison the list.
          const category = sendResult.error_category;
          const isConfirmedRecipientBounce = category === "hard_bounce";

          await supabase
            .from("email_send_log")
            .update({
              status: isConfirmedRecipientBounce ? "bounced" : "failed",
              error_message: sendResult.error || "SMTP send failed",
              error_category: category || null,
              bounced_at: isConfirmedRecipientBounce ? nowISO : null,
            })
            .eq("id", sendLog.id);

          // Keep receiver/list failures diagnostic; actual transport failures
          // still count toward the mailbox circuit breaker.
          await recordSendResult(
            supabase,
            mailbox.id,
            false,
            sendResult.error || "SMTP send failed",
            category,
          );
          if (isConfirmedRecipientBounce) {
            // Mark lead as bounced so future sequences skip this email
            if (category === "hard_bounce") {
              await supabase.from("leads").update({ email_status: "bounced" })
                .eq("id", enrollment.lead_id);
            }
          }

          errorCount++;
        }
      } catch (error) {
        console.error(
          `[Sequence Processor] Error processing enrollment ${enrollment.id}:`,
          error,
        );
        // Finalize any send_log row left open in 'sending' by this iteration so
        // it isn't orphaned (which would re-queue the lead every cron cycle).
        if (openSendLogId) {
          await supabase
            .from("email_send_log")
            .update({
              status: "failed",
              error_message: error instanceof Error
                ? error.message
                : "processing error after send_log created",
              error_category: "network_error",
            })
            .eq("id", openSendLogId)
            .eq("status", "sending");
        }
        errorCount++;
      }
    }

    console.log(
      `[Sequence Processor] Complete: ${sentCount} sent, ${skippedCount} skipped, ${filteredCount} filtered, ${errorCount} errors`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        processed: enrollments.length,
        sent: sentCount,
        skipped: skippedCount,
        filtered: filteredCount,
        errors: errorCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[Sequence Processor] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Deterministic per-mailbox offset within the send window.
 * Hashes the mailbox UUID to produce a stable offset in minutes,
 * so different mailboxes stagger their effective window start.
 */
function getMailboxWindowOffset(
  mailboxId: string,
  maxOffsetMinutes: number,
): number {
  let hash = 0;
  for (let i = 0; i < mailboxId.length; i++) {
    hash = ((hash << 5) - hash + mailboxId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % (maxOffsetMinutes + 1);
}

/**
 * Check if current time is within the send window (business hours).
 * If a mailboxId is provided, applies a per-mailbox offset to the window start
 * so different mailboxes don't all fire at the same time.
 */
function isWithinBusinessHours(
  now: Date,
  settings: SequenceSettings,
  mailboxId?: string,
): boolean {
  if (!settings.send_window) return true;

  const tz = settings.timezone || "UTC";
  const localTime = getLocalTime(now, tz);
  const localHourMin = localTime.hours * 60 + localTime.minutes;

  const [startH, startM] = settings.send_window.start.split(":").map(Number);
  const [endH, endM] = settings.send_window.end.split(":").map(Number);
  let startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  if (mailboxId) {
    const windowDuration = endMin - startMin;
    const maxOffset = Math.min(60, Math.floor(windowDuration * 0.15));
    if (maxOffset > 0) {
      startMin += getMailboxWindowOffset(mailboxId, maxOffset);
    }
  }

  return localHourMin >= startMin && localHourMin < endMin;
}

/**
 * Check if today is a weekend in the configured timezone.
 */
function isWeekend(now: Date, settings: SequenceSettings): boolean {
  if (!settings.skip_weekends) return false;

  const tz = settings.timezone || "UTC";
  const localTime = getLocalTime(now, tz);
  return localTime.dayOfWeek === 0 || localTime.dayOfWeek === 6;
}

/**
 * Get local time components in a timezone.
 */
function getLocalTime(
  date: Date,
  timezone: string,
): { hours: number; minutes: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const hours = parseInt(
    parts.find((p) => p.type === "hour")?.value || "0",
    10,
  );
  const minutes = parseInt(
    parts.find((p) => p.type === "minute")?.value || "0",
    10,
  );
  const weekday = parts.find((p) => p.type === "weekday")?.value || "Mon";

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  // ?? not ||: Sunday is 0, and `|| 1` silently reported it as Monday,
  // letting skip_weekends sequences send all day Sunday.
  return { hours, minutes, dayOfWeek: dayMap[weekday] ?? 1 };
}

/**
 * Get the next Monday at the start of the send window in the configured timezone.
 */
function getNextMonday(now: Date, settings: SequenceSettings): string {
  const tz = settings.timezone || "UTC";
  const localTime = getLocalTime(now, tz);
  const daysUntilMonday = localTime.dayOfWeek === 0
    ? 1
    : (8 - localTime.dayOfWeek);

  const windowStart = settings.send_window?.start || "08:00";
  const [startH, startM] = windowStart.split(":").map(Number);

  // Advance to Monday, then set local time to the send window start
  const nextMonday = new Date(
    now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000,
  );
  const result = setLocalTime(nextMonday, startH, startM, tz);

  return result.toISOString();
}

/**
 * Adjust a candidate send time so it falls within the send window on a valid day.
 * - If on a weekend and skip_weekends: push to Monday
 * - If before window start: set to window start + jitter
 * - If after window end: advance to next day's window start + jitter, re-check weekend
 * - If recipientEmail (and optionally country) provided, the window is anchored
 *   to the RECIPIENT's local timezone — sending at their 9am-5pm, not yours.
 * Returns a UTC Date.
 */
function adjustToSendWindow(
  candidate: Date,
  settings: SequenceSettings,
  recipient?: { email?: string | null; country?: string | null },
): Date {
  const fallbackTz = settings.timezone || "America/New_York";
  const tz = recipient?.email
    ? resolveRecipientTimezone({
      email: recipient.email,
      country: recipient.country ?? null,
      fallback: fallbackTz,
    }).timezone
    : fallbackTz;
  const sendWindow = settings.send_window;
  if (!sendWindow) return candidate;

  const [startH, startM] = sendWindow.start.split(":").map(Number);
  const [endH, endM] = sendWindow.end.split(":").map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;

  // Safety: max 10 iterations to find a valid slot (covers multi-day weekends)
  let adjusted = new Date(candidate.getTime());
  for (let attempt = 0; attempt < 10; attempt++) {
    const local = getLocalTime(adjusted, tz);
    const localMin = local.hours * 60 + local.minutes;
    const isWeekendDay = local.dayOfWeek === 0 || local.dayOfWeek === 6;

    // Weekend check
    if (settings.skip_weekends && isWeekendDay) {
      // Jump to next Monday at window start
      const daysUntilMonday = local.dayOfWeek === 0 ? 1 : (8 - local.dayOfWeek);
      adjusted = new Date(
        adjusted.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000,
      );
      // Set to window start on that day
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      // Add small jitter (0-15 min)
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      continue;
    }

    // Before window start: set to window start + jitter
    if (localMin < windowStartMin) {
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      break;
    }

    // After window end: advance to next day's window start
    if (localMin >= windowEndMin) {
      adjusted = new Date(adjusted.getTime() + 24 * 60 * 60 * 1000);
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      // Loop again to re-check weekend
      continue;
    }

    // Within window on a valid day — good to go
    break;
  }

  return adjusted;
}

/**
 * Set a Date to a specific local hour:minute in a timezone, returning UTC.
 */
function setLocalTime(
  date: Date,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  // Get the date string in the target timezone
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = dateFormatter.format(date);

  // Build local datetime and convert to UTC
  const localDateTimeStr = `${dateStr}T${String(hour).padStart(2, "0")}:${
    String(minute).padStart(2, "0")
  }:00`;
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const localStr = date.toLocaleString("en-US", { timeZone: timezone });
  const offsetMs = new Date(utcStr).getTime() - new Date(localStr).getTime();

  return new Date(new Date(localDateTimeStr + "Z").getTime() + offsetMs);
}

/**
 * Count sends for a sequence today.
 */
async function countSequenceSendsToday(
  supabase: any,
  sequenceId: string,
): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const { count } = await supabase
    .from("email_send_log")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", sequenceId)
    .gte("sent_at", `${today}T00:00:00Z`)
    .in("status", ["sent", "delivered", "opened", "clicked", "replied"]);

  return count || 0;
}

/**
 * Count new leads (step 0) sent today for a sequence.
 */
async function countNewLeadsSendsToday(
  supabase: any,
  sequenceId: string,
): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const { count } = await supabase
    .from("email_send_log")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", sequenceId)
    .eq("sequence_step", 0)
    .gte("sent_at", `${today}T00:00:00Z`)
    .in("status", ["sent", "delivered", "opened", "clicked", "replied"]);

  return count || 0;
}

/**
 * Count sends to a specific company domain today across all campaigns.
 */
async function countDomainSendsToday(
  supabase: any,
  orgId: string,
  domain: string,
): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const { count } = await supabase
    .from("email_send_log")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .ilike("recipient_email", `%@${domain}`)
    .gte("sent_at", `${today}T00:00:00Z`)
    .in("status", ["sent", "delivered", "opened", "clicked", "replied"]);

  return count || 0;
}

/**
 * Check if any lead from the same company domain has replied in this sequence.
 */
async function checkCompanyReplied(
  supabase: any,
  sequenceId: string,
  domain: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("email_send_log")
    .select("id")
    .eq("sequence_id", sequenceId)
    .eq("status", "replied")
    .ilike("recipient_email", `%@${domain}`)
    .limit(1);

  return (data?.length || 0) > 0;
}

/**
 * Find the order index of the most recent email/ab_test step before the given order.
 * Returns null if no preceding email step exists.
 */
function findPreviousEmailStep(
  steps: SequenceStep[],
  beforeOrder: number,
): number | null {
  for (let i = beforeOrder - 1; i >= 0; i--) {
    const step = steps.find((s) => s.order === i);
    if (step && (step.type === "email" || step.type === "ab_test")) {
      return i;
    }
  }
  return null;
}

/**
 * Evaluate whether a condition is met based on the send log record.
 * Status hierarchy: clicked implies opened. Replied implies opened.
 */
function isConditionMet(
  conditionType: string,
  sendLog: {
    status: string;
    opened_at: string | null;
    clicked_at: string | null;
    replied_at: string | null;
    bounced_at: string | null;
  } | null,
): boolean {
  if (!sendLog) return false;

  switch (conditionType) {
    case "opened":
      return !!(sendLog.opened_at || sendLog.clicked_at || sendLog.replied_at);
    case "clicked":
      return !!sendLog.clicked_at;
    case "replied":
      return !!sendLog.replied_at;
    case "bounced":
      return !!sendLog.bounced_at;
    default:
      return false;
  }
}

/**
 * Resolve which A/B variant to use for this enrollment step.
 * Queries email_ab_variants table for winner status and real-time stats.
 * If a winner exists, always routes 100% to the winner.
 * If auto_optimize_ab is on and sample size is reached, auto-declares the winner.
 * Otherwise, uses sticky assignment or weighted random selection.
 */
async function resolveVariant(
  supabase: any,
  enrollment: any,
  step: SequenceStep,
  sequenceId: string,
  settings: SequenceSettings,
): Promise<
  {
    subject: string;
    body: string;
    variantId?: string;
    isNewAssignment: boolean;
  }
> {
  const variants = step.variants || [];
  if (variants.length === 0) {
    return {
      subject: step.subject || "",
      body: step.body || "",
      isNewAssignment: false,
    };
  }

  // Fetch live variant data from email_ab_variants (has is_winner + real stats)
  const { data: dbVariants } = await supabase
    .from("email_ab_variants")
    .select(
      "id, variant_label, subject, body, split_percentage, sent, opened, clicked, replied, bounced, is_winner, auto_disabled, deliverability_score, deliverability_scored_at",
    )
    .eq("sequence_id", sequenceId)
    .eq("step_index", step.order);

  // Use DB variants if available, otherwise fall back to JSONB variants
  let liveVariants = (dbVariants && dbVariants.length > 0)
    ? dbVariants
    : variants;

  // Phase 8.4.4 — re-score every variant with the content scorer and
  // auto-disable any that score below 40. Score is 0-100 (higher = better).
  // Re-score at most every 24h to avoid hitting the scorer on every send.
  //
  // We score AFTER substituting placeholder values into merge vars, otherwise
  // the scorer's "unresolved merge var" heuristic (-30 points) penalises every
  // legitimate template. Templates that genuinely use no merge vars still
  // score correctly.
  if (dbVariants && dbVariants.length > 0) {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const variant of liveVariants as any[]) {
      const lastScored = variant.deliverability_scored_at
        ? new Date(variant.deliverability_scored_at).getTime()
        : 0;
      if (lastScored < dayAgo) {
        try {
          // Replace any {{var}} with a representative placeholder so the
          // scorer evaluates the rendered tone, not the raw template.
          const placeholderRe = /\{\{[^}]+\}\}/g;
          const renderedSubject = (variant.subject || "").replace(
            placeholderRe,
            "sample",
          );
          const renderedBody = (variant.body || "").replace(
            placeholderRe,
            "sample",
          );
          const r = scoreContent({
            subject: renderedSubject,
            body: renderedBody,
            isHtml: false,
            isFirstStep: step.order === 0,
          });
          const isBad = r.score < 40;
          await supabase
            .from("email_ab_variants")
            .update({
              deliverability_score: r.score,
              deliverability_warnings: r.warnings.slice(0, 6),
              deliverability_scored_at: new Date().toISOString(),
              auto_disabled: isBad,
              auto_disabled_reason: isBad ? `score_${r.score}` : null,
            })
            .eq("id", variant.id);
          variant.deliverability_score = r.score;
          variant.auto_disabled = isBad;
        } catch {
          // scoring failure shouldn't break sends
        }
      }
    }
    // Filter out auto-disabled variants from the rotation pool. If every
    // variant was disabled (e.g. all bodies have unresolved merge vars),
    // keep the highest-scoring one so the sequence doesn't crash.
    const enabled = (liveVariants as any[]).filter((v: any) =>
      !v.auto_disabled
    );
    if (enabled.length > 0) {
      liveVariants = enabled;
    } else {
      const best = (liveVariants as any[]).slice().sort((a: any, b: any) =>
        (b.deliverability_score ?? 0) - (a.deliverability_score ?? 0)
      )[0];
      liveVariants = [best];
    }
  }

  // 1. Check for existing winner — route 100% to winner
  const winner = liveVariants.find((v: any) => v.is_winner === true);
  if (winner) {
    return {
      subject: winner.subject,
      body: winner.body,
      variantId: winner.id,
      isNewAssignment: false,
    };
  }

  // 2. Auto-optimize: check if sample size reached and auto-declare winner
  if (settings.auto_optimize_ab && dbVariants && dbVariants.length > 1) {
    const sampleSize = settings.ab_sample_size || 100;
    const metric = settings.ab_winning_metric || "reply_rate";
    const allReachedSample = dbVariants.every((v: any) =>
      (v.sent || 0) >= sampleSize
    );

    if (allReachedSample) {
      // Calculate rates and find the best performer
      const rated = dbVariants.map((v: any) => {
        const delivered = Math.max(1, (v.sent || 0) - (v.bounced || 0));
        return {
          ...v,
          open_rate: (v.opened || 0) / delivered,
          click_rate: (v.clicked || 0) / delivered,
          reply_rate: (v.replied || 0) / delivered,
        };
      });

      const best = rated.reduce((a: any, b: any) => {
        if (b[metric] > a[metric]) return b;
        if (b[metric] === a[metric] && (b.sent || 0) > (a.sent || 0)) return b;
        return a;
      });

      // Auto-declare winner in DB
      await supabase
        .from("email_ab_variants")
        .update({ is_winner: false })
        .eq("sequence_id", sequenceId)
        .eq("step_index", step.order);

      await supabase
        .from("email_ab_variants")
        .update({ is_winner: true })
        .eq("id", best.id);

      console.log(
        `[Sequence Processor] Auto-optimized: variant ${best.variant_label} declared winner for sequence ${sequenceId} step ${step.order} (${metric}: ${
          (best[metric] * 100).toFixed(1)
        }%)`,
      );

      return {
        subject: best.subject,
        body: best.body,
        variantId: best.id,
        isNewAssignment: false,
      };
    }
  }

  // 3. Sticky assignment: same lead always sees the same variant
  const assignments = enrollment.variant_assignments || {};
  const stepKey = String(step.order);

  if (assignments[stepKey]) {
    const assigned = liveVariants.find((v: any) =>
      v.id === assignments[stepKey]
    );
    if (assigned) {
      return {
        subject: assigned.subject,
        body: assigned.body,
        variantId: assigned.id,
        isNewAssignment: false,
      };
    }
  }

  // 4. Weighted random selection based on split percentages
  const totalSplit = liveVariants.reduce(
    (sum: number, v: any) => sum + (v.split_percentage || 0),
    0,
  );
  let random = Math.random() * totalSplit;

  for (const variant of liveVariants) {
    random -= variant.split_percentage || 0;
    if (random <= 0) {
      return {
        subject: variant.subject,
        body: variant.body,
        variantId: variant.id,
        isNewAssignment: true,
      };
    }
  }

  const fallback = liveVariants[0];
  return {
    subject: fallback.subject,
    body: fallback.body,
    variantId: fallback.id,
    isNewAssignment: true,
  };
}

/**
 * Look up CRM contact data for a lead and merge it for variable substitution.
 * First tries direct source_id link, then falls back to email-based lookup
 * so that variables like {{company}} always resolve regardless of lead source.
 */
async function enrichLeadWithCrmData(
  supabase: any,
  lead: Record<string, any>,
): Promise<Record<string, any>> {
  let contact: any = null;

  // 1. Direct lookup via source_id (fastest, for leads created from CRM contacts)
  if (lead.source === "crm_contact" && lead.source_id) {
    const { data } = await supabase
      .from("crm_contacts")
      .select(
        "company, job_title, city, state, country, enrichment_data, discovery_metadata, custom_fields, notion_preview_url, linkedin_bio, home_page_text",
      )
      .eq("id", lead.source_id)
      .maybeSingle();
    contact = data;
  }

  // 2. Fallback: look up CRM contact by email within the same org
  if (!contact && lead.email && lead.organization_id) {
    const { data } = await supabase
      .from("crm_contacts")
      .select(
        "company, job_title, city, state, country, enrichment_data, discovery_metadata, custom_fields, notion_preview_url, linkedin_bio, home_page_text",
      )
      .eq("organization_id", lead.organization_id)
      .ilike("primary_email", lead.email)
      .maybeSingle();
    contact = data;
  }

  if (contact) {
    const enrichment = contact.enrichment_data || {};
    const discovery = contact.discovery_metadata || {};
    const enrichedLead: Record<string, any> = {
      ...lead,
      // Fill in any missing basic fields from CRM
      company: lead.company || contact.company,
      job_title: lead.job_title || contact.job_title,
      headline: enrichment.headline || contact.job_title,
      location: contact.city ||
        [contact.city, contact.state, contact.country].filter(Boolean).join(
          ", ",
        ),
      // Expose the parts individually so {{city}} / {{state}} / {{country}} resolve
      city: lead.city || contact.city,
      state: lead.state || contact.state,
      country: lead.country || contact.country,
      industry: enrichment.industry,
      linkedin_bio: contact.linkedin_bio,
      home_page_text: contact.home_page_text,
      // AI enrichment fields (same keys as campaign processor TemplateContext)
      ai_primary_need: enrichment.primary_need,
      ai_primary_need_reason: enrichment.primary_need_reasoning,
      ai_primary_need_evidence: enrichment.primary_need_evidence,
      ai_primary_need_confidence: enrichment.primary_need_confidence,
      ai_cold_email_angle: enrichment.cold_email_angle,
      ai_company_niche: enrichment.company_niche,
      ai_company_offering: enrichment.company_offering,
      ai_company_target: enrichment.company_target,
      ai_company_tagline: enrichment.company_tagline,
      ai_best_hook: enrichment.best_post_hook,
      ai_linkedin_topic_1: enrichment.linkedin_topics?.[0],
      ai_priority_1: enrichment.company_priorities?.[0],
      ai_growth_signal_1: enrichment.growth_signals?.[0]?.signal,
      ai_latest_funding: enrichment.latest_funding_round,
      ai_funding_amount: enrichment.funding_amount,
      // Discovery Layer signal fields (from discovery_metadata)
      ai_signal_type: discovery.signal_type,
      ai_signal_date: discovery.signal_date,
      ai_signal_detail: discovery.signal_detail,
      ai_signal_context: discovery.signal_outreach_context,
      ai_signal_source_url: discovery.signal_source_url ||
        discovery.directory_evidence_url,
      ai_signal_company_website: discovery.ai_signal_company_website,
      ai_signal_company_linkedin: discovery.ai_signal_company_linkedin,
      ai_signal_company_industry: discovery.ai_signal_company_industry,
      // push-moltsets-to-aca stopped mirroring these into ai_signal_* keys, so
      // fall back to the canonical company_* keys it still writes.
      ai_signal_company_size: discovery.ai_signal_company_size ||
        discovery.company_employee_range,
      ai_signal_revenue: discovery.ai_signal_revenue ||
        discovery.company_revenue_range,
      ai_signal_person: discovery.ai_signal_person,
      ai_signal_new_role: discovery.ai_signal_new_role,
      ai_signal_amount: discovery.ai_signal_amount,
      ai_signal_investors: discovery.ai_signal_investors,
      ai_signal_confidence: discovery.signal_confidence != null
        ? String(discovery.signal_confidence)
        : undefined,
      ai_pack_source: discovery.pack_source,
      ai_directory_evidence_url: discovery.directory_evidence_url,
      ai_email_confidence: discovery.email_confidence != null
        ? String(discovery.email_confidence)
        : undefined,
      ai_practice_signal_1: discovery.practice_signal_1,
      // Hiring pack extras (Aggressive Hiring signals)
      ai_signal_role_location: discovery.ai_signal_role_location,
      ai_signal_seniority: discovery.ai_signal_seniority,
      ai_signal_employment_type: discovery.ai_signal_employment_type,
      ai_signal_num_applicants: discovery.ai_signal_num_applicants != null
        ? String(discovery.ai_signal_num_applicants)
        : undefined,
      // Deliverable URLs
      notion_preview_url: contact.notion_preview_url,
    };

    // Custom fields - prefix with 'custom_' for template variable resolution
    const customFields = contact.custom_fields || {};
    for (const [key, value] of Object.entries(customFields)) {
      if (value != null) {
        enrichedLead[`custom_${key}`] = String(value);
      }
    }

    return enrichedLead;
  }

  return lead;
}

/**
 * Resolve flat spintax: `{a|b|c}` -> one of the branches, chosen uniformly.
 * Mirrors the resolver in _shared/workflow-utils.ts. Single-brace tokens like
 * {{first_name}} (no `|`) and unmatched literals are left alone.
 */
function resolveSpintax(text: string): string {
  if (!text || text.indexOf("|") === -1) return text;
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group: string) => {
    const options = group.split("|");
    return options[Math.floor(Math.random() * options.length)];
  });
}

/**
 * Variable substitution: replace {{variable}} with lead data.
 * Supports both snake_case and camelCase variable names.
 * After variables resolve, flat spintax {a|b|c} is randomized per-send.
 */
function substituteVariables(
  text: string,
  lead: Record<string, any>,
  enrollmentId?: string,
  customData?: Record<string, any>,
  mailboxContext?: {
    signature?: string;
    senderName?: string;
    senderFirstName?: string;
    senderLastName?: string;
  },
  variableDefaults?: Record<string, string>,
  productContext?: Record<string, string>,
  unresolved?: Set<string>,
): string {
  // Tiptap uses spans to make merge tags atomic in the editor. Older saved
  // steps contain those spans, so replacing {{signature}} directly would also
  // replace the token inside `data-variable-token`. Because a signature is
  // HTML, that breaks the attribute and emits both a malformed fragment and a
  // second signature. The editor now persists plain tokens; unwrap legacy
  // chips here so every outgoing email is repaired too.
  text = text.replace(
    /<span\b(?=[^>]*\bdata-(?:variable|spintax)-token\s*=)([^>]*)>[\s\S]*?<\/span>/gi,
    (_match, attributes: string) => {
      const token = attributes.match(
        /\bdata-(?:variable|spintax)-token\s*=\s*(["'])(.*?)\1/i
      );
      return token?.[2] || "";
    },
  );

  // Auto-linkify URL variables so they appear as clickable hyperlinks in HTML emails
  const maybeLink = (varName: string, val: string) =>
    varName.endsWith("_url") && /^https?:\/\//i.test(val)
      ? `<a href="${val}">${val}</a>`
      : val;

  const interpolated = text.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_match, varName) => {
      // 0. Skip unsubscribe_link — resolved later after send_log creation (needs sendLogId for token)
      if (varName === "unsubscribe_link" || varName === "unsubscribeLink") {
        return "{{unsubscribe_link}}";
      }

      // 1. Mailbox-level variables (signature/sender name come from the sending mailbox)
      if (varName === "signature") {
        return mailboxContext?.signature || "";
      }
      if (varName === "sender_first_name" || varName === "senderFirstName") {
        return mailboxContext?.senderFirstName || "";
      }
      if (varName === "sender_last_name" || varName === "senderLastName") {
        return mailboxContext?.senderLastName || "";
      }
      if (varName === "sender_name" || varName === "senderName") {
        return mailboxContext?.senderName || "";
      }

      // 2. Check per-enrollment custom_data first (AI-generated content from shared templates)
      if (customData) {
        if (
          customData[varName] !== undefined && customData[varName] !== null &&
          customData[varName] !== ""
        ) {
          return maybeLink(varName, String(customData[varName]));
        }
        // Also check with 'custom_' prefix (template steps use {{custom_email_1_subject}}, custom_data stores custom_email_1_subject)
        const withPrefix = `custom_${varName}`;
        if (
          customData[withPrefix] !== undefined &&
          customData[withPrefix] !== null && customData[withPrefix] !== ""
        ) {
          return maybeLink(varName, String(customData[withPrefix]));
        }
        // Handle {{email_subject_N}} / {{email_body_N}} → custom_email_N_subject / custom_email_N_body
        // User-facing variables use email_subject_1 format, but custom_data stores as custom_email_1_subject
        const emailVarMatch = varName.match(/^email_(subject|body)_(\d+)$/);
        if (emailVarMatch) {
          const remapped = `custom_email_${emailVarMatch[2]}_${
            emailVarMatch[1]
          }`;
          if (
            customData[remapped] !== undefined &&
            customData[remapped] !== null && customData[remapped] !== ""
          ) {
            return maybeLink(varName, String(customData[remapped]));
          }
        }
      }

      // 2.5 Product variables (resolved from sequence settings.product_id)
      if (productContext && productContext[varName] !== undefined) {
        return maybeLink(varName, productContext[varName]);
      }

      // 3. Check lead data
      const value = lead[varName];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return maybeLink(varName, String(value));
      }

      // 4. Common aliases (camelCase → snake_case and vice versa)
      const aliases: Record<string, string> = {
        first_name: "first_name",
        firstName: "first_name",
        last_name: "last_name",
        lastName: "last_name",
        company: "company",
        companyName: "company",
        company_name: "company",
        email: "email",
        title: "job_title",
        jobTitle: "job_title",
        job_title: "job_title",
        headline: "headline",
        location: "location",
        industry: "industry",
        // AI enrichment aliases (camelCase → snake_case)
        aiPrimaryNeed: "ai_primary_need",
        aiPrimaryNeedReason: "ai_primary_need_reason",
        aiPrimaryNeedEvidence: "ai_primary_need_evidence",
        aiPrimaryNeedConfidence: "ai_primary_need_confidence",
        aiColdEmailAngle: "ai_cold_email_angle",
        aiCompanyNiche: "ai_company_niche",
        aiCompanyOffering: "ai_company_offering",
        aiCompanyTarget: "ai_company_target",
        aiCompanyTagline: "ai_company_tagline",
        aiBestHook: "ai_best_hook",
        aiLinkedInTopic1: "ai_linkedin_topic_1",
        aiPriority1: "ai_priority_1",
        aiGrowthSignal1: "ai_growth_signal_1",
        aiLatestFunding: "ai_latest_funding",
        aiFundingAmount: "ai_funding_amount",
        // Discovery Layer aliases (camelCase → snake_case)
        aiSignalType: "ai_signal_type",
        aiSignalDate: "ai_signal_date",
        aiSignalDetail: "ai_signal_detail",
        aiSignalContext: "ai_signal_context",
        aiSignalSourceUrl: "ai_signal_source_url",
        aiSignalCompanyWebsite: "ai_signal_company_website",
        aiSignalCompanyLinkedin: "ai_signal_company_linkedin",
        aiSignalCompanyIndustry: "ai_signal_company_industry",
        aiSignalCompanySize: "ai_signal_company_size",
        aiSignalRevenue: "ai_signal_revenue",
        aiSignalPerson: "ai_signal_person",
        aiSignalNewRole: "ai_signal_new_role",
        aiSignalAmount: "ai_signal_amount",
        aiSignalInvestors: "ai_signal_investors",
        aiSignalConfidence: "ai_signal_confidence",
        aiPackSource: "ai_pack_source",
        aiDirectoryEvidenceUrl: "ai_directory_evidence_url",
        aiEmailConfidence: "ai_email_confidence",
        aiPracticeSignal1: "ai_practice_signal_1",
        aiSignalRoleLocation: "ai_signal_role_location",
        aiSignalSeniority: "ai_signal_seniority",
        aiSignalEmploymentType: "ai_signal_employment_type",
        aiSignalNumApplicants: "ai_signal_num_applicants",
        // snake_case AI enrichment (direct match)
        ai_primary_need: "ai_primary_need",
        ai_company_niche: "ai_company_niche",
        ai_company_offering: "ai_company_offering",
        ai_company_target: "ai_company_target",
        ai_best_hook: "ai_best_hook",
        ai_priority_1: "ai_priority_1",
        ai_signal_type: "ai_signal_type",
        ai_signal_detail: "ai_signal_detail",
        ai_signal_context: "ai_signal_context",
        ai_signal_source_url: "ai_signal_source_url",
        ai_signal_company_website: "ai_signal_company_website",
        ai_signal_company_linkedin: "ai_signal_company_linkedin",
        ai_signal_company_industry: "ai_signal_company_industry",
        ai_signal_company_size: "ai_signal_company_size",
        ai_signal_revenue: "ai_signal_revenue",
        ai_signal_person: "ai_signal_person",
        ai_signal_new_role: "ai_signal_new_role",
        ai_signal_amount: "ai_signal_amount",
        ai_signal_investors: "ai_signal_investors",
        ai_signal_confidence: "ai_signal_confidence",
        ai_pack_source: "ai_pack_source",
        ai_signal_role_location: "ai_signal_role_location",
        ai_signal_seniority: "ai_signal_seniority",
        ai_signal_employment_type: "ai_signal_employment_type",
        ai_signal_num_applicants: "ai_signal_num_applicants",
      };

      const aliasedKey = aliases[varName];
      if (
        aliasedKey && lead[aliasedKey] !== undefined &&
        lead[aliasedKey] !== null && String(lead[aliasedKey]).trim() !== ""
      ) {
        return maybeLink(varName, String(lead[aliasedKey]));
      }

      // 5. Sequence-level variable defaults (user-configured fallbacks)
      if (variableDefaults) {
        // Check exact varName, then check the canonical alias key
        const defaultVal = variableDefaults[varName] ??
          (aliasedKey ? variableDefaults[aliasedKey] : undefined);
        if (defaultVal !== undefined && defaultVal !== "") {
          return maybeLink(varName, defaultVal);
        }
      }

      // 6. Final fallback — report missing contact data before erasing the token.
      // Mailbox variables and unsubscribe_link return above and are never blocked.
      unresolved?.add(varName);
      console.warn(
        `[Sequence Processor] Unresolved variable "{{${varName}}}" for ${
          enrollmentId ? `enrollment ${enrollmentId}` : "unknown enrollment"
        }, lead ${lead.id || "unknown"}`,
      );
      return "";
    },
  );

  return resolveSpintax(interpolated);
}

/**
 * Sample a time from a normal distribution within the send window for a target date.
 * Uses Box-Muller transform. Peak at 40% of window (mid-morning), stddev 20%.
 * Returns a UTC Date within the window on the target day.
 */
function sampleFromSendWindow(
  settings: SequenceSettings,
  targetDate: Date,
): Date {
  const sendWindow = settings.send_window;
  if (!sendWindow) return targetDate;

  const [startH, startM] = sendWindow.start.split(":").map(Number);
  const [endH, endM] = sendWindow.end.split(":").map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;
  const windowDuration = windowEndMin - windowStartMin;

  if (windowDuration <= 0) return targetDate;

  // Box-Muller normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  // Mean at 40% of window (mid-morning), stddev at 20%
  let normalizedPosition = 0.40 + z * 0.20;
  normalizedPosition = Math.max(0.05, Math.min(0.95, normalizedPosition));

  const sampledMinuteOfDay = Math.round(
    windowStartMin + normalizedPosition * windowDuration,
  );
  const sampledHour = Math.floor(sampledMinuteOfDay / 60);
  const sampledMin = sampledMinuteOfDay % 60;

  // Get the target date string in the configured timezone
  const tz = settings.timezone || "UTC";
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = dateFormatter.format(targetDate);

  // Build local datetime string and convert to UTC using timezone offset
  const localDateTimeStr = `${dateStr}T${
    String(sampledHour).padStart(2, "0")
  }:${String(sampledMin).padStart(2, "0")}:00`;
  const utcStr = targetDate.toLocaleString("en-US", { timeZone: "UTC" });
  const localStr = targetDate.toLocaleString("en-US", { timeZone: tz });
  const offsetMs = new Date(utcStr).getTime() - new Date(localStr).getTime();

  return new Date(new Date(localDateTimeStr + "Z").getTime() + offsetMs);
}

/**
 * Advance an enrollment to the next step.
 */
async function advanceEnrollment(
  supabase: any,
  enrollment: any,
  steps: SequenceStep[],
  settings: SequenceSettings,
  recipient?: { email?: string | null; country?: string | null },
): Promise<void> {
  const nextStepOrder = enrollment.current_step + 1;
  const nextStep = steps.find((s: SequenceStep) => s.order === nextStepOrder);

  if (!nextStep) {
    // No more steps - complete enrollment
    await completeEnrollment(supabase, enrollment.id);
    return;
  }

  const delayHours = nextStep.delay_hours || 24;
  let nextSendAt: Date;

  if (delayHours >= 12 && settings.send_window) {
    // Next-day+ delays: distribute sends across the window using a normal curve
    const baseTarget = new Date(Date.now() + delayHours * 60 * 60 * 1000);
    nextSendAt = sampleFromSendWindow(settings, baseTarget);
  } else {
    // Same-day / short delays: use existing gap + jitter
    const delayMs = delayHours * 60 * 60 * 1000;
    const minGapMs = (settings.min_time_gap_minutes || 0) * 60 * 1000;
    const jitterMs = Math.random() * (settings.random_additional_minutes || 0) *
      60 * 1000;
    nextSendAt = new Date(Date.now() + delayMs + minGapMs + jitterMs);
  }

  // Ensure the calculated time falls within send window on a valid day —
  // recipient-anchored when we know the lead's email (Phase 8.1.3).
  nextSendAt = adjustToSendWindow(nextSendAt, settings, recipient);

  await supabase
    .from("email_sequence_enrollments")
    .update({
      current_step: nextStepOrder,
      next_send_at: nextSendAt.toISOString(),
      condition_waiting_since: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollment.id);
}

/**
 * Mark an enrollment as completed.
 */
async function completeEnrollment(
  supabase: any,
  enrollmentId: string,
): Promise<void> {
  await supabase
    .from("email_sequence_enrollments")
    .update({
      status: "completed",
      next_send_at: null,
      condition_waiting_since: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId);
}

/**
 * Update next_send_at on an enrollment.
 */
async function updateNextSend(
  supabase: any,
  enrollmentId: string,
  nextSendAt: string,
): Promise<void> {
  await supabase
    .from("email_sequence_enrollments")
    .update({
      next_send_at: nextSendAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId);
}

/**
 * Create CRM conversation + message for an outbound sequence email.
 * This makes sequence emails visible in the unified inbox.
 * Non-fatal: logs errors but never throws.
 */
async function createCrmRecordForOutboundEmail(
  supabase: any,
  organizationId: string,
  lead: Record<string, any>,
  mailbox: any,
  subject: string,
  body: string,
  sendLogId: string,
  messageId: string,
  isHtml: boolean,
): Promise<void> {
  try {
    // Find CRM contact
    let contactId = lead.source === "crm_contact" ? lead.source_id : null;

    if (!contactId) {
      const { data: contact } = await supabase
        .from("crm_contacts")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("primary_email", lead.email)
        .maybeSingle();

      contactId = contact?.id;
    }

    if (!contactId) {
      // Create minimal CRM contact from lead data
      const { data: newContact } = await supabase
        .from("crm_contacts")
        .insert({
          organization_id: organizationId,
          display_name:
            [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
            lead.email,
          first_name: lead.first_name || null,
          last_name: lead.last_name || null,
          primary_email: lead.email,
          company: lead.company || null,
          job_title: lead.job_title || null,
          source_channel: "email",
        })
        .select("id")
        .single();

      contactId = newContact?.id;
    }

    if (!contactId) return;

    // Get or create email conversation (with mailbox_id)
    const { data: conversationId } = await supabase.rpc(
      "get_or_create_conversation",
      {
        p_org_id: organizationId,
        p_contact_id: contactId,
        p_channel: "email",
        p_channel_account_id: null,
        p_external_conversation_id: null,
        p_external_participant_id: lead.email,
        p_mailbox_id: mailbox.id,
      },
    );

    if (!conversationId) return;

    // Insert CRM message (the trigger updates conversation stats)
    const preview = body.replace(/<[^>]*>/g, "").substring(0, 100);
    const { data: crmMessage } = await supabase
      .from("crm_messages")
      .insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        contact_id: contactId,
        direction: "outbound",
        sender_type: "automation",
        content: body,
        content_type: isHtml ? "html" : "text",
        email_subject: subject,
        email_from: mailbox.email_address,
        email_to: [lead.email],
        external_message_id: messageId || null,
        status: "sent",
        metadata: { send_log_id: sendLogId, source: "email_sequence" },
      })
      .select("id")
      .single();

    // Link send_log to CRM message
    if (crmMessage) {
      await supabase
        .from("email_send_log")
        .update({ crm_message_id: crmMessage.id })
        .eq("id", sendLogId);
    }
  } catch (error) {
    console.error(
      "[Sequence Processor] Failed to create CRM record (non-fatal):",
      error,
    );
  }
}

/**
 * Normalize raw email_status values from various sources (CSV, Apollo, Prospeo)
 * to our standard set: 'valid' | 'risky' | 'invalid' | 'catch_all' | 'unknown'.
 */
/**
 * Continuation anchor: when a follow-up enrollment should continue an existing email thread
 * (interested-reply follow-ups, or MCP/agent enrolls that pass continue_from_conversation_id),
 * resolve the mailbox that owns the thread + the Message-ID / References / subject to reply onto.
 * Returns null for ordinary cold enrollments (no marker) — they keep rotating + start a fresh thread.
 */
interface ContinuationAnchor {
  mailboxId: string;
  inReplyTo?: string;
  references?: string[];
  subject?: string;
}

async function resolveContinuationAnchor(
  supabase: any,
  enrollment: any,
  organizationId: string,
): Promise<ContinuationAnchor | null> {
  const meta = (enrollment.metadata as Record<string, any>) || {};
  const conversationId: string | undefined = meta.continue_from_conversation_id;
  const sourceSequenceId: string | undefined = meta.source_sequence_id;
  if (!conversationId && !sourceSequenceId) return null;

  // Path A — explicit conversation (MCP / external agent / UI): thread onto the latest message.
  if (conversationId) {
    const { data: conv } = await supabase
      .from("crm_conversations")
      .select("id, mailbox_id")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (conv?.mailbox_id) {
      const anchor: ContinuationAnchor = { mailboxId: conv.mailbox_id };
      const { data: recentMessages } = await supabase
        .from("crm_messages")
        .select("external_message_id, email_subject, metadata, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(10);

      type RecentConversationMessage = {
        external_message_id?: string | null;
        email_subject?: string | null;
        metadata?: Record<string, unknown> | null;
      };
      const messages = (recentMessages || []) as RecentConversationMessage[];
      const latestMessage = messages[0];
      const threadMessage = messages.find((message) => {
        const metadata = message.metadata || {};
        return !!(metadata.email_message_id || message.external_message_id);
      });

      if (threadMessage) {
        const m = threadMessage.metadata || {};
        const messageId = m.email_message_id || threadMessage.external_message_id;
        if (typeof messageId === "string") {
          anchor.inReplyTo = messageId;
          anchor.references = [
            ...(Array.isArray(m.email_references)
              ? m.email_references.filter((value): value is string => typeof value === "string")
              : []),
            messageId,
          ];
        }
      }
      if (latestMessage?.email_subject) anchor.subject = latestMessage.email_subject;
      return anchor;
    }
  }

  // Path B — source sequence (internal follow-up engine records metadata.source_sequence_id):
  // anchor on the lead's last real send in that sequence.
  if (sourceSequenceId) {
    const { data: src } = await supabase
      .from("email_send_log")
      .select("mailbox_id, subject, email_message_id, email_references")
      .eq("sequence_id", sourceSequenceId)
      .eq("lead_id", enrollment.lead_id)
      .in("status", ["sent", "delivered", "opened", "clicked", "replied"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (src?.mailbox_id) {
      const anchor: ContinuationAnchor = { mailboxId: src.mailbox_id };
      if (src.email_message_id) {
        anchor.inReplyTo = src.email_message_id;
        anchor.references = [
          ...((src.email_references as string[]) || []),
          src.email_message_id,
        ];
      }
      if (src.subject) anchor.subject = src.subject;
      return anchor;
    }
  }

  return null;
}

function deriveEmailStatus(raw: string): string {
  const normalized = (raw || "").toLowerCase().trim();
  switch (normalized) {
    case "valid":
    case "verified":
      return "valid";
    case "invalid":
      return "invalid";
    case "risky":
    case "guessed":
    case "accept_all":
    case "accept-all":
      return "risky";
    case "catch_all":
    case "catch-all":
    case "catchall":
      return "catch_all";
    default:
      return "unknown";
  }
}

/**
 * Convert email confidence score (0-100) to email status.
 * Thresholds: >=80 → valid, >=50 → risky, <50 → invalid.
 */
function emailStatusFromConfidence(confidence: number): string {
  if (confidence >= 80) return "valid";
  if (confidence >= 50) return "risky";
  if (confidence > 0) return "invalid";
  return "unknown";
}
