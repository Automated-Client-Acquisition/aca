import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { chunkedIn } from "@/hooks/crm/useContacts";

export type SegmentRuleField =
  | 'source' | 'status' | 'tag' | 'lead_score' | 'has_email' | 'has_linkedin' | 'country' | 'city' | 'custom_field' | 'signal'
  | 'company_employee_count' | 'company_size'
  | 'pipeline_id' | 'stage_id' | 'owner_user_id' | 'created_days_ago' | 'activity_days_ago'
  | 'icp_score' | 'dm_score' | 'custom_question'
  | 'industry' | 'seniority' | 'department' | 'technology' | 'detected_technology' | 'revenue_model'
  | 'is_b2b' | 'has_outbound_motion' | 'hiring_sales_roles' | 'runs_ads'
  | 'email_quality' | 'email_type' | 'min_email_confidence' | 'email_verified'
  | 'has_enrichment_data' | 'has_notion_url' | 'seg_firewall' | 'ai_analysis_status';
export type SegmentRuleOperator = 'is' | 'is_not' | 'has_any' | 'has_all' | 'has_none' | 'in' | 'not_in' | 'gte' | 'lte' | 'within' | 'exists' | 'not_exists' | 'equals' | 'contains' | 'is_empty';
export interface SegmentRule {
  id: string;
  field: SegmentRuleField;
  operator: SegmentRuleOperator;
  value?: string | number | boolean | string[];
  fieldKey?: string;
}
export interface SegmentRuleGroup {
  id: string;
  operator: 'and' | 'or';
  rules: Array<SegmentRule | SegmentRuleGroup>;
}

// Smart list filter criteria - matches the JSONB structure in the database
export interface SmartListFilterCriteria {
  /** v2 nested rules. Flat fields below remain supported for existing lists. */
  rule_group?: SegmentRuleGroup;
  // Source filtering
  source?: "linkedin_connection" | "linkedin_comment" | "instagram_comment" | "manual" | "import";
  // Status filtering
  status?: "active" | "archived" | "bounced" | "unsubscribed" | "do_not_contact";
  // Tags (ANY match)
  tags?: string[];
  // Lead score range
  min_score?: number;
  max_score?: number;
  // Pipeline/stage
  pipeline_id?: string;
  stage_id?: string;
  // Owner
  owner_user_id?: string;
  // Date filters (relative days)
  created_days_ago?: number;
  activity_days_ago?: number;
  // Boolean flags
  has_email?: boolean;
  has_linkedin?: boolean;
  // Enrichment filters
  industries?: string[];
  /** @deprecated Exact legacy enrichment_data.company.size labels. */
  company_sizes?: string[];
  min_employee_count?: number;
  max_employee_count?: number;
  seniorities?: string[];
  departments?: string[];
  technologies?: string[];
  email_verified?: boolean;
  min_email_confidence?: number;
  countries?: string[];
  cities?: string[];
  has_enrichment_data?: boolean;
  // ICP Score filters (per-product)
  icp_product_id?: string;
  min_icp_score?: number;
  max_icp_score?: number;
  // Decision-maker score (per-product; requires icp_product_id)
  min_dm_score?: number;
  max_dm_score?: number;
  // Email quality/type
  email_quality?: Array<'clean' | 'risky' | 'failed' | 'unverified'>;
  email_type?: 'business' | 'personal';
  // Qualification
  is_b2b?: boolean;
  revenue_models?: string[];
  has_outbound_motion?: boolean;
  hiring_sales_roles?: boolean;
  // Website/ad signals (detected_technologies)
  runs_ads?: boolean;
  detected_technologies?: string[];
  detected_tech_match_all?: boolean;
  excluded_technologies?: string[];
  // Custom AI questions (AND-combined)
  custom_questions?: Array<{ question: string; minScore?: number }>;
  // Org custom fields (AND-combined)
  custom_field_conditions?: Array<{
    fieldKey: string;
    operator: 'equals' | 'contains' | 'has_value' | 'is_empty';
    value?: string;
  }>;
  // Data presence / firewall / AI-analysis status
  has_notion_url?: boolean;
  seg_firewall?: 'behind' | 'clear' | 'unchecked';
  ai_analysis_status?: 'not_analyzed' | 'analyzing' | 'analyzed' | 'failed' | 'no_data';
  // Discovery / Signal filters — populated by signal-created smart lists.
  // When present, surfaces the {{ai_signal_*}} variable callout in the
  // campaign builder so users know they can reference signal context.
  signal_subscription_id?: string;
  signal_types?: string[];
  signal_max_age_days?: number;
  min_discovery_score?: number;
}

export interface LeadList {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  source_type:
    | "manual"
    | "csv"
    | "linkedin_search"
    | "event"
    | "post_reactors"
    | "smart"
    | "apify_leads_finder"
    | "signal"
    | "discovery_pack";
  source_config: Record<string, unknown>;
  lead_count: number;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // Smart list fields
  is_smart: boolean;
  filter_criteria: SmartListFilterCriteria | null;
  last_computed_at: string | null;
}

/**
 * A "living" list keeps gaining members after it's attached to a campaign or
 * sequence — smart (filter-based) lists that recompute continuously, and lists
 * fed by an external/signal source that a poller tops up. For these, auto-
 * enrolling newly-added members is the expected default ("this list is a pipe").
 *
 * Fixed-cohort lists (manual, csv, and one-time imports like linkedin_search or
 * event) are a snapshot — attaching one means "contact who's in it now", not
 * "keep topping up forever" — so auto-enroll defaults off for those.
 *
 * Used to derive the default for auto_enroll_new_members when a list is attached
 * in the campaign builder and the email sequence builder. It's only a default —
 * the user can always override the toggle.
 */
const LIVING_LIST_SOURCE_TYPES: ReadonlyArray<LeadList["source_type"]> = [
  "post_reactors",
  "apify_leads_finder",
  "signal",
  "discovery_pack",
];

export function isLivingLeadList(
  list: Pick<LeadList, "is_smart" | "source_type"> | null | undefined
): boolean {
  if (!list) return false;
  if (list.is_smart) return true;
  return LIVING_LIST_SOURCE_TYPES.includes(list.source_type);
}

export interface CreateLeadListInput {
  name: string;
  description?: string;
  source_type?: LeadList["source_type"];
  source_config?: Record<string, unknown>;
}

export interface UpdateLeadListInput {
  id: string;
  name?: string;
  description?: string;
  status?: LeadList["status"];
}

export function useLeadLists(enabled = true) {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  const { data: leadLists, isLoading, error } = useQuery({
    queryKey: ["lead-lists", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_lists")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as LeadList[];
    },
    enabled: enabled && !!currentOrganization,
  });

  return {
    leadLists: leadLists || [],
    isLoading,
    error,
  };
}

export function useLeadList(id: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-lists", currentOrganization?.id, id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("lead_lists")
        .select("*")
        .eq("id", id)
        .eq("organization_id", currentOrganization!.id)
        .single();

      if (error) throw error;
      return data as LeadList;
    },
    enabled: !!id && !!currentOrganization,
  });
}

export function useCreateLeadList() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateLeadListInput) => {
      if (!currentOrganization) {
        throw new Error("No organization selected");
      }

      const { data, error } = await supabase
        .from("lead_lists")
        .insert([{
          organization_id: currentOrganization.id,
          name: input.name,
          description: input.description || null,
          source_type: input.source_type || "manual",
          source_config: input.source_config || {},
        }])
        .select()
        .single();

      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      toast.success("Lead list created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create lead list: ${error.message}`);
    },
  });
}

export function useUpdateLeadList() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: UpdateLeadListInput) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { id, ...updates } = input;
      const { data, error } = await supabase
        .from("lead_lists")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      queryClient.invalidateQueries({ queryKey: ["lead-lists", data.id] });
      toast.success("Lead list updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update lead list: ${error.message}`);
    },
  });
}

export function useDeleteLeadList() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("lead_lists")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      toast.success("Lead list deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete lead list: ${error.message}`);
    },
  });
}

export function useBulkDeleteLeadLists() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("lead_lists")
        .delete()
        .in("id", ids)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: (_data, ids) => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      toast.success(`${ids.length} lead list${ids.length === 1 ? "" : "s"} deleted successfully`);
    },
    onError: (error) => {
      toast.error(`Failed to delete lead lists: ${error.message}`);
    },
  });
}

export interface MergeLeadListsInput {
  sourceListIds: string[];
  targetListId: string;
  archiveSourceLists?: boolean;
}

export function useMergeLeadLists() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ sourceListIds, targetListId, archiveSourceLists }: MergeLeadListsInput) => {
      if (!currentOrganization) throw new Error("No organization selected");

      const { data, error } = await supabase.rpc("merge_lead_lists", {
        p_source_list_ids: sourceListIds,
        p_target_list_id: targetListId,
      });

      if (error) throw error;

      if (archiveSourceLists) {
        const idsToArchive = sourceListIds.filter((id) => id !== targetListId);
        if (idsToArchive.length > 0) {
          const { error: archiveError } = await supabase
            .from("lead_lists")
            .update({ status: "archived" })
            .in("id", idsToArchive)
            .eq("organization_id", currentOrganization.id);

          if (archiveError) throw archiveError;
        }
      }

      return { addedCount: data as number, targetListId };
    },
    onSuccess: ({ addedCount }) => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      toast.success(`Merged lists — ${addedCount} contact${addedCount === 1 ? "" : "s"} added`);
    },
    onError: (error) => {
      toast.error(`Failed to merge lists: ${error.message}`);
    },
  });
}

export function useArchiveLeadList() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from("lead_lists")
        .update({ status: "archived" })
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      queryClient.invalidateQueries({ queryKey: ["lead-lists", data.id] });
      toast.success("Lead list archived");
    },
    onError: (error) => {
      toast.error(`Failed to archive lead list: ${error.message}`);
    },
  });
}

// ============================================================================
// Smart List Hooks
// ============================================================================

export interface CreateSmartListInput {
  name: string;
  description?: string;
  filter_criteria: SmartListFilterCriteria;
}

export interface UpdateSmartListInput {
  id: string;
  name?: string;
  description?: string;
  filter_criteria?: SmartListFilterCriteria;
}

/**
 * Create a new smart list with dynamic filter criteria
 */
export function useCreateSmartList() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateSmartListInput) => {
      if (!currentOrganization) {
        throw new Error("No organization selected");
      }

      // Insert the smart list
      const { data, error } = await supabase
        .from("lead_lists")
        .insert([{
          organization_id: currentOrganization.id,
          name: input.name,
          description: input.description || null,
          source_type: "smart",
          source_config: {},
          is_smart: true,
          filter_criteria: input.filter_criteria,
          lead_count: 0, // Will be computed by RPC
        }])
        .select()
        .single();

      if (error) throw error;

      // Compute the initial count using the RPC function
      const { error: rpcError } = await supabase.rpc("compute_smart_list_count", {
        p_list_id: data.id,
      });

      if (rpcError) {
        console.error("Failed to compute smart list count:", rpcError);
        // Don't throw - the list was created, count can be refreshed later
      }

      // Refetch the list to get the updated count
      const { data: refreshedData } = await supabase
        .from("lead_lists")
        .select("*")
        .eq("id", data.id)
        .eq("organization_id", currentOrganization.id)
        .single();

      return (refreshedData || data) as LeadList;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      toast.success("Smart segment created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create smart segment: ${error.message}`);
    },
  });
}

/**
 * Update a smart list's filter criteria
 */
export function useUpdateSmartList() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: UpdateSmartListInput) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { id, ...updates } = input;

      // Update the smart list
      const { data, error } = await supabase
        .from("lead_lists")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;

      // If filter_criteria was updated, recompute the count
      if (updates.filter_criteria) {
        const { error: rpcError } = await supabase.rpc("compute_smart_list_count", {
          p_list_id: id,
        });

        if (rpcError) {
          console.error("Failed to compute smart list count:", rpcError);
        }

        // Refetch to get updated count
        const { data: refreshedData } = await supabase
          .from("lead_lists")
          .select("*")
          .eq("id", id)
          .eq("organization_id", currentOrganization.id)
          .single();

        return (refreshedData || data) as LeadList;
      }

      return data as LeadList;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      queryClient.invalidateQueries({ queryKey: ["lead-lists", data.id] });
      queryClient.invalidateQueries({ queryKey: ["smart-list-contacts", data.id] });
      toast.success("Smart segment updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update smart segment: ${error.message}`);
    },
  });
}

/**
 * Refresh a smart list's count by recomputing from filter criteria
 */
export function useRefreshSmartListCount() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (listId: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error: listError } = await supabase.from("lead_lists")
        .select("id").eq("id", listId).eq("organization_id", currentOrganization.id).single();
      if (listError) throw listError;
      const { data, error } = await supabase.rpc("compute_smart_list_count", {
        p_list_id: listId,
      });

      if (error) throw error;
      return data as number;
    },
    onSuccess: (_, listId) => {
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
      queryClient.invalidateQueries({ queryKey: ["lead-lists", listId] });
      queryClient.invalidateQueries({ queryKey: ["smart-list-contacts", listId] });
      toast.success("Smart segment count refreshed");
    },
    onError: (error) => {
      toast.error(`Failed to refresh count: ${error.message}`);
    },
  });
}

/**
 * Get preview count for smart list criteria (without saving)
 */
export function useSmartListPreviewCount(criteria: SmartListFilterCriteria | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["smart-list-preview", currentOrganization?.id, criteria],
    queryFn: async () => {
      if (!currentOrganization || !criteria) return 0;

      // Evaluate against the SAME server-side predicate core that computes
      // real membership (smart_list_eligible_contacts_for_criteria), so the
      // preview count always matches the saved list — and every Advanced
      // Filters field is supported, not a hand-maintained subset.
      const { data, error } = await supabase.rpc("smart_list_preview_count", {
        p_org_id: currentOrganization.id,
        p_criteria: criteria as unknown as Json,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    enabled: !!currentOrganization && !!criteria && Object.keys(criteria).length > 0,
    staleTime: 5000, // Cache for 5 seconds to avoid excessive queries
  });
}

// ============================================================================
// Contact List Membership Hooks
// ============================================================================

export interface ContactListMembership {
  list_id: string;
  list_name: string;
  is_smart: boolean;
}

/**
 * Fetch all list memberships for a set of contact IDs
 * Returns a map of contact_id -> list memberships
 */
export function useContactListMemberships(contactIds: string[]) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["contact-list-memberships", currentOrganization?.id, contactIds],
    queryFn: async () => {
      if (contactIds.length === 0) return {};

      // Fetch list memberships with list details
      // Note: is_smart column may not exist in all environments, use source_type instead
      const data = await chunkedIn(contactIds, (chunk) =>
        supabase
          .from("lead_list_members")
          .select(`
            contact_id,
            list:lead_lists(id, name, source_type)
          `)
          .in("contact_id", chunk)
      );

      // Group by contact_id
      const membershipMap: Record<string, ContactListMembership[]> = {};

      for (const row of data) {
        const contactId = row.contact_id;
        const list = row.list as { id: string; name: string; source_type: string } | null;

        if (!list) continue;

        if (!membershipMap[contactId]) {
          membershipMap[contactId] = [];
        }

        membershipMap[contactId].push({
          list_id: list.id,
          list_name: list.name,
          is_smart: list.source_type === 'smart',
        });
      }

      return membershipMap;
    },
    enabled: !!currentOrganization && contactIds.length > 0,
    staleTime: 30000, // Cache for 30 seconds
  });
}
