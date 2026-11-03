// ============================================================================
// Email Engine Sequences (email_sequences table — ZapMail-based outreach)
// ============================================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getDefaultSettings } from "@/lib/email-sequence-utils";
import { chunkedIn } from "@/hooks/crm/useContacts";
import type {
  EmailSequence,
  CreateEmailSequenceInput,
  UpdateEmailSequenceInput,
  SequenceStatus,
} from "@/types/email";
import { backgroundTasks } from "@/hooks/useBackgroundTasks";

// ============================================================================
// Queries
// ============================================================================

export interface SequenceWithStats extends EmailSequence {
  enrollment_total: number;
  enrollment_completed: number;
  enrollment_replied: number;
  enrollment_bounced: number;
  enrollment_active: number;
  // True when the sequence's mailbox pool (its mailbox_ids, or the whole org if
  // empty) resolves to at least one ready + IMAP-connected mailbox. When false,
  // an active sequence will silently stall on no-mailbox — surface a warning.
  has_usable_mailbox: boolean;
}

export interface ActiveEmailSequenceOption {
  id: string;
  name: string;
}

/**
 * Lightweight sequence picker for contextual actions such as inbox fulfillment.
 * Keep this separate from useEmailSequences(): that hook loads mailbox health and
 * five enrollment counts per sequence, which is far too expensive for a composer.
 */
export function useActiveEmailSequenceOptions(enabled = true) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["active-email-sequence-options", currentOrganization?.id],
    queryFn: async (): Promise<ActiveEmailSequenceOption[]> => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("email_sequences")
        .select("id, name, steps")
        .eq("organization_id", currentOrganization.id)
        .eq("status", "active")
        .order("name", { ascending: true });

      if (error) throw error;

      return (data || [])
        .filter((sequence) => {
          const steps = Array.isArray(sequence.steps) ? sequence.steps : [];
          const orderedSteps = [...steps]
            .filter((step): step is { type?: string; order?: number } => !!step && typeof step === "object")
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          return orderedSteps[0]?.type === "email";
        })
        .map((sequence) => ({ id: sequence.id, name: sequence.name }));
    },
    enabled: enabled && !!currentOrganization,
    staleTime: 60_000,
  });
}

export function useEmailSequences(enabled = true) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-sequences", currentOrganization?.id],
    queryFn: async (): Promise<SequenceWithStats[]> => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("email_sequences")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const sequences = (data || []).map(mapSequence);
      if (sequences.length === 0) return [];

      // Fetch the org's usable (ready + IMAP-connected) mailbox ids once, so we
      // can flag any sequence whose pool resolves to zero connected mailboxes —
      // the condition under which enrollments stall on no-mailbox. Mirrors the
      // worker's selectMailbox filter (status='ready', imap_connected=true).
      const { data: readyMailboxes, error: mailboxError } = await supabase
        .from("email_mailboxes")
        .select("id")
        .eq("organization_id", currentOrganization.id)
        .eq("status", "ready")
        .eq("imap_connected", true);
      if (mailboxError) throw mailboxError;
      const readyMailboxIds = new Set((readyMailboxes || []).map((m) => m.id));

      // Batch-fetch enrollment status counts using server-side count queries
      // (no row data transferred — scales to any number of enrollments)
      const STATUSES = ["active", "completed", "replied", "bounced"] as const;
      const statsMap = new Map<string, { total: number; completed: number; replied: number; bounced: number; active: number }>();

      await Promise.all(
        sequences.map(async (seq) => {
          // Total count + per-status counts in parallel for each sequence
          const [totalResult, ...statusResults] = await Promise.all([
            supabase
              .from("email_sequence_enrollments")
              .select("id", { count: "exact", head: true })
              .eq("sequence_id", seq.id),
            ...STATUSES.map((s) =>
              supabase
                .from("email_sequence_enrollments")
                .select("id", { count: "exact", head: true })
                .eq("sequence_id", seq.id)
                .eq("status", s)
            ),
          ]);

          for (const result of [totalResult, ...statusResults]) {
            if (result.error) throw result.error;
          }

          statsMap.set(seq.id, {
            total: totalResult.count ?? 0,
            active: statusResults[0].count ?? 0,
            completed: statusResults[1].count ?? 0,
            replied: statusResults[2].count ?? 0,
            bounced: statusResults[3].count ?? 0,
          });
        })
      );

      return sequences.map((seq) => {
        const stats = statsMap.get(seq.id);
        const poolIds = seq.settings.mailbox_selection?.mode === "auto" ? [] : seq.settings.mailbox_ids ?? [];
        // Empty pool means "use the whole org" → usable if the org has any ready
        // mailbox. A configured pool is usable only if it intersects the ready set.
        const has_usable_mailbox =
          poolIds.length === 0
            ? readyMailboxIds.size > 0
            : poolIds.some((id) => readyMailboxIds.has(id));
        return {
          ...seq,
          enrollment_total: stats?.total ?? 0,
          enrollment_completed: stats?.completed ?? 0,
          enrollment_replied: stats?.replied ?? 0,
          enrollment_bounced: stats?.bounced ?? 0,
          enrollment_active: stats?.active ?? 0,
          has_usable_mailbox,
        };
      });
    },
    enabled: enabled && !!currentOrganization,
  });
}

export function useEmailSequence(id: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-sequences", currentOrganization?.id, id],
    queryFn: async () => {
      if (!id || !currentOrganization) return null;

      const { data, error } = await supabase
        .from("email_sequences")
        .select("*")
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return mapSequence(data);
    },
    enabled: !!id && !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateEmailSequence() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateEmailSequenceInput) => {
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase
        .from("email_sequences")
        .insert({
          organization_id: currentOrganization.id,
          name: input.name,
          campaign_id: input.campaign_id || null,
          steps: input.steps || [],
          status: "draft",
          settings: { ...getDefaultSettings(), ...input.settings },
        } as any)
        .select()
        .single();

      if (error) throw error;
      return mapSequence(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sequences", currentOrganization?.id] });
      toast.success("Sequence created");
    },
    onError: (error: Error) => {
      toast.error(`Failed to create sequence: ${error.message}`);
    },
  });
}

export function useUpdateEmailSequence() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, organization_id, ...input }: UpdateEmailSequenceInput) => {
      // Queued edits retain their original tenant even after the user switches orgs.
      const organizationId = organization_id ?? currentOrganization?.id;
      if (!organizationId) throw new Error("No organization selected");
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.steps !== undefined) updateData.steps = input.steps;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.autopilot_config !== undefined) updateData.autopilot_config = input.autopilot_config;
      if (input.agent_profile_id !== undefined) updateData.agent_profile_id = input.agent_profile_id;
      // Array is the source of truth; the DB trigger keeps lead_list_id in sync.
      if (input.lead_list_ids !== undefined) updateData.lead_list_ids = input.lead_list_ids;
      if (input.lead_list_id !== undefined) updateData.lead_list_id = input.lead_list_id;
      if (input.auto_enroll_new_members !== undefined) updateData.auto_enroll_new_members = input.auto_enroll_new_members;
      if (input.enroll_filter_criteria !== undefined) updateData.enroll_filter_criteria = input.enroll_filter_criteria;
      if (input.settings !== undefined) {
        // Extract tracking_domain_id — it's a DB column, not a settings JSON field
        const { tracking_domain_id, ...restSettings } = input.settings as Record<string, unknown>;
        if (tracking_domain_id !== undefined) {
          updateData.tracking_domain_id = tracking_domain_id;
        }

        // Merge remaining fields with existing settings
        const { data: existing, error: existingError } = await supabase
          .from("email_sequences")
          .select("settings")
          .eq("id", id)
          .eq("organization_id", organizationId)
          .single();
        if (existingError) throw existingError;

        const currentSettings = (existing?.settings as Record<string, unknown>) || {};
        const merged = { ...currentSettings, ...restSettings };
        // Clean deprecated field from settings JSON if present
        delete merged.tracking_domain_id;
        delete merged.custom_tracking_domain;
        updateData.settings = merged;
      }

      const { data, error } = await supabase
        .from("email_sequences")
        .update(updateData as any)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;

      // When scheduling-related settings change, recalculate next_send_at
      // for all active enrollments so the new window takes effect immediately.
      if (input.settings !== undefined) {
        const schedulingKeys = ['send_window', 'timezone', 'skip_weekends'];
        const hasSchedulingChange = schedulingKeys.some(
          (k) => (input.settings as Record<string, unknown>)[k] !== undefined
        );
        if (hasSchedulingChange) {
          supabase.functions.invoke('reschedule-enrollments', {
            body: { sequenceId: id },
          }).then(({ error: reschedErr }) => {
            if (reschedErr) console.error('Failed to reschedule enrollments:', reschedErr);
          });
        }
      }

      return mapSequence(data);
    },
    onSuccess: (data) => {
      // Invalidate the list query
      queryClient.invalidateQueries({ queryKey: ["email-sequences", data.organization_id], exact: true });
      // Update the individual sequence cache directly (without triggering a refetch
      // that would reset local state in the builder and kill typing focus).
      queryClient.setQueryData(
        ["email-sequences", data.organization_id, data.id],
        data,
      );
    },
    onError: (error: Error) => {
      toast.error(`Failed to update sequence: ${error.message}`);
    },
  });
}

export interface DuplicateEmailSequenceInput {
  id: string;
  /** Defaults to "<source name> (copy)" server-side. */
  name?: string;
  /** Attach the same lead lists (carries auto-enroll + the enrollment filter). */
  copyLeadLists?: boolean;
  /** Enroll the leads currently in the source sequence into the copy. */
  copyEnrolledLeads?: boolean;
}

export interface DuplicateEmailSequenceResult {
  sequence: EmailSequence;
  /** True when an audience copy was kicked off — it lands after this resolves. */
  enrollmentStarted: boolean;
}

/**
 * Duplicate a sequence, optionally with its audience.
 *
 * Server-side (duplicate-email-sequence) rather than a client insert: A/B
 * variant ids must be re-minted so the copy doesn't steal the original's
 * variant rows and their stats. The copy always lands as a draft.
 *
 * The audience is a second call to enroll-leads, fired and forgotten exactly
 * like bulk list enrollment: re-enrolling five figures of leads takes its own
 * request, and it runs every admission guard (suppression,
 * one-active-sequence-per-lead, the sequence's own enrollment filter).
 */
export function useDuplicateEmailSequence() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: DuplicateEmailSequenceInput) => {
      const { data, error } = await supabase.functions.invoke("duplicate-email-sequence", {
        body: {
          sequenceId: input.id,
          name: input.name,
          copyLeadLists: input.copyLeadLists === true,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const sequence = mapSequence(data.sequence);

      if (input.copyEnrolledLeads) {
        // Fire and forget, in pages. enroll-leads works a bounded slice of the
        // source per call (the platform kills a request at 150s), so the loop
        // lives here — the browser tab outlives any single function call, and
        // every completed page is durable on its own.
        void (async () => {
          let offset = 0;
          let total = 0;
          try {
            for (;;) {
              const { data: page, error: enrollErr } = await supabase.functions.invoke(
                "enroll-leads",
                {
                  body: {
                    sequenceId: sequence.id,
                    sourceSequenceId: input.id,
                    sourceOffset: offset,
                  },
                },
              );
              if (enrollErr) throw enrollErr;
              if (page?.error) throw new Error(page.error);

              total += page?.enrolled ?? 0;
              queryClient.invalidateQueries({
                queryKey: ["email-sequences", currentOrganization?.id],
              });

              const cursor = page?.sourceCursor as
                | { offset: number; done: boolean }
                | undefined;
              if (!cursor || cursor.done) break;
              offset = cursor.offset;
            }
            toast.success(
              total > 0
                ? `Enrolled ${total.toLocaleString()} leads into "${sequence.name}"`
                : `No leads could be enrolled into "${sequence.name}" — they are unsubscribed, bounced, or already active in another sequence`,
            );
          } catch (err) {
            toast.error(
              `Copied the sequence, but enrolling its leads stopped early: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        })();
      }

      return { sequence, enrollmentStarted: input.copyEnrolledLeads === true };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["email-sequences", currentOrganization?.id] });

      toast.success(`Duplicated as "${result.sequence.name}"`, {
        description: result.enrollmentStarted
          ? "Created as a draft — enrolling its leads now, this can take a minute"
          : "Created as a draft",
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to duplicate sequence: ${error.message}`);
    },
  });
}

export function useDeleteEmailSequence() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("email_sequences")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sequences", currentOrganization?.id] });
      toast.success("Sequence deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete sequence: ${error.message}`);
    },
  });
}

export function useToggleSequenceStatus() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "active" | "paused" | "draft";
    }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from("email_sequences")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return mapSequence(data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-sequences", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-sequences", currentOrganization?.id, data.id] });
      const label = data.status === "active" ? "activated" : data.status === "draft" ? "moved to draft" : "paused";
      toast.success(`Sequence ${label}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update sequence: ${error.message}`);
    },
  });
}

// ============================================================================
// Helpers
// ============================================================================

const VALID_STEP_TYPES = new Set(["email", "delay", "condition", "ab_test"]);

// Older sequences (and some MCP-created ones) store steps with a legacy shape
// like { step, channel, subject, body, delay_days } instead of the current
// { type, order, ... }. Without `type`, the step editor renders <Icon /> as
// undefined and React throws minified error #130. Coerce unknown shapes to
// "email" so the page loads — the user can then fix the sequence in the UI.
function normalizeStep(s: any, index: number): any {
  if (!s || typeof s !== "object") {
    return { type: "email", order: index };
  }
  const type = VALID_STEP_TYPES.has(s.type) ? s.type : "email";
  const order =
    typeof s.order === "number"
      ? s.order
      : typeof s.step === "number"
      ? Math.max(0, s.step - 1)
      : index;
  // Anything other than the literal 'html' is treated as legacy plain text.
  const body_format = s.body_format === "html" ? "html" : undefined;
  return { ...s, type, order, body_format };
}

function mapSequence(raw: any): EmailSequence {
  return {
    ...raw,
    steps: Array.isArray(raw.steps) ? raw.steps.map(normalizeStep) : [],
    settings: {
      ...getDefaultSettings(),
      ...(raw.settings || {}),
      // tracking_domain_id lives on the DB column, inject into settings for UI
      tracking_domain_id: raw.tracking_domain_id || null,
    },
    autopilot_config: raw.autopilot_config || undefined,
    agent_profile_id: raw.agent_profile_id || null,
  } as EmailSequence;
}

// ============================================================================
// Contact Email Sequences (contact_email_sequences table — SmartLead/Instantly/Success.ai push)
// ============================================================================

// Types for direct push (without sequences)
export interface PushContactsDirectlyResult {
  success: boolean;
  pushed: number;
  failed: number;
  results: Array<{ contactId: string; status: 'success' | 'failed'; error?: string }>;
}

// Types
export interface ContactEmailSequenceConfig {
  prompt: string;
  delayPattern?: string;
  tone?: string;
  ctaType?: string;
  customCta?: string;
  productId?: string;
  outcomes?: string[];
  knowledgeDocumentIds?: string[];
}

// Alias used by other modules
export type EmailSequenceConfig = ContactEmailSequenceConfig;

export interface GeneratedEmail {
  step: number;
  subject: string;
  body: string;
  delay_days: number;
}

export interface ContactEmailSequence {
  id: string;
  organization_id: string;
  contact_id: string;
  name: string | null;
  email_count: number;
  generation_config: ContactEmailSequenceConfig;
  emails: GeneratedEmail[];
  status: 'draft' | 'generating' | 'ready' | 'pushed' | 'failed' | 'archived';
  error_message: string | null;
  pushed_to_tool: 'smartlead' | 'instantly' | 'successai' | 'leadconnector' | null;
  pushed_at: string | null;
  external_campaign_id: string | null;
  connection_id: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
  campaign_id: string | null;
  progress_id: string | null;
  tool_type: string | null;
  node_config: {
    connectionId?: string;
    externalCampaignId?: string;
    externalWorkflowId?: string;
    exitAfterHandoff?: boolean;
  } | null;
  notion_preview_url?: string | null;
  notion_page_id?: string | null;
}

export interface SequenceGenerationPreview {
  id: string;
  display_name: string;
  company: string | null;
  primary_email: string | null;
  enriched_at: string | null;
  hasEnrichment: boolean;
  hasEmail: boolean;
  canGenerate: boolean;
  existingSequence: ContactEmailSequence | null;
  seg_provider: string | null;
}

export function useSequenceGenerationPreview(contactIds: string[]) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['sequence-generation-preview', contactIds],
    queryFn: async (): Promise<{
      contacts: SequenceGenerationPreview[];
      summary: {
        total: number;
        withEnrichment: number;
        withEmail: number;
        canGenerate: number;
        needsAnalysis: number;
        hasExistingSequence: number;
        behindFirewall: number;
      };
    }> => {
      if (contactIds.length === 0) {
        return {
          contacts: [],
          summary: {
            total: 0,
            withEnrichment: 0,
            withEmail: 0,
            canGenerate: 0,
            needsAnalysis: 0,
            hasExistingSequence: 0,
            behindFirewall: 0,
          }
        };
      }

      const contacts = await chunkedIn(contactIds, (chunk) =>
        supabase
          .from('crm_contacts')
          .select('id, display_name, company, primary_email, enriched_at, enrichment_data, seg_provider')
          .in('id', chunk)
          .eq('organization_id', currentOrganization?.id)
      );

      const sequences = await chunkedIn(contactIds, (chunk) =>
        supabase
          .from('contact_email_sequences')
          .select('*')
          .in('contact_id', chunk)
          .eq('organization_id', currentOrganization?.id)
          .eq('status', 'ready')
          .order('created_at', { ascending: false })
      );

      const sequencesByContact = new Map<string, ContactEmailSequence>();
      for (const seq of (sequences || [])) {
        if (!sequencesByContact.has(seq.contact_id)) {
          sequencesByContact.set(seq.contact_id, seq as ContactEmailSequence);
        }
      }

      const previews: SequenceGenerationPreview[] = (contacts || []).map(contact => {
        const enrichmentData = contact.enrichment_data as Record<string, unknown> | null;
        const hasEnrichment = !!(enrichmentData &&
          Object.keys(enrichmentData).length > 0 &&
          (enrichmentData.primary_need || enrichmentData.company_niche));

        return {
          id: contact.id,
          display_name: contact.display_name,
          company: contact.company,
          primary_email: contact.primary_email,
          enriched_at: contact.enriched_at,
          hasEnrichment,
          hasEmail: !!contact.primary_email,
          canGenerate: hasEnrichment,
          existingSequence: sequencesByContact.get(contact.id) || null,
          seg_provider: contact.seg_provider || null,
        };
      });

      const withEnrichment = previews.filter(c => c.hasEnrichment).length;
      const withEmail = previews.filter(c => c.hasEmail).length;
      const canGenerate = previews.filter(c => c.canGenerate).length;
      const hasExistingSequence = previews.filter(c => c.existingSequence).length;
      const behindFirewall = previews.filter(c => c.seg_provider).length;

      return {
        contacts: previews,
        summary: {
          total: previews.length,
          withEnrichment,
          withEmail,
          canGenerate,
          needsAnalysis: previews.length - withEnrichment,
          hasExistingSequence,
          behindFirewall,
        },
      };
    },
    enabled: contactIds.length > 0 && !!currentOrganization?.id,
  });
}

export function useGenerateEmailSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      contactId: string;
      emailCount: number;
      config: ContactEmailSequenceConfig;
      model?: string;
      sequenceName?: string;
    }): Promise<{
      success: boolean;
      sequenceId: string;
      emails: GeneratedEmail[];
    }> => {
      const { data, error } = await supabase.functions.invoke('generate-email-sequence', {
        body: params,
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Generation failed');

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences', variables.contactId] });
      queryClient.invalidateQueries({ queryKey: ['sequence-generation-preview'] });
    },
    onError: (error) => {
      console.error('Email sequence generation failed:', error);
    },
  });
}

export function useContactEmailSequences(contactId?: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['contact-email-sequences', contactId],
    queryFn: async (): Promise<ContactEmailSequence[]> => {
      if (!contactId) return [];

      const { data, error } = await supabase
        .from('contact_email_sequences')
        .select('*')
        .eq('contact_id', contactId)
        .eq('organization_id', currentOrganization?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as ContactEmailSequence[];
    },
    enabled: !!contactId && !!currentOrganization?.id,
  });
}

export interface SequenceCountInfo {
  count: number;
  latestStatus: ContactEmailSequence['status'];
  pushedToTool: ContactEmailSequence['pushed_to_tool'];
}

export function useEmailSequencesCounts(contactIds: string[]) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['contact-email-sequences-counts', contactIds],
    queryFn: async (): Promise<Map<string, SequenceCountInfo>> => {
      if (contactIds.length === 0) return new Map();

      const data = await chunkedIn(contactIds, (chunk) =>
        supabase
          .from('contact_email_sequences')
          .select('contact_id, status, pushed_to_tool, created_at')
          .in('contact_id', chunk)
          .eq('organization_id', currentOrganization?.id)
          .order('created_at', { ascending: false })
      );

      const countMap = new Map<string, SequenceCountInfo>();
      for (const seq of data) {
        const existing = countMap.get(seq.contact_id);
        if (existing) {
          existing.count++;
        } else {
          countMap.set(seq.contact_id, {
            count: 1,
            latestStatus: seq.status as ContactEmailSequence['status'],
            pushedToTool: seq.pushed_to_tool as ContactEmailSequence['pushed_to_tool'],
          });
        }
      }

      return countMap;
    },
    enabled: contactIds.length > 0 && !!currentOrganization?.id,
  });
}

type ContactEmailSequenceReference = Pick<ContactEmailSequence, 'id' | 'contact_id'>;

export function useEmailSequencesByStatus(
  status: ContactEmailSequence['status'],
  contactIds: string[],
  enabled = true,
) {
  const { currentOrganization } = useAuth();
  const organizationId = currentOrganization?.id;

  return useQuery({
    queryKey: ['contact-email-sequences', 'status', organizationId, status, contactIds],
    queryFn: async (): Promise<ContactEmailSequenceReference[]> => {
      if (!organizationId || contactIds.length === 0) return [];

      return chunkedIn<ContactEmailSequenceReference>(contactIds, (chunk) =>
        supabase
          .from('contact_email_sequences')
          .select('id, contact_id')
          .eq('organization_id', organizationId)
          .eq('status', status)
          .in('contact_id', chunk)
      );
    },
    enabled: enabled && !!organizationId && contactIds.length > 0,
    retry: false,
  });
}

export function useUpdateContactEmailSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      sequenceId: string;
      updates: Partial<Pick<ContactEmailSequence, 'name' | 'emails' | 'status'>>;
    }) => {
      const { data, error } = await supabase
        .from('contact_email_sequences')
        .update(params.updates)
        .eq('id', params.sequenceId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
      toast.success('Sequence updated');
    },
    onError: (error) => {
      toast.error(`Failed to update sequence: ${error.message}`);
    },
  });
}

export function useDeleteContactEmailSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sequenceId: string) => {
      const { error } = await supabase
        .from('contact_email_sequences')
        .delete()
        .eq('id', sequenceId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
      toast.success('Sequence deleted');
    },
    onError: (error) => {
      toast.error(`Failed to delete sequence: ${error.message}`);
    },
  });
}

export function useBulkClearSequences() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (contactIds: string[]): Promise<{ deleted: number }> => {
      if (contactIds.length === 0) return { deleted: 0 };

      const data = await chunkedIn(contactIds, (chunk) =>
        supabase
          .from('contact_email_sequences')
          .delete()
          .in('contact_id', chunk)
          .eq('organization_id', currentOrganization?.id)
          .in('status', ['draft', 'generating', 'ready', 'failed'])
          .select('id')
      );

      return { deleted: data.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences-counts'] });
      queryClient.invalidateQueries({ queryKey: ['sequence-generation-preview'] });
      if (result.deleted > 0) {
        toast.success(`Cleared ${result.deleted} sequence${result.deleted !== 1 ? 's' : ''}`);
      } else {
        toast.info('No sequences to clear');
      }
    },
    onError: (error) => {
      toast.error(`Failed to clear sequences: ${error.message}`);
    },
  });
}

export function useBulkDeleteNotionPages() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (contactIds: string[]): Promise<{ archived: number; skipped: number; failed: number; continuing?: boolean; remaining?: number }> => {
      if (contactIds.length === 0) return { archived: 0, skipped: 0, failed: 0 };
      if (!currentOrganization?.id) throw new Error('No organization context');

      const { data, error } = await supabase.functions.invoke('delete-notion-pages', {
        body: { contactIds, organizationId: currentOrganization.id },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Delete failed');
      return {
        archived: data.archived,
        skipped: data.skipped,
        failed: data.failed,
        continuing: data.continuing,
        remaining: data.remaining,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lead-list-members'] });
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences-counts'] });
      if (result.continuing) {
        toast.success(
          `Deleted ${result.archived} Notion page${result.archived !== 1 ? 's' : ''} so far. ` +
          `${result.remaining} remaining — processing in background.`
        );
      } else if (result.archived > 0) {
        toast.success(
          `Deleted ${result.archived} Notion page${result.archived !== 1 ? 's' : ''}` +
          (result.skipped > 0 ? ` (${result.skipped} had no pages)` : '') +
          (result.failed > 0 ? ` (${result.failed} failed to archive)` : '')
        );
      } else {
        toast.info('No Notion pages to delete');
      }
    },
    onError: (error) => {
      toast.error(`Failed to delete Notion pages: ${error.message}`);
    },
  });
}

export function usePushSequencesToEmailTool() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      sequenceIds: string[];
      toolType: 'smartlead' | 'instantly' | 'successai';
      connectionId: string;
      externalCampaignId: string;
    }): Promise<{
      success: boolean;
      pushed: number;
      failed: number;
      results: Array<{ sequenceId: string; status: 'success' | 'failed'; error?: string }>;
    }> => {
      const results: Array<{ sequenceId: string; status: 'success' | 'failed'; error?: string }> = [];

      const sequences = await chunkedIn(params.sequenceIds, (chunk) =>
        supabase
          .from('contact_email_sequences')
          .select(`
            id,
            contact_id,
            emails,
            crm_contacts!contact_email_sequences_contact_id_fkey!inner (
              id,
              display_name,
              first_name,
              last_name,
              company,
              job_title,
              primary_email,
              company_website,
              primary_linkedin_url
            )
          `)
          .in('id', chunk)
          .eq('status', 'ready')
      );

      for (const seq of (sequences || [])) {
        const contact = seq.crm_contacts as unknown as {
          id: string;
          display_name: string;
          first_name: string | null;
          last_name: string | null;
          company: string | null;
          job_title: string | null;
          primary_email: string | null;
          company_website: string | null;
          primary_linkedin_url: string | null;
        };

        if (!contact?.primary_email) {
          results.push({ sequenceId: seq.id, status: 'failed', error: 'No email address' });
          continue;
        }

        const emails = seq.emails as GeneratedEmail[];

        const customFields: Record<string, string> = {};
        emails.forEach((email, idx) => {
          const stepNum = idx + 1;
          customFields[`email_${stepNum}_subject`] = email.subject;
          customFields[`email_${stepNum}_body`] = email.body;
          customFields[`email_${stepNum}_delay`] = String(email.delay_days);
        });

        try {
          const pushFunction = params.toolType === 'smartlead'
            ? 'push-to-smartlead'
            : params.toolType === 'instantly'
            ? 'push-to-instantly'
            : 'push-to-successai';

          const { data, error } = await supabase.functions.invoke(pushFunction, {
            body: {
              connectionId: params.connectionId,
              campaignId: params.externalCampaignId,
              contact: {
                id: contact.id,
                email: contact.primary_email,
                firstName: contact.first_name,
                lastName: contact.last_name,
                company: contact.company,
                jobTitle: contact.job_title,
                linkedinUrl: contact.primary_linkedin_url,
                website: contact.company_website,
              },
              personalizedSubject: emails[0]?.subject || '',
              personalizedBody: emails[0]?.body || '',
              customFields,
              organizationId: currentOrganization?.id,
            },
          });

          if (error || !data?.success) {
            results.push({
              sequenceId: seq.id,
              status: 'failed',
              error: error?.message || data?.error || 'Push failed'
            });
          } else {
            await supabase
              .from('contact_email_sequences')
              .update({
                status: 'pushed',
                pushed_to_tool: params.toolType,
                pushed_at: new Date().toISOString(),
                external_campaign_id: params.externalCampaignId,
                connection_id: params.connectionId,
              })
              .eq('id', seq.id);

            results.push({ sequenceId: seq.id, status: 'success' });
          }
        } catch (err) {
          results.push({
            sequenceId: seq.id,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error'
          });
        }
      }

      const pushed = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;

      return { success: failed === 0, pushed, failed, results };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });

      if (result.pushed > 0) {
        toast.success(
          `Pushed ${result.pushed} leads to email tool` +
          (result.failed > 0 ? ` (${result.failed} failed)` : '')
        );
      } else if (result.failed > 0) {
        toast.error(`All ${result.failed} leads failed to push`);
      }
    },
    onError: (error) => {
      toast.error(`Push failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Campaign Review Hooks
// ============================================================================

export interface PendingReviewSequence extends ContactEmailSequence {
  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    company: string | null;
    job_title: string | null;
    primary_email: string | null;
    avatar_url: string | null;
  };
}

export function useCampaignPendingReviewSequences(campaignId: string | undefined) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ['campaign-pending-review-sequences', campaignId, orgId],
    queryFn: async (): Promise<PendingReviewSequence[]> => {
      if (!campaignId || !orgId) return [];

      const { data, error } = await supabase
        .from('contact_email_sequences')
        .select(`
          *,
          contact:crm_contacts!contact_email_sequences_contact_id_fkey(id, first_name, last_name, display_name, company, job_title, primary_email, avatar_url)
        `)
        .eq('campaign_id', campaignId)
        .eq('organization_id', orgId)
        .eq('status', 'ready')
        .is('pushed_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as PendingReviewSequence[];
    },
    enabled: !!campaignId && !!orgId,
    refetchInterval: 30000,
  });
}

export function useApproveAndPushSequences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { sequenceIds: string[] }): Promise<{
      success: boolean;
      pushed: number;
      failed: number;
      results: Array<{ sequenceId: string; status: 'success' | 'failed'; error?: string }>;
    }> => {
      const { data, error } = await supabase.functions.invoke('approve-and-push-sequence', {
        body: { sequenceIds: params.sequenceIds },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-pending-review-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['campaign-progress'] });
      if (result.pushed > 0) {
        toast.success(
          `Approved and pushed ${result.pushed} sequence${result.pushed !== 1 ? 's' : ''}` +
          (result.failed > 0 ? ` (${result.failed} failed)` : '')
        );
      } else if (result.failed > 0) {
        toast.error(`All ${result.failed} sequences failed to push`);
      }
    },
    onError: (error) => {
      toast.error(`Approve & push failed: ${error.message}`);
    },
  });
}

export function useRegenerateSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { sequenceId: string }) => {
      const { data: seq, error: fetchErr } = await supabase
        .from('contact_email_sequences')
        .select('progress_id')
        .eq('id', params.sequenceId)
        .single();

      if (fetchErr) throw fetchErr;

      if (seq?.progress_id) {
        await supabase
          .from('campaign_lead_progress')
          .update({ status: 'pending', next_action_at: new Date().toISOString() })
          .eq('id', seq.progress_id);
      }

      const { error: archiveErr } = await supabase
        .from('contact_email_sequences')
        .update({ status: 'archived' })
        .eq('id', params.sequenceId);

      if (archiveErr) throw archiveErr;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-pending-review-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['campaign-progress'] });
      toast.success('Sequence will be regenerated on next processing cycle');
    },
    onError: (error) => {
      toast.error(`Regenerate failed: ${error.message}`);
    },
  });
}

export function useFetchReadySequencesForContacts() {
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (contactIds: string[]): Promise<ContactEmailSequence[]> => {
      if (contactIds.length === 0) return [];

      const { data, error } = await supabase
        .from('contact_email_sequences')
        .select('*')
        .in('contact_id', contactIds)
        .eq('organization_id', currentOrganization?.id)
        .eq('status', 'ready')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as ContactEmailSequence[];
    },
  });
}

export function usePushContactsDirectly() {
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      contactIds: string[];
      toolType: 'smartlead' | 'instantly' | 'successai';
      connectionId: string;
      externalCampaignId: string;
    }): Promise<PushContactsDirectlyResult> => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data: contacts, error: contactsError } = await supabase
        .from('crm_contacts')
        .select(`
          id,
          display_name,
          first_name,
          last_name,
          company,
          job_title,
          primary_email,
          company_website,
          primary_linkedin_url,
          city,
          country
        `)
        .in('id', params.contactIds)
        .eq('organization_id', currentOrganization.id);

      if (contactsError) throw contactsError;

      const results: Array<{ contactId: string; status: 'success' | 'failed'; error?: string }> = [];

      for (const contact of (contacts || [])) {
        if (!contact.primary_email) {
          results.push({ contactId: contact.id, status: 'failed', error: 'No email address' });
          continue;
        }

        try {
          const pushFunction = params.toolType === 'smartlead'
            ? 'push-to-smartlead'
            : params.toolType === 'instantly'
            ? 'push-to-instantly'
            : 'push-to-successai';

          const { data, error } = await supabase.functions.invoke(pushFunction, {
            body: {
              connectionId: params.connectionId,
              campaignId: params.externalCampaignId,
              contact: {
                id: contact.id,
                email: contact.primary_email,
                firstName: contact.first_name,
                lastName: contact.last_name,
                company: contact.company,
                jobTitle: contact.job_title,
                linkedinUrl: contact.primary_linkedin_url,
                website: contact.company_website,
              },
              leadsOnly: true,
              organizationId: currentOrganization?.id,
              customFields: {
                first_name: contact.first_name || '',
                last_name: contact.last_name || '',
                company_name: contact.company || '',
                job_title: contact.job_title || '',
                linkedin_url: contact.primary_linkedin_url || '',
                city: contact.city || '',
                country: contact.country || '',
              },
            },
          });

          if (error || !data?.success) {
            results.push({
              contactId: contact.id,
              status: 'failed',
              error: error?.message || data?.error || 'Push failed'
            });
          } else {
            results.push({ contactId: contact.id, status: 'success' });
          }
        } catch (err) {
          results.push({
            contactId: contact.id,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error'
          });
        }
      }

      const pushed = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;

      return { success: failed === 0, pushed, failed, results };
    },
    onSuccess: (result) => {
      if (result.pushed > 0) {
        toast.success(
          `Pushed ${result.pushed} leads to email tool` +
          (result.failed > 0 ? ` (${result.failed} failed)` : '')
        );
      } else if (result.failed > 0) {
        toast.error(`All ${result.failed} leads failed to push`);
      }
    },
    onError: (error) => {
      toast.error(`Push failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Enrollment Conflict Check
// ============================================================================

export interface PreviousCycleStats {
  emailsSent: number;
  opened: boolean;
  replied: boolean;
  repliedAt?: string;
}

export interface EnrollmentConflict {
  contactId: string;
  contactName?: string;
  leadId: string;
  sequenceId: string;
  sequenceName: string;
  status: string;
  previousCycleStats?: PreviousCycleStats;
}

/**
 * Check if any of the given CRM contacts already have enrollments
 * in email sequences. Returns tiered conflicts:
 * - Cross-sequence active conflicts (contacts active in other sequences)
 * - Same-sequence re-enrollment candidates (when targetSequenceId is provided)
 */
export function useEnrollmentConflicts(
  contactIds: string[],
  enabled: boolean,
  targetSequenceId?: string,
) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['enrollment-conflicts', contactIds, targetSequenceId],
    queryFn: async (): Promise<EnrollmentConflict[]> => {
      if (!currentOrganization?.id || contactIds.length === 0) return [];

      const { data, error } = await supabase.functions.invoke('check-enrollment-conflicts', {
        body: {
          contactIds,
          organizationId: currentOrganization.id,
          targetSequenceId,
        },
      });

      if (error) {
        console.error('Failed to check enrollment conflicts:', error);
        return [];
      }

      return data?.conflicts || [];
    },
    enabled: enabled && contactIds.length > 0 && !!currentOrganization?.id,
    staleTime: 30_000,
  });
}

// ============================================================================
// SEG (Secure Email Gateway) Detection
// ============================================================================

export interface SEGContact {
  contactId: string;
  email: string;
  domain: string;
  segProvider: string;
}

/**
 * Check if any of the given CRM contacts have emails on domains protected
 * by a Secure Email Gateway (Barracuda, Mimecast, Proofpoint, etc.).
 * Uses DNS-over-HTTPS MX lookups with server-side domain caching.
 */
export function useSEGDetection(contactIds: string[], enabled: boolean) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['seg-detection', contactIds],
    queryFn: async (): Promise<SEGContact[]> => {
      if (!currentOrganization?.id || contactIds.length === 0) return [];

      const { data, error } = await supabase.functions.invoke('check-seg-status', {
        body: { contactIds, organizationId: currentOrganization.id },
      });

      if (error) {
        throw new Error(error.message || 'Failed to check SEG status');
      }

      return data?.segContacts || [];
    },
    enabled: enabled && contactIds.length > 0 && !!currentOrganization?.id,
    staleTime: 0,
    gcTime: 0,
  });
}

const SEG_BATCH_SIZE = 2000;
const SEG_MAX_RETRIES = 3;

async function invokeWithRetry(
  fnName: string,
  body: Record<string, any>,
  maxRetries = SEG_MAX_RETRIES,
): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.functions.invoke(fnName, { body });
    if (!error) return data;
    if (attempt === maxRetries) throw new Error(error.message || `Failed to invoke ${fnName}`);
    // Exponential backoff: 1s, 2s, 4s
    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

/**
 * Fire-and-forget SEG detection for large contact selections (handles 50K+ contacts).
 * Drives a global progress bar (survives navigation) and shows brief toasts on completion.
 * Returns a `run(contactIds)` function — no dialog needed.
 */
export function useCheckFirewalls() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const run = async (contactIds: string[]) => {
    if (!currentOrganization?.id || contactIds.length === 0) return;

    const taskId = `firewall-${Date.now()}`;
    const total = contactIds.length;

    toast.success("Firewall check started", { duration: 3000 });

    const onCancel = () => {
      backgroundTasks.update(taskId, { cancelling: true });
    };

    backgroundTasks.start({
      id: taskId,
      type: "firewall",
      label: "Checking firewalls",
      checked: 0,
      total,
      color: "amber",
      onCancel,
    });

    try {
      const allSeg: SEGContact[] = [];
      let cancelled = false;

      for (let i = 0; i < total; i += SEG_BATCH_SIZE) {
        // Check if user cancelled
        if (backgroundTasks.isCancelling(taskId)) {
          cancelled = true;
          break;
        }

        const batch = contactIds.slice(i, i + SEG_BATCH_SIZE);
        const data = await invokeWithRetry('check-seg-status', {
          contactIds: batch,
          organizationId: currentOrganization.id,
        });
        allSeg.push(...(data?.segContacts || []));
        backgroundTasks.update(taskId, {
          checked: Math.min(i + SEG_BATCH_SIZE, total),
          extra: allSeg.length > 0 ? `${allSeg.length} found` : undefined,
        });
      }

      // Invalidate to refresh table badges
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lead-list-members'] });

      backgroundTasks.finish(taskId);

      if (cancelled) {
        const checked = allSeg.length > 0 ? ` (${allSeg.length} firewalls found so far)` : '';
        toast.info(`Firewall check cancelled${checked}`, { duration: 4000 });
      } else if (allSeg.length === 0) {
        toast.success(`All clear — no firewalls detected across ${total.toLocaleString()} contacts.`, { duration: 4000 });
      } else {
        toast.warning(
          `${allSeg.length.toLocaleString()} of ${total.toLocaleString()} contacts are behind firewalls. They'll be auto-excluded.`,
          { duration: 4000 },
        );
      }
    } catch (err) {
      backgroundTasks.finish(taskId);
      toast.error(`Firewall check failed: ${err instanceof Error ? err.message : 'Unknown error'}`, { duration: 4000 });
    }
  };

  return { run };
}

// Lite (heuristic-only) is fast → bigger batches; Full (Apify Million Verifier)
// hits a paid actor and Apify caps sync runs at 5 min, so go smaller.
// Mailtester Ninja runs through an async job + cron worker, so the frontend
// only fires one kickoff call per launch — no per-batch loop.
const VERIFY_LITE_BATCH = 2000;
const VERIFY_FULL_BATCH = 200;

export type VerifyProvider = 'lite' | 'apify_million_verifier' | 'mailtester_ninja';

interface VerifyCounts {
  valid: number;
  invalid: number;
  risky: number;
  catch_all: number;
  disposable: number;
  role: number;
  unknown: number;
}

/**
 * Fire-and-forget email verification for a contact selection. Mirrors
 * useCheckFirewalls: drives a global progress bar (survives navigation),
 * chunks into batches, and shows a brief result toast on completion.
 *
 * Hits infra-list-verify-batch with contact_ids[]. The endpoint resolves
 * primary_email per contact, runs the heuristic + Million Verifier (or
 * configured provider) pipeline, and caches results for 30 days in
 * email_address_verifications. Subsequent enrollments and exports hit
 * cache and short-circuit invalid / disposable / role addresses.
 */
export function useVerifyEmails() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const run = async (
    contactIds: string[],
    provider: VerifyProvider = 'lite',
    opts: { listId?: string; entireList?: boolean } = {},
  ) => {
    if (!currentOrganization?.id) return;

    if (provider === 'mailtester_ninja') {
      // For full-list verifies we ship list_id to the kickoff instead of the
      // (potentially huge) contact_ids array. Avoids 3MB+ POST bodies.
      await runMailtesterAsync({
        contactIds,
        organizationId: currentOrganization.id,
        queryClient,
        // Always carry the source list through to the async job so selected
        // subsets remain visible on that list. Only whole-list runs use the
        // server-side list shortcut; selected subsets still send contact IDs.
        listId: opts.listId,
        useListShortcut: opts.entireList === true,
      });
      return;
    }

    if (contactIds.length === 0) return;

    const taskId = `verify-${Date.now()}`;
    const total = contactIds.length;
    const batchSize =
      provider === 'apify_million_verifier' ? VERIFY_FULL_BATCH : VERIFY_LITE_BATCH;
    const label =
      provider === 'apify_million_verifier'
        ? 'Verifying emails (Million Verifier)'
        : 'Verifying emails (Lite)';
    const totals: VerifyCounts = {
      valid: 0, invalid: 0, risky: 0, catch_all: 0, disposable: 0, role: 0, unknown: 0,
    };

    toast.success(
      provider === 'apify_million_verifier'
        ? `Full verification started — running ${total.toLocaleString()} addresses through Million Verifier`
        : 'Email verification started',
      { duration: 3000 },
    );

    backgroundTasks.start({
      id: taskId,
      type: 'verify',
      label,
      checked: 0,
      total,
      color: 'amber',
      onCancel: () => backgroundTasks.update(taskId, { cancelling: true }),
    });

    try {
      let cancelled = false;

      for (let i = 0; i < total; i += batchSize) {
        if (backgroundTasks.isCancelling(taskId)) {
          cancelled = true;
          break;
        }
        const batch = contactIds.slice(i, i + batchSize);
        const data = await invokeWithRetry('infra-list-verify-batch', {
          organization_id: currentOrganization.id,
          contact_ids: batch,
          provider,
        });
        const counts = (data?.counts ?? {}) as Partial<VerifyCounts>;
        for (const k of Object.keys(totals) as (keyof VerifyCounts)[]) {
          totals[k] += counts[k] ?? 0;
        }
        const checkedSoFar = Math.min(i + batchSize, total);
        backgroundTasks.update(taskId, {
          checked: checkedSoFar,
          extra: `${totals.valid} valid · ${totals.invalid + totals.disposable} bad`,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lead-list-members'] });
      // Refresh the "Email Verified" column badges, which read the
      // email_address_verifications cache via useEmailVerifications.
      queryClient.invalidateQueries({ queryKey: ['email-verifications'] });

      backgroundTasks.finish(taskId);

      if (cancelled) {
        toast.info(
          `Email verification cancelled (${totals.valid} valid, ${totals.invalid + totals.disposable} bad so far)`,
          { duration: 4000 },
        );
      } else {
        const bad = totals.invalid + totals.disposable;
        const risky = totals.risky + totals.unknown + totals.role + totals.catch_all;
        toast.success(
          `Verified ${total.toLocaleString()} contacts: ${totals.valid} valid, ${bad} bad, ${risky} risky.`,
          { duration: 5000 },
        );
      }
    } catch (err) {
      backgroundTasks.finish(taskId);
      toast.error(
        `Email verification failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        { duration: 4000 },
      );
    }
  };

  return { run };
}

// ----------------------------------------------------------------------------
// Mailtester async runner — kicks off a cron-driven job and lets the global
// useMailtesterJobProgressSync hook (mounted in AppLayout) drive the bar.
// Multiple concurrent verifications can be queued; the worker's org-level
// mutex ensures only one runs at a time per Mailtester API key.
// ----------------------------------------------------------------------------

async function runMailtesterAsync(args: {
  contactIds: string[];
  organizationId: string;
  queryClient: ReturnType<typeof useQueryClient>;
  listId?: string; // source list for job attribution
  useListShortcut?: boolean; // resolve the entire list server-side
}): Promise<void> {
  const { contactIds, organizationId, queryClient, listId, useListShortcut = false } = args;
  const inputCount = useListShortcut ? null : contactIds.length;

  // Multiple verifications can be queued at once — the worker's org-level
  // mutex (see try_claim_mailtester_job) ensures only one runs at a time
  // per Mailtester API key, so additional kickoffs land as 'queued' jobs
  // and process sequentially as the worker frees up.
  const { count: activeJobsCount } = await supabase
    .from('mailtester_verification_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .in('status', ['queued', 'running']);

  // 1. Kickoff — fast (heuristic + cache pre-pass)
  toast.success(
    useListShortcut
      ? `Mailtester Ninja: starting on the entire list…${(activeJobsCount ?? 0) > 0 ? ` (will queue behind ${activeJobsCount} active verification${activeJobsCount === 1 ? '' : 's'})` : ''}`
      : `Mailtester Ninja: starting on ${(inputCount ?? 0).toLocaleString()} selected contacts…${(activeJobsCount ?? 0) > 0 ? ` (will queue behind ${activeJobsCount} active verification${activeJobsCount === 1 ? '' : 's'})` : ''}`,
    { duration: 4000 },
  );

  const { data: kickoff, error: kickoffErr } = await supabase.functions.invoke(
    'mailtester-verify-kickoff',
    {
      body: useListShortcut
        ? { organization_id: organizationId, list_id: listId }
        : { organization_id: organizationId, contact_ids: contactIds, list_id: listId },
    },
  );

  if (kickoffErr || !kickoff?.success) {
    // supabase.functions.invoke wraps a non-2xx in a FunctionsHttpError whose
    // .message is the generic "Edge Function returned a non-2xx status code" —
    // the real reason is in the JSON body on error.context (a Response). Read
    // it so the toast shows the actual cause (e.g. missing API key, timeout).
    let serverError: string | undefined;
    const ctx = (kickoffErr as { context?: Response } | null)?.context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.clone().json();
        serverError = (body as { error?: string })?.error;
      } catch {
        /* body wasn't JSON — fall back to the generic message */
      }
    }
    toast.error(
      `Mailtester kickoff failed: ${serverError || kickoff?.error || kickoffErr?.message || 'Unknown error'}`,
      { duration: 5000 },
    );
    return;
  }

  const { job_id, total, pre_pass_resolved, queued } = kickoff as {
    job_id: string;
    total: number;
    pre_pass_resolved: number;
    queued: number;
    plan: string;
  };

  if (queued === 0) {
    toast.success(
      `Mailtester Ninja: ${total.toLocaleString()} contacts resolved instantly from heuristics + cache.`,
      { duration: 5000 },
    );
    queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
    queryClient.invalidateQueries({ queryKey: ['lead-list-members'] });
    // Instant-resolve writes verifications synchronously, but no async job is
    // registered, so the AppLayout poller never fires the email-verifications
    // invalidation. Refresh the column badges here.
    queryClient.invalidateQueries({ queryKey: ['email-verifications'] });
    return;
  }

  toast.info(
    `Mailtester Ninja: ${pre_pass_resolved.toLocaleString()} resolved instantly, ${queued.toLocaleString()} queued for the cron worker. Safe to close the tab — progress shows in the bottom bar.`,
    { duration: 8000 },
  );

  // The bar is driven by useMailtesterJobProgressSync (mounted in AppLayout),
  // which polls active jobs and registers them. Force an immediate refetch so
  // the bar appears within ~100ms instead of waiting for the next poll tick.
  void queryClient.invalidateQueries({ queryKey: ['mailtester-active-jobs'] });
  void queryClient.invalidateQueries({ queryKey: ['mailtester-ninja-status'] });
  // Touch the dependency so the unused-import lint doesn't strip job_id.
  void job_id;
}

// ============================================================================
// Mailtester Ninja status — for the verify-emails action modal
// ============================================================================

export type MailtesterNinjaPlan = 'starter' | 'pro' | 'ultimate';

export interface MailtesterNinjaStatus {
  isConnected: boolean;
  plan: MailtesterNinjaPlan | null;
  dailyCap: number | null;
  usedToday: number;
}

const MAILTESTER_DAILY_CAPS: Record<MailtesterNinjaPlan, number> = {
  starter: 50_000,
  pro: 100_000,
  ultimate: 500_000,
};

// ----------------------------------------------------------------------------
// Mailtester async job hooks
// ----------------------------------------------------------------------------

export type MailtesterJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface MailtesterJob {
  id: string;
  organization_id: string;
  list_id?: string | null;
  list_ids?: string[];
  plan: MailtesterNinjaPlan;
  total: number;
  pre_pass_resolved: number;
  processed: number;
  valid: number;
  invalid: number;
  catch_all: number;
  unknown: number;
  daily_limit_reached: boolean;
  status: MailtesterJobStatus;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_tick_at: string | null;
  pending_count: number; // derived from pending_emails length
}

/**
 * Watch a single Mailtester verification job. Polls every 5s while the job is
 * still queued/running so the progress bar updates as the cron worker drains it.
 */
export function useMailtesterJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: ['mailtester-job', jobId],
    queryFn: async (): Promise<MailtesterJob | null> => {
      if (!jobId) return null;
      const { data, error } = await supabase
        .from('mailtester_verification_jobs')
        .select('id, organization_id, plan, total, pre_pass_resolved, processed, valid, invalid, catch_all, unknown, daily_limit_reached, status, error, created_at, started_at, finished_at, last_tick_at, pending_emails')
        .eq('id', jobId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { pending_emails, ...rest } = data as unknown as MailtesterJob & { pending_emails: string[] };
      return { ...rest, pending_count: pending_emails?.length ?? 0 };
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data as MailtesterJob | null | undefined;
      if (!job) return 5_000;
      return job.status === 'queued' || job.status === 'running' ? 5_000 : false;
    },
  });
}

export function useCancelMailtesterJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('mailtester_verification_jobs')
        .update({ status: 'cancelled', pending_emails: [], finished_at: new Date().toISOString() })
        .eq('id', jobId)
        .in('status', ['queued', 'running']);
      if (error) throw error;
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ['mailtester-job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['mailtester-active-jobs'] });
    },
  });
}

/**
 * Watches every queued/running Mailtester job for the current org. Mounted at
 * the app shell layer so the progress bar shows up automatically after a page
 * reload or navigation, without needing the user to click Verify Emails again.
 */
export function useActiveMailtesterJobs() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ['mailtester-active-jobs', orgId],
    queryFn: async (): Promise<MailtesterJob[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('mailtester_verification_jobs')
        .select('id, organization_id, plan, total, pre_pass_resolved, processed, valid, invalid, catch_all, unknown, daily_limit_reached, status, error, created_at, started_at, finished_at, last_tick_at, list_id')
        .eq('organization_id', orgId)
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: true });
      if (error) throw error;

      const rows = (data ?? []) as Array<MailtesterJob & { list_id?: string | null }>;
      const jobIds = rows.map((row) => row.id);
      const listIdsByJobId = new Map<string, string[]>();

      if (jobIds.length > 0) {
        const { data: jobLists, error: jobListsError } = await supabase
          .from('mailtester_job_lists')
          .select('job_id, list_id')
          .in('job_id', jobIds);

        if (!jobListsError) {
          for (const row of (jobLists ?? []) as Array<{ job_id: string; list_id: string }>) {
            const existing = listIdsByJobId.get(row.job_id) ?? [];
            existing.push(row.list_id);
            listIdsByJobId.set(row.job_id, existing);
          }
        }
      }

      return rows.map((row) => {
        const r = row as unknown as MailtesterJob;
        const listIds = new Set<string>(listIdsByJobId.get(r.id) ?? []);
        if (r.list_id) listIds.add(r.list_id);
        return {
          ...r,
          list_ids: Array.from(listIds),
          pending_count: Math.max(0, r.total - r.processed),
        };
      });
    },
    enabled: !!orgId,
    refetchInterval: 4_000,
    staleTime: 0,
  });
}

/**
 * Watches recently-FAILED Mailtester jobs for the current org (last 24h). The
 * common failure is a disabled/invalid API key: Mailtester answers HTTP 200
 * with "Disabled Key" for every address, so the job ends with everything
 * `unknown`. The worker now flags those as auth failures and marks the job
 * failed with an actionable `error` — this hook surfaces that in the banner so
 * the user knows to fix their key instead of staring at all-unknown results.
 */
export function useRecentFailedMailtesterJobs() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ['mailtester-failed-jobs', orgId],
    queryFn: async (): Promise<MailtesterJob[]> => {
      if (!orgId) return [];
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('mailtester_verification_jobs')
        .select('id, organization_id, plan, total, pre_pass_resolved, processed, valid, invalid, catch_all, unknown, daily_limit_reached, status, error, created_at, started_at, finished_at, last_tick_at, list_id')
        .eq('organization_id', orgId)
        .eq('status', 'failed')
        .gte('finished_at', since)
        .order('finished_at', { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as Array<MailtesterJob & { list_id?: string | null }>;
      const jobIds = rows.map((row) => row.id);
      const listIdsByJobId = new Map<string, string[]>();

      if (jobIds.length > 0) {
        const { data: jobLists, error: jobListsError } = await supabase
          .from('mailtester_job_lists')
          .select('job_id, list_id')
          .in('job_id', jobIds);
        if (!jobListsError) {
          for (const row of (jobLists ?? []) as Array<{ job_id: string; list_id: string }>) {
            const existing = listIdsByJobId.get(row.job_id) ?? [];
            existing.push(row.list_id);
            listIdsByJobId.set(row.job_id, existing);
          }
        }
      }

      return rows.map((row) => {
        const r = row as unknown as MailtesterJob;
        const listIds = new Set<string>(listIdsByJobId.get(r.id) ?? []);
        if (r.list_id) listIds.add(r.list_id);
        return {
          ...r,
          list_ids: Array.from(listIds),
          pending_count: Math.max(0, r.total - r.processed),
        };
      });
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
    staleTime: 0,
  });
}

/**
 * Reads whether the org has a valid Mailtester Ninja key, what plan it's on,
 * and how many verifications it's already used today (UTC). Used by the
 * Verify Emails dialog to show the option, the cap, and remaining quota.
 */
export function useMailtesterNinjaStatus() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useQuery({
    queryKey: ['mailtester-ninja-status', orgId],
    queryFn: async (): Promise<MailtesterNinjaStatus> => {
      if (!orgId) {
        return { isConnected: false, plan: null, dailyCap: null, usedToday: 0 };
      }

      const { data: keyRow } = await supabase
        .from('api_keys')
        .select('id, metadata, is_valid')
        .eq('organization_id', orgId)
        .eq('provider', 'mailtester_ninja')
        .maybeSingle();

      if (!keyRow || !keyRow.is_valid) {
        return { isConnected: false, plan: null, dailyCap: null, usedToday: 0 };
      }

      const metadataPlan = (keyRow.metadata as Record<string, unknown> | null)?.plan;
      const plan: MailtesterNinjaPlan =
        metadataPlan === 'starter' || metadataPlan === 'pro' || metadataPlan === 'ultimate'
          ? metadataPlan
          : 'pro';

      // Count today's Mailtester verifications (UTC day boundary), excluding
      // timeout rows — a timeout returned no result, so it isn't a billable
      // call and must not consume the daily budget.
      const startUtc = new Date();
      startUtc.setUTCHours(0, 0, 0, 0);
      const startIso = startUtc.toISOString();
      const [{ count: total }, { count: timeouts }] = await Promise.all([
        supabase
          .from('email_address_verifications')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('provider', 'mailtester_ninja')
          .gte('verified_at', startIso),
        supabase
          .from('email_address_verifications')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('provider', 'mailtester_ninja')
          .gte('verified_at', startIso)
          .eq('raw_response->>reason', 'timeout'),
      ]);

      return {
        isConnected: true,
        plan,
        dailyCap: MAILTESTER_DAILY_CAPS[plan],
        usedToday: Math.max(0, (total ?? 0) - (timeouts ?? 0)),
      };
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

export function useDownloadMailtesterRawJson() {
  return useMutation({
    mutationFn: async (input: { listId?: string; verifiedAfter?: string; verifiedBefore?: string }) => {
      const { data, error } = await supabase.functions.invoke('mailtester-raw-export', {
        body: {
          list_id: input.listId,
          verified_after: input.verifiedAfter,
          verified_before: input.verifiedBefore,
        },
      });

      if (error) throw error;
      if (!data) throw new Error('No Mailtester export data returned');
      if (data.success === false) throw new Error(data.error || 'Failed to export Mailtester raw JSON');

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `mailtester-raw-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      return data as { total_records?: number };
    },
    onSuccess: (data) => {
      toast.success(`Downloaded ${Number(data.total_records ?? 0).toLocaleString()} Mailtester raw result${data.total_records === 1 ? '' : 's'}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to download Mailtester raw JSON');
    },
  });
}

/**
 * Batch-load cached SEG detection results for a set of email domains.
 * Reads directly from domain_seg_cache (no DNS lookups — only cached results).
 * Returns a Map<domain, segProvider>.
 */
/**
 * Batch-load cached email verification statuses for a set of email addresses.
 * Reads directly from email_address_verifications (no provider calls — only
 * what's already in the 30-day cache). Returns a Map<email_lower, status>.
 *
 * Used by the lead list table to render a per-row "Email Verified" badge
 * after a Verify Emails run completes.
 */
export type EmailVerificationStatus =
  | "valid"
  | "invalid"
  | "risky"
  | "catch_all"
  | "disposable"
  | "role"
  | "unknown";

export interface EmailVerificationInfo {
  status: EmailVerificationStatus;
  provider: string;
  verified_at: string;
}

export function useEmailVerifications(emails: string[]) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  // Normalize once and dedupe so the queryKey is stable across rerenders.
  const lowered = Array.from(
    new Set(emails.map((e) => e?.trim().toLowerCase()).filter(Boolean)),
  ).sort();

  return useQuery({
    queryKey: ["email-verifications", orgId, lowered],
    queryFn: async (): Promise<Map<string, EmailVerificationInfo>> => {
      if (!orgId || lowered.length === 0) return new Map();

      // Chunk to stay clear of Postgres parameter limits on large pages.
      const map = new Map<string, EmailVerificationInfo>();
      for (let i = 0; i < lowered.length; i += 500) {
        const slice = lowered.slice(i, i + 500);
        const { data, error } = await supabase
          .from("email_address_verifications")
          .select("email_lower, status, provider, verified_at")
          .eq("organization_id", orgId)
          .in("email_lower", slice);
        if (error) {
          console.error("Failed to load email verifications:", error);
          continue;
        }
        for (const row of (data ?? []) as Array<{
          email_lower: string;
          status: string;
          provider: string;
          verified_at: string;
        }>) {
          map.set(row.email_lower, {
            status: row.status as EmailVerificationStatus,
            provider: row.provider,
            verified_at: row.verified_at,
          });
        }
      }
      return map;
    },
    enabled: !!orgId && lowered.length > 0,
    staleTime: 60_000,
    // Verify Emails runs async (mailtester cron worker) and writes rows to
    // email_address_verifications after the page has already loaded. Live
    // invalidation only fires if the AppLayout poller happened to watch that
    // job go active→done in this same session — a job that finished while the
    // tab was elsewhere (or before a reload) is never picked up. Always
    // refetch on mount so navigating to / reloading the list surfaces
    // completed verifications regardless of whether the poller saw them.
    refetchOnMount: 'always',
  });
}

export function useDomainSEGCache(domains: string[]) {
  return useQuery({
    queryKey: ['domain-seg-cache', domains],
    queryFn: async (): Promise<Map<string, string>> => {
      if (domains.length === 0) return new Map();

      const { data, error } = await supabase
        .from('domain_seg_cache')
        .select('domain, has_seg, seg_provider')
        .in('domain', domains)
        .eq('has_seg', true);

      if (error) {
        console.error('Failed to load domain SEG cache:', error);
        return new Map();
      }

      const map = new Map<string, string>();
      for (const row of data || []) {
        if (row.seg_provider) {
          map.set(row.domain, row.seg_provider);
        }
      }
      return map;
    },
    enabled: domains.length > 0,
    staleTime: 5 * 60_000,
  });
}
