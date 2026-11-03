import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { CrmContact } from "@/hooks/crm/useContacts";
import { attachLeadList, detachLeadList } from "@/lib/lead-list-attach";

export type PackTier = "signal" | "trade" | "pro_services";
export type PackStatus = "active" | "paused" | "cancelled" | "deleted";
export type RefreshCadence = "daily" | "weekly" | "monthly" | "custom";

/**
 * Decision-maker filter that lives inside pack_subscriptions.config.dm_filter.
 * Mirrors harvestapi/linkedin-company-employees actor inputs so the wizard
 * can pass them through verbatim. The dm-scraper edge function reads this
 * shape; missing keys fall back to senior-only defaults.
 *
 * - seniorityLevelIds: harvestapi codes — 220 Director, 300 VP, 310 CXO,
 *   320 Owner/Partner. Optional lower tiers: 100 In Training, 110 Entry,
 *   120 Senior, 130 Strategic, 200 Entry Mgr, 210 Experienced Mgr.
 * - functionIds: harvestapi codes — 25 Sales, 15 Marketing, 4 Biz Dev, etc.
 * - jobTitles: free-text strings for fuzzy matching ("CEO", "Head of Sales").
 * - maxItemsPerCompany: per-company cap (default 5, range 1-25). Each result
 *   costs $0.012 in Full+email mode.
 * - profileScraperMode: "Full + email search ($12 per 1k)" returns name +
 *   title + verified email per profile. Use "Short ($4 per 1k)" only for
 *   budget-tight subs that don't need email.
 */
export interface DmFilter {
  seniorityLevelIds: string[];
  functionIds: string[];
  jobTitles: string[];
  maxItemsPerCompany: number;
  profileScraperMode: string;
}

export const DM_FILTER_DEFAULT: DmFilter = {
  seniorityLevelIds: ["220", "300", "310", "320"],
  functionIds: [],
  jobTitles: [],
  maxItemsPerCompany: 5,
  profileScraperMode: "Full + email search ($12 per 1k)",
};

/**
 * harvestapi seniorityLevelIds catalog. Keys are the actor's exact ID strings;
 * labels are human-friendly. Order matches what the wizard renders.
 */
export const DM_FILTER_SENIORITY_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "320", label: "Owner / Partner" },
  { id: "310", label: "CXO" },
  { id: "300", label: "Vice President" },
  { id: "220", label: "Director" },
  { id: "210", label: "Experienced Manager" },
  { id: "200", label: "Entry Manager" },
  { id: "130", label: "Strategic IC" },
  { id: "120", label: "Senior IC" },
  { id: "110", label: "Entry IC" },
  { id: "100", label: "In Training" },
];

/**
 * harvestapi functionIds catalog. Common ones first, "more" reveal in UI.
 */
export const DM_FILTER_FUNCTION_OPTIONS: Array<{ id: string; label: string; common?: boolean }> = [
  { id: "25", label: "Sales", common: true },
  { id: "15", label: "Marketing", common: true },
  { id: "4", label: "Business Development", common: true },
  { id: "19", label: "Product Management", common: true },
  { id: "8", label: "Engineering", common: true },
  { id: "10", label: "Finance", common: true },
  { id: "12", label: "Human Resources", common: true },
  { id: "13", label: "Information Technology" },
  { id: "21", label: "Operations" },
  { id: "5", label: "Consulting" },
  { id: "16", label: "Media & Communication" },
  { id: "20", label: "Project Management" },
  { id: "17", label: "Military & Protective Services" },
  { id: "23", label: "Quality Assurance" },
  { id: "1", label: "Accounting" },
  { id: "2", label: "Administrative" },
  { id: "3", label: "Arts & Design" },
  { id: "6", label: "Education" },
  { id: "7", label: "Entrepreneurship" },
  { id: "9", label: "Finance" },
  { id: "11", label: "Healthcare Services" },
  { id: "14", label: "Legal" },
  { id: "18", label: "Operations" },
  { id: "22", label: "Purchasing" },
  { id: "24", label: "Research" },
];

export interface PackSubscription {
  id: string;
  organization_id: string;
  pack_key: string;
  tier: PackTier;
  status: PackStatus;
  config: Record<string, unknown>;
  lead_list_id: string | null;
  refresh_cadence: RefreshCadence;
  /** Required when refresh_cadence='custom'. Min 60 (1h). */
  refresh_interval_minutes: number | null;
  next_refresh_at: string;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
  name: string | null;
  icp_id: string | null;
  icp_product_id: string | null;
  min_icp_score: number | null;
  review_band: number | null;
  daily_cap: number | null;
  weekly_cap: number | null;
  destination_type: "campaign" | "sequence" | "holding" | null;
  destination_id: string | null;
  smart_list_id: string | null;
  deleted_at: string | null;
}

export interface PackRefreshJob {
  id: string;
  subscription_id: string;
  organization_id: string;
  list_building_job_id: string | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  contacts_added: number;
  contacts_skipped: number;
  errors: unknown[];
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

/**
 * Static signal catalog. Each entry starts with a SignalBase event feed, then
 * routes matching companies through website resolution, DM discovery, email
 * verification, CRM upsert, smart-list membership, and outreach enrollment.
 */
export interface PackCatalogEntry {
  key: string;
  tier: PackTier;
  label: string;
  description: string;
  defaultCadence: RefreshCadence;
  sources: string[];
  /** Private BYOK dependency; public Hermes signals never use this provider. */
  requiresProvider?: "apify";
}

export const PACK_CATALOG: PackCatalogEntry[] = [
  {
    key: "just_funded_saas",
    tier: "signal",
    label: "Just-Funded SaaS",
    description:
      "Private funding discovery from SignalBase. Connect your own Apify key; ACA keeps the source article, round, amount, investors, company website, decision maker, verified email, and outreach context.",
    defaultCadence: "daily",
    sources: ["SignalBase via your Apify key"],
    requiresProvider: "apify",
  },
  {
    key: "aggressive_hiring",
    tier: "signal",
    label: "Aggressive Hiring",
    description:
      "Private hiring discovery from SignalBase. Your Apify key funds the source; ACA uses job context to find the company site, decision makers, verified emails, and outreach angle.",
    defaultCadence: "weekly",
    sources: ["SignalBase via your Apify key"],
    requiresProvider: "apify",
  },
  {
    key: "new_leadership",
    tier: "signal",
    label: "New Leadership",
    description:
      "Private executive-change discovery from SignalBase. Your Apify key funds the source; ACA verifies the company and preserves the role-change context.",
    defaultCadence: "weekly",
    sources: ["SignalBase via your Apify key"],
    requiresProvider: "apify",
  },
  {
    key: "recent_acquisitions",
    tier: "signal",
    label: "Recent Acquisitions",
    description:
      "Private M&A discovery from SignalBase. Your Apify key funds the source; ACA keeps evidence and acquisition context before routing the account into contact discovery.",
    defaultCadence: "weekly",
    sources: ["SignalBase via your Apify key"],
    requiresProvider: "apify",
  },
  {
    key: "unipile_inbound",
    tier: "signal",
    label: "LinkedIn Inbound",
    description:
      "New followers, fresh connections, post engagers, and pending invites who aren't in your CRM yet — pulled live from your LinkedIn account. Real-time via webhook, no credits used.",
    defaultCadence: "daily",
    sources: ["Your connected LinkedIn account: followers, relations, post reactors, pending invites"],
  },
  {
    key: "linkedin_post_engagement",
    tier: "signal",
    label: "Competitor & Creator Monitor",
    description:
      "List the LinkedIn profiles you want to watch — competitors, thought leaders, customers, your own. Each refresh, your connected LinkedIn account auto-scans their recent posts and surfaces every reactor and commenter. No per-result fees. (Specific post URLs are supported too for one-off captures.)",
    defaultCadence: "weekly",
    sources: ["Your connected LinkedIn account (via Unipile): /users/{id}/posts, /posts/{id}/reactions, /posts/{id}/comments"],
  },
  {
    key: "linkedin_post_intent",
    tier: "signal",
    label: "LinkedIn Topic Intent",
    description:
      "Keyword search across recent LinkedIn posts — finds individuals posting publicly about pain points you solve. ~$0.005 per matched post.",
    defaultCadence: "weekly",
    sources: ["harvestapi/linkedin-post-search"],
  },
];

export function getPackCatalog(): PackCatalogEntry[] {
  return PACK_CATALOG;
}

export function findPackInCatalog(key: string): PackCatalogEntry | undefined {
  return PACK_CATALOG.find((p) => p.key === key);
}

export function usePackSubscriptions() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["pack_subscriptions", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pack_subscriptions")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PackSubscription[];
    },
  });
}

export function usePackSubscription(subscriptionId: string | null | undefined) {
  return useQuery({
    queryKey: ["pack_subscription", subscriptionId],
    enabled: !!subscriptionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pack_subscriptions")
        .select("*")
        .eq("id", subscriptionId!)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data as PackSubscription | null;
    },
  });
}

export function usePackRefreshJobs(subscriptionId: string | null | undefined, limit = 25) {
  return useQuery({
    queryKey: ["pack_refresh_jobs", subscriptionId, limit],
    enabled: !!subscriptionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pack_refresh_jobs")
        .select("*")
        .eq("subscription_id", subscriptionId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as PackRefreshJob[];
    },
  });
}

export interface CreateSubscriptionInput {
  pack_key: string;
  tier: PackTier;
  config: Record<string, unknown>;
  refresh_cadence: RefreshCadence;
  lead_list_id?: string | null;
}

export function useCreatePackSubscription() {
  const qc = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateSubscriptionInput) => {
      if (!currentOrganization) throw new Error("No organization");

      // Auto-create a lead_list for the subscription if one wasn't supplied
      let leadListId = input.lead_list_id ?? null;
      if (!leadListId) {
        const pack = findPackInCatalog(input.pack_key);
        const { data: list, error: listErr } = await supabase
          .from("lead_lists")
          .insert({
            organization_id: currentOrganization.id,
            name: `${pack?.label ?? input.pack_key} — Discovery`,
            description: `Auto-managed list for the ${pack?.label ?? input.pack_key} pack.`,
            source_type: "discovery_pack",
            source_config: { pack_key: input.pack_key },
          })
          .select("id")
          .single();
        if (listErr) throw listErr;
        leadListId = (list as { id: string }).id;
      }

      const { data, error } = await supabase
        .from("pack_subscriptions")
        .insert({
          organization_id: currentOrganization.id,
          pack_key: input.pack_key,
          tier: input.tier,
          status: "active",
          config: input.config,
          refresh_cadence: input.refresh_cadence,
          lead_list_id: leadListId,
          next_refresh_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          const pack = findPackInCatalog(input.pack_key);
          throw new Error(
            `You already have a "${pack?.label ?? input.pack_key}" subscription. Edit the existing one or delete it first.`,
          );
        }
        throw error;
      }
      return data as PackSubscription;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pack_subscriptions"] });
      toast.success("Pack subscription created");
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Subscription failed";
      toast.error(msg);
    },
  });
}

export function useUpdatePackSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { id: string } & Partial<Pick<PackSubscription, "status" | "config" | "refresh_cadence">>,
    ) => {
      const { id, ...patch } = input;
      const { data, error } = await supabase
        .from("pack_subscriptions")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data as PackSubscription;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pack_subscriptions"] });
      qc.invalidateQueries({ queryKey: ["pack_subscription"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Update failed");
    },
  });
}

/**
 * Edit an existing signal. Updates name, ICP, scoring band, caps, cadence,
 * and the SignalBase trigger config. Pack key + tier are immutable (changing
 * them would change the underlying data type). Smart-list filter is updated
 * if min_icp_score moves so the dynamic list stays consistent with the new
 * threshold.
 */
export interface UpdateSignalInput {
  id: string;
  name?: string | null;
  icp_id?: string | null;
  config?: Record<string, unknown>;
  refresh_cadence?: RefreshCadence;
  /** Required when refresh_cadence='custom'. Min 60. */
  refresh_interval_minutes?: number | null;
  min_icp_score?: number;
  review_band?: number;
  daily_cap?: number;
  weekly_cap?: number;
  destination_type?: "campaign" | "sequence" | "holding" | null;
  destination_id?: string | null;
}

export function useUpdateSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSignalInput) => {
      const { id, ...patch } = input;
      const filteredPatch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) filteredPatch[k] = v;
      }
      // If switching off custom cadence, null out the interval explicitly
      // so the partial unique check (cadence='custom' ↔ interval set) holds.
      if (input.refresh_cadence !== undefined && input.refresh_cadence !== "custom") {
        filteredPatch.refresh_interval_minutes = null;
      }
      const { data, error } = await supabase
        .from("pack_subscriptions")
        .update(filteredPatch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      const updated = data as PackSubscription;

      // If min_icp_score moved, keep the smart list filter in sync so the
      // dynamic list reflects the new threshold.
      if (input.min_icp_score !== undefined && updated.smart_list_id) {
        const { data: smart } = await supabase
          .from("lead_lists")
          .select("filter_criteria")
          .eq("id", updated.smart_list_id)
          .maybeSingle();
        const fc = (smart as { filter_criteria?: Record<string, unknown> } | null)?.filter_criteria ?? {};
        await supabase
          .from("lead_lists")
          .update({
            filter_criteria: { ...fc, min_discovery_score: input.min_icp_score },
          })
          .eq("id", updated.smart_list_id);
      }
      return updated;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["pack_subscriptions"] });
      qc.invalidateQueries({ queryKey: ["pack_subscription", data.id] });
      qc.invalidateQueries({ queryKey: ["smart_list_info", data.smart_list_id] });
      toast.success("Signal updated");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Update failed");
    },
  });
}

/**
 * One-click healer: create the missing plain lead_list + smart_list for a
 * signal subscription that doesn't have them yet (older signals predate the
 * auto-create code path), then re-trigger signal-export so any pipeline rows
 * that already reached "enrolled" land in the new lists.
 *
 * Used by the SignalDetailPage empty-state "Wire up lists" button.
 */
export function useWireSignalLists() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      // Load sub so we can copy its name + min_icp_score into the list config.
      const { data: subRow, error: subErr } = await supabase
        .from("pack_subscriptions")
        .select("id, organization_id, pack_key, name, min_icp_score, lead_list_id, smart_list_id")
        .eq("id", subscriptionId)
        .maybeSingle();
      if (subErr) throw subErr;
      if (!subRow) throw new Error("Signal not found");
      const sub = subRow as PackSubscription & { pack_key: string };
      if (sub.lead_list_id && sub.smart_list_id) {
        return { lead_list_id: sub.lead_list_id, smart_list_id: sub.smart_list_id, created: false };
      }

      const pack = findPackInCatalog(sub.pack_key);
      const baseLabel = sub.name?.trim() || pack?.label || sub.pack_key;
      const signalType = packKeyToSignalType(sub.pack_key);
      const minScore = sub.min_icp_score ?? 60;
      const lookbackDays = pack?.defaultCadence === "monthly" ? 60 : pack?.defaultCadence === "weekly" ? 30 : 14;

      // 1. Plain "all discovered contacts" list.
      let leadListId = sub.lead_list_id;
      if (!leadListId) {
        const { data: list, error: listErr } = await supabase
          .from("lead_lists")
          .insert({
            organization_id: sub.organization_id,
            name: `${baseLabel} — discovered`,
            description: `All contacts discovered by the "${baseLabel}" signal.`,
            source_type: "signal",
            source_config: { pack_key: sub.pack_key, signal_name: baseLabel },
          })
          .select("id")
          .single();
        if (listErr) throw listErr;
        leadListId = (list as { id: string }).id;
      }

      // 2. Smart list with the discovery_metadata filter — this is what
      // campaigns / sequences point at to receive matched leads.
      let smartListId = sub.smart_list_id;
      if (!smartListId) {
        const { data: smart, error: smartErr } = await supabase
          .from("lead_lists")
          .insert({
            organization_id: sub.organization_id,
            name: `${baseLabel} — qualified`,
            description: `Auto-filtering smart list. Includes contacts whose discovery_metadata matches this signal AND who have a verified email + ICP score >= ${minScore}.`,
            source_type: "smart",
            is_smart: true,
            filter_criteria: {
              signal_types: [signalType],
              signal_max_age_days: lookbackDays,
              min_discovery_score: minScore,
              has_email: true,
            },
          })
          .select("id")
          .single();
        if (smartErr) throw smartErr;
        smartListId = (smart as { id: string }).id;
      }

      // 3. Wire the sub to the new lists.
      const { error: updErr } = await supabase
        .from("pack_subscriptions")
        .update({ lead_list_id: leadListId, smart_list_id: smartListId })
        .eq("id", subscriptionId);
      if (updErr) throw updErr;

      // 4. Reset already-exported activity rows so signal-export picks them
      // up again and adds them to the new lead list. Idempotent on the
      // crm_contacts side because upsertContact dedupes by email/linkedin.
      await supabase
        .from("signal_activity_log")
        .update({ exported_at: null })
        .eq("subscription_id", subscriptionId)
        .eq("outcome", "enrolled")
        .not("exported_at", "is", null)
        .then(() => undefined, () => undefined);

      // 5. Kick the export runner so the user sees results immediately
      // (best-effort — the cron picks up missed rows within 5 min anyway).
      await supabase.functions
        .invoke("list-building-signal-export", { body: {} })
        .then(() => undefined, () => undefined);

      return { lead_list_id: leadListId, smart_list_id: smartListId, created: true };
    },
    onSuccess: (_d, subId) => {
      qc.invalidateQueries({ queryKey: ["pack_subscription", subId] });
      qc.invalidateQueries({ queryKey: ["pack_subscriptions"] });
      qc.invalidateQueries({ queryKey: ["smart_list_info"] });
      qc.invalidateQueries({ queryKey: ["signal_activity_log", subId] });
      qc.invalidateQueries({ queryKey: ["signal_counts", subId] });
      toast.success("Lists created — running export now (1-2 min)");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Wiring failed");
    },
  });
}

/**
 * Soft-delete a signal. Sets `deleted_at` (the DB trigger flips status to
 * 'deleted'). The smart list and any previously-discovered contacts stay
 * live in /leads — only the signal definition itself disappears from the
 * user's signals page. Recoverable by clearing `deleted_at`.
 */
export function useDeletePackSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pack_subscriptions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return { id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pack_subscriptions"] });
      qc.invalidateQueries({ queryKey: ["pack_subscription"] });
      toast.success("Signal deleted");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    },
  });
}

interface PackRefreshResult {
  ok: boolean;
  processed: number;
  results: Array<{
    subscription_id: string;
    pack_key: string;
    companies: number;
    apify_runs_queued?: number;
    errors: string[];
  }>;
}

export function useTriggerPackRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke("list-building-pack-refresh", {
        body: { subscription_id: subscriptionId },
      });
      if (error) throw error;
      return data as PackRefreshResult;
    },
    onSuccess: (data, subscriptionId) => {
      qc.invalidateQueries({ queryKey: ["pack_refresh_jobs", subscriptionId] });
      qc.invalidateQueries({ queryKey: ["pack_subscriptions"] });
      qc.invalidateQueries({ queryKey: ["signal_counts", subscriptionId] });
      qc.invalidateQueries({ queryKey: ["signal_activity_log", subscriptionId] });
      const result = data?.results?.[0];
      const queued = result?.apify_runs_queued ?? 0;
      const errs = result?.errors ?? [];
      if (errs.length > 0) {
        toast.error(`Refresh ran with errors: ${errs[0]}`);
      } else if (queued > 0) {
        toast.success(
          `Refresh launched (${queued} ${queued === 1 ? "scrape" : "scrapes"} running on Apify). ` +
          `Records will appear over the next 1-5 minutes as the poller picks them up.`,
        );
      } else if ((result?.companies ?? 0) > 0) {
        toast.success(`Refresh complete — ${result?.companies} companies discovered`);
      } else {
        toast.info(
          "Refresh ran but returned no records. Check your filters " +
          "(positions/departments/seniorities must match the SignalBase enums).",
        );
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    },
  });
}

/**
 * Manually trigger DM scrape for a specific company. Inserts a stage='dm'
 * lb_work_items row (skipping if one already exists in pending/claimed),
 * then kicks the dm-scraper edge function so the user sees results within
 * the minute. Surfaced as a "Find DMs" action on the Companies table.
 */
export function useFindDmsForCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (companyId: string) => {
      const { data: existing } = await supabase
        .from("lb_work_items")
        .select("id")
        .eq("stage", "dm")
        .in("status", ["pending", "claimed"])
        .contains("payload", { company_id: companyId })
        .limit(1);
      if ((existing as Array<{ id: number }> | null)?.length) {
        return { already_pending: true };
      }
      const { data: company } = await supabase
        .from("lb_discovered_companies")
        .select("id, job_id, organization_id, company_name, domain, website_url, linkedin_url")
        .eq("id", companyId)
        .maybeSingle();
      if (!company) throw new Error("Company not found");
      const c = company as {
        id: string;
        job_id: string;
        organization_id: string;
        company_name: string;
        domain: string | null;
        website_url: string | null;
        linkedin_url: string | null;
      };
      await supabase.from("lb_work_items").insert({
        job_id: c.job_id,
        organization_id: c.organization_id,
        stage: "dm",
        status: "pending",
        payload: {
          company_id: c.id,
          company_name: c.company_name,
          domain: c.domain,
          website_url: c.website_url,
          linkedin_url: c.linkedin_url,
        },
        priority: 9,
      });
      // Kick the scraper for instant feedback (best-effort).
      await supabase.functions
        .invoke("list-building-dm-scraper", { body: {} })
        .then(() => undefined, () => undefined);
      return { already_pending: false };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["signal_companies"] });
      qc.invalidateQueries({ queryKey: ["signal_company_detail"] });
      qc.invalidateQueries({ queryKey: ["signal_counts"] });
      if (data.already_pending) {
        toast.info("DM scrape already running for this company");
      } else {
        toast.success("DM scrape queued — results in ~1 min");
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not queue DM scrape");
    },
  });
}

/**
 * Re-enqueue stage=`dm` work items for every signal in the org that's
 * stuck on enrolled-but-not-exported with zero DMs. The new dm-scraper
 * picks them up next cron tick. Surfaced as a "Rerun stuck" button on
 * SignalDetailPage so the user can recover from a previous failed
 * refresh without waiting for the next scheduled refresh.
 */
export function useRerunStuckSignals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke(
        "list-building-rerun-stuck-signals",
        { body: { subscription_id: subscriptionId } },
      );
      if (error) throw error;
      return data as {
        ok: boolean;
        stuck_signals_found: number;
        enqueued: number;
        already_pending: number;
        no_targets: number;
      };
    },
    onSuccess: (data, subscriptionId) => {
      qc.invalidateQueries({ queryKey: ["signal_activity_log", subscriptionId] });
      qc.invalidateQueries({ queryKey: ["signal_counts", subscriptionId] });
      if (data.enqueued > 0) {
        toast.success(`Re-queued ${data.enqueued} stuck ${data.enqueued === 1 ? "signal" : "signals"} for DM lookup`);
      } else if (data.already_pending > 0) {
        toast.info(`${data.already_pending} signals already in queue, nothing new to enqueue`);
      } else {
        toast.info("No stuck signals found");
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Rerun failed");
    },
  });
}

// ============================================================================
// Signals feature: ICP picker, activity feed, review queue
// ============================================================================

export interface LibraryIcp {
  id: string;
  name: string;
  summary: string | null;
  tags: string[] | null;
}

export function useLibraryIcps() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["library_icps", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_icps")
        .select("id, name, summary, tags")
        .eq("organization_id", currentOrganization!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as LibraryIcp[];
    },
  });
}

export interface LibraryProductWithIcp {
  id: string;
  name: string;
  description: string | null;
  has_icp: boolean;
}

export function useLibraryProducts() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["library_products_with_icp", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_products")
        .select("id, name, description, product_icp_fit(icp_id)")
        .eq("organization_id", currentOrganization!.id)
        .order("name");
      if (error) throw error;
      const products = (data ?? []).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        description: (p.description as string | null) ?? null,
        has_icp: Array.isArray(p.product_icp_fit) && p.product_icp_fit.length > 0,
      }));
      return products;
    },
  });
}

export type SignalOutcome =
  | "enrolled"
  | "enrolled_holding"
  | "review_pending"
  | "dropped_below_threshold"
  | "dropped_no_icp_match"
  | "cap_hit"
  | "failed";

export interface SignalActivityRow {
  id: number;
  subscription_id: string;
  contact_id_resolved: string | null;
  outcome: SignalOutcome;
  icp_score: number | null;
  signal_type: string | null;
  signal_detail: string | null;
  exported_at: string | null;
  created_at: string;
  data: Record<string, unknown> | null;
}

export function useSignalActivity(subscriptionId: string | null | undefined, limit = 100) {
  return useQuery({
    queryKey: ["signal_activity_log", subscriptionId, limit],
    enabled: !!subscriptionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signal_activity_log")
        .select("id, subscription_id, contact_id_resolved, outcome, icp_score, signal_type, signal_detail, exported_at, created_at, data")
        .eq("subscription_id", subscriptionId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as SignalActivityRow[];
    },
    refetchInterval: 15_000, // live-ish feed
  });
}

export interface ReviewQueueRow {
  id: string;
  subscription_id: string;
  discovered_company_id: string | null;
  contact_id: string | null;
  icp_score: number | null;
  icp_score_reasoning: string | null;
  signal_type: string | null;
  signal_detail: string | null;
  evidence_url: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  expires_at: string;
  created_at: string;
}

// Total Apify actor runs ever kicked off for this subscription (across all
// refresh jobs). Used to surface SignalBase spend per signal — wide
// date_preset windows × daily cadence × multi-page kickoffs add up fast
// and users currently have no visibility into the number.
export function useApifyRunsTotal(subscriptionId: string | null | undefined) {
  return useQuery({
    queryKey: ["apify_runs_total", subscriptionId],
    enabled: !!subscriptionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pack_refresh_jobs")
        .select("apify_runs")
        .eq("subscription_id", subscriptionId!)
        .not("apify_runs", "eq", "[]");
      if (error) throw error;
      const rows = (data as Array<{ apify_runs: unknown[] | null }> | null) ?? [];
      return rows.reduce(
        (n, r) => n + (Array.isArray(r.apify_runs) ? r.apify_runs.length : 0),
        0,
      );
    },
    refetchInterval: 60_000,
  });
}

export function useSignalReviewQueue(subscriptionId: string | null | undefined) {
  return useQuery({
    queryKey: ["signal_review_queue", subscriptionId],
    enabled: !!subscriptionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signal_review_queue")
        .select("*")
        .eq("subscription_id", subscriptionId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReviewQueueRow[];
    },
    refetchInterval: 30_000,
  });
}

export function useDecideReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; decision: "approved" | "rejected" }) => {
      if (input.decision === "approved") {
        // Use the SECURITY DEFINER SQL function — running the queue/activity
        // updates from the browser fails silently because RLS on
        // signal_activity_log only has SELECT + service-role policies.
        // The function does all four steps atomically: flip review_queue,
        // promote activity_log row(s), idempotent stage='dm' enqueue.
        const { data, error } = await supabase.rpc("approve_signal_review_item", {
          p_review_id: input.id,
        });
        if (error) throw error;
        const row = (data as Array<{ dm_work_item_id: number | null }> | null)?.[0];
        // Kick the scraper for instant feedback (best-effort).
        if (row?.dm_work_item_id) {
          await supabase.functions
            .invoke("list-building-dm-scraper", { body: {} })
            .then(() => undefined, () => undefined);
        }
        return { kicked: !!row?.dm_work_item_id };
      }
      // Rejecting only flips the queue row — no downstream side effects.
      const { error } = await supabase
        .from("signal_review_queue")
        .update({ status: "rejected", decided_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
      return { kicked: false };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["signal_review_queue"] });
      qc.invalidateQueries({ queryKey: ["signal_activity_log"] });
      qc.invalidateQueries({ queryKey: ["signal_companies"] });
      qc.invalidateQueries({ queryKey: ["signal_company_detail"] });
      qc.invalidateQueries({ queryKey: ["signal_counts"] });
      if (vars.decision === "approved") {
        toast.success("Approved — fetching decision-makers now (1-2 min)");
      } else {
        toast.success("Rejected");
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Decision failed");
    },
  });
}

export interface SignalCounts {
  signal_events_lifetime: number;
  qualified_lifetime: number;
  enrolled_today: number;
  enrolled_week: number;
  pending_review: number;
  exported_lifetime: number;
  skipped_lifetime: number;
  // Pipeline funnel — populated when get_signal_funnel succeeds.
  // Falls back to legacy fields above if the RPC isn't available.
  signals_total: number;
  companies_total: number;
  dms_found: number;
  emails_verified: number;
  in_crm: number;
  stuck_24h: number;
  /** Person-first signals where we have a LinkedIn URL but no email — the
   *  user can still DM them on LinkedIn (high-warmth: they engaged first). */
  linkedin_only: number;
}

export function useSignalCounts(subscriptionId: string | null | undefined) {
  return useQuery({
    queryKey: ["signal_counts", subscriptionId],
    enabled: !!subscriptionId,
    queryFn: async () => {
      // Primary path: server-side funnel RPC (returns all stages in one
      // round-trip). Falls back to per-count queries on RPC error.
      const { data: funnel, error: funnelErr } = await supabase
        .rpc("get_signal_funnel", { p_subscription_id: subscriptionId! })
        .maybeSingle();
      if (!funnelErr && funnel) {
        const f = funnel as {
          signals_total: number;
          companies_total: number;
          dms_found: number;
          emails_verified: number;
          in_crm: number;
          stuck_24h: number;
          pending_review: number;
          enrolled_today: number;
          enrolled_week: number;
          linkedin_only?: number;
        };
        return {
          enrolled_today: f.enrolled_today,
          enrolled_week: f.enrolled_week,
          pending_review: f.pending_review,
          exported_lifetime: f.in_crm,
          signals_total: f.signals_total,
          companies_total: f.companies_total,
          dms_found: f.dms_found,
          emails_verified: f.emails_verified,
          in_crm: f.in_crm,
          stuck_24h: f.stuck_24h,
          linkedin_only: f.linkedin_only ?? 0,
        } as SignalCounts;
      }

      // Fallback: legacy per-count queries (no funnel data).
      const todayIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
      const weekStart = new Date();
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      weekStart.setUTCHours(0, 0, 0, 0);
      const weekIso = weekStart.toISOString();

      const [allQ, qualifiedQ, todayQ, weekQ, reviewQ, exportedQ, skippedQ] = await Promise.all([
        supabase
          .from("signal_activity_log")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", subscriptionId!),
        supabase
          .from("signal_activity_log")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", subscriptionId!)
          .in("outcome", ["enrolled", "enrolled_holding"]),
        supabase
          .from("signal_activity_log")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", subscriptionId!)
          .eq("outcome", "enrolled")
          .gte("created_at", todayIso),
        supabase
          .from("signal_activity_log")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", subscriptionId!)
          .eq("outcome", "enrolled")
          .gte("created_at", weekIso),
        supabase
          .from("signal_review_queue")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", subscriptionId!)
          .eq("status", "pending"),
        supabase
          .from("signal_activity_log")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", subscriptionId!)
          .not("exported_at", "is", null),
        supabase
          .from("signal_activity_log")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", subscriptionId!)
          .in("outcome", ["dropped_below_threshold", "dropped_no_icp_match", "cap_hit", "failed"]),
      ]);

      return {
        signal_events_lifetime: allQ.count ?? 0,
        qualified_lifetime: qualifiedQ.count ?? 0,
        enrolled_today: todayQ.count ?? 0,
        enrolled_week: weekQ.count ?? 0,
        pending_review: reviewQ.count ?? 0,
        exported_lifetime: exportedQ.count ?? 0,
        skipped_lifetime: skippedQ.count ?? 0,
        // Funnel data not available without the RPC; surface zeros so the
        // funnel UI degrades gracefully (renders all stages with 0 counts).
        signals_total: 0,
        companies_total: 0,
        dms_found: 0,
        emails_verified: 0,
        in_crm: exportedQ.count ?? 0,
        stuck_24h: 0,
        linkedin_only: 0,
      } as SignalCounts;
    },
    refetchInterval: 30_000,
  });
}

export type SignalContactRow = CrmContact & {
  discovery_score?: number | null;
  discovery_signal_strength?: string | null;
  discovery_metadata?: Record<string, unknown> | null;
};

export function useSignalContacts(subscriptionId: string | null | undefined, limit = 25) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["signal_contacts", subscriptionId, currentOrganization?.id, limit],
    enabled: !!subscriptionId && !!currentOrganization,
    queryFn: async (): Promise<SignalContactRow[]> => {
      const orgId = currentOrganization!.id;

      // Step 1: get contact IDs via signal_activity_log (indexed on
      // (subscription_id, created_at DESC) — millisecond lookup regardless of
      // org size). Filtering crm_contacts directly by the JSONB path
      // discovery_metadata->>signal_subscription_id is planner-fragile under
      // RLS and times out on orgs with hundreds of thousands of contacts.
      const { data: activityRows, error: activityError } = await supabase
        .from("signal_activity_log")
        .select("contact_id_resolved")
        .eq("subscription_id", subscriptionId!)
        .not("contact_id_resolved", "is", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (activityError) throw activityError;

      const ids = Array.from(
        new Set((activityRows ?? []).map((r) => (r as { contact_id_resolved: string | null }).contact_id_resolved).filter(Boolean) as string[]),
      );
      if (ids.length === 0) return [];

      // Step 2: hydrate the contact rows by primary key.
      const { data: contactRows, error: contactsError } = await supabase
        .from("crm_contacts")
        .select("*")
        .eq("organization_id", orgId)
        .in("id", ids);
      if (contactsError) throw contactsError;

      const byId = new Map((contactRows ?? []).map((contact) => [(contact as { id: string }).id, contact as SignalContactRow]));
      return ids.map((id) => byId.get(id)).filter(Boolean) as SignalContactRow[];
    },
    refetchInterval: 30_000,
  });
}

export interface CreateSignalInput {
  pack_key: string;
  tier: PackTier;
  config: Record<string, unknown>;
  refresh_cadence: RefreshCadence;
  /** Required when refresh_cadence='custom'. Min 60 (1h). */
  refresh_interval_minutes?: number | null;
  /** Custom display name for this signal — shown everywhere in the UI. */
  name?: string | null;
  /** Direct ICP reference (library_icps.id) — preferred path. */
  icp_id?: string | null;
  /** Legacy: ICP via product. Used only for backwards compat. */
  icp_product_id?: string | null;
  min_icp_score?: number;
  review_band?: number;
  daily_cap?: number;
  weekly_cap?: number;
  destination_type?: "campaign" | "sequence" | "holding" | null;
  destination_id?: string | null;
}

/**
 * Map pack_key → SignalBase signalType used in discovery_metadata.signal_type.
 * Used when building the smart list filter criteria.
 */
function packKeyToSignalType(packKey: string): string {
  switch (packKey) {
    case "just_funded_saas": return "just_funded";
    case "aggressive_hiring": return "aggressive_hiring";
    case "new_leadership": return "new_leadership";
    case "recent_acquisitions": return "recent_acquisition";
    default: return packKey;
  }
}

export function useCreateSignal() {
  const qc = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateSignalInput) => {
      if (!currentOrganization) throw new Error("No organization");
      const pack = findPackInCatalog(input.pack_key);
      const baseLabel = input.name?.trim() || pack?.label || input.pack_key;
      const signalType = packKeyToSignalType(input.pack_key);

      // 0. Preflight name+pack collision check. Without this we'd write 2
      // lead_lists, then the pack_subscriptions insert would 409 on the
      // partial unique index — leaving orphan lists behind on every retry.
      const { data: existingSub } = await supabase
        .from("pack_subscriptions")
        .select("id, name")
        .eq("organization_id", currentOrganization.id)
        .eq("pack_key", input.pack_key)
        .neq("status", "deleted")
        .filter("name", input.name ? "eq" : "is", input.name ?? null)
        .limit(1)
        .maybeSingle();
      if (existingSub) {
        throw new Error(
          input.name?.trim()
            ? `You already have a "${pack?.label ?? input.pack_key}" signal named "${input.name.trim()}". Pick a different name or delete the existing one.`
            : `You already have an unnamed "${pack?.label ?? input.pack_key}" signal. Give this one a name to keep them apart.`,
        );
      }

      // 1. Auto-managed plain lead list — every contact discovered by this
      // signal is added here for raw browsing.
      const { data: list, error: listErr } = await supabase
        .from("lead_lists")
        .insert({
          organization_id: currentOrganization.id,
          name: `${baseLabel} — discovered`,
          description: `All contacts discovered by the "${baseLabel}" signal.`,
          source_type: "signal",
          source_config: { pack_key: input.pack_key, signal_name: baseLabel },
        })
        .select("id")
        .single();
      if (listErr) throw listErr;

      // 2. Smart list with the discovery_metadata filter — this is the one
      // campaigns / email sequences should point at to receive matched leads.
      const lookbackDays = pack?.defaultCadence === "monthly" ? 60 : pack?.defaultCadence === "weekly" ? 30 : 14;
      const { data: smartList, error: smartErr } = await supabase
        .from("lead_lists")
        .insert({
          organization_id: currentOrganization.id,
          name: `${baseLabel} — qualified`,
          description: `Auto-filtering smart list. Includes contacts whose discovery_metadata matches this signal AND who have a verified email + ICP score >= ${input.min_icp_score ?? 60}.`,
          source_type: "smart",
          is_smart: true,
          filter_criteria: {
            signal_types: [signalType],
            signal_max_age_days: lookbackDays,
            min_discovery_score: input.min_icp_score ?? 60,
            has_email: true,
          },
        })
        .select("id")
        .single();
      if (smartErr) throw smartErr;

      const { data, error } = await supabase
        .from("pack_subscriptions")
        .insert({
          organization_id: currentOrganization.id,
          pack_key: input.pack_key,
          tier: input.tier,
          status: "active",
          config: input.config,
          refresh_cadence: input.refresh_cadence,
          refresh_interval_minutes:
            input.refresh_cadence === "custom" ? input.refresh_interval_minutes ?? null : null,
          lead_list_id: (list as { id: string }).id,
          smart_list_id: (smartList as { id: string }).id,
          next_refresh_at: new Date().toISOString(),
          name: input.name ?? null,
          icp_id: input.icp_id ?? null,
          icp_product_id: input.icp_product_id ?? null,
          min_icp_score: input.min_icp_score ?? 70,
          review_band: input.review_band ?? 10,
          // Caps default to NULL (unlimited). Earlier defaults of 50/200
          // silently throttled every signal — combined with the apify-poller
          // race that double-processes datasets, this surfaced as the
          // "always exactly 100 enrolled today" UX bug. Power users who
          // want explicit throttling can still set caps via DB / future
          // wizard control.
          daily_cap: input.daily_cap ?? null,
          weekly_cap: input.weekly_cap ?? null,
          destination_type: input.destination_type ?? null,
          destination_id: input.destination_id ?? null,
        })
        .select("*")
        .single();
      if (error) {
        // Belt-and-braces cleanup — if a race or unexpected error landed us
        // here AFTER writing the two lead_lists, drop them so we don't
        // accumulate orphans. The preflight check above usually prevents
        // this branch for unique-violations.
        const listsToCleanUp = [
          (list as { id: string }).id,
          (smartList as { id: string }).id,
        ];
        await supabase.from("lead_lists").delete().in("id", listsToCleanUp);

        if ((error as { code?: string }).code === "23505") {
          const friendly = input.name?.trim()
            ? `You already have a "${pack?.label ?? input.pack_key}" signal named "${input.name.trim()}". Pick a different name or delete the existing one.`
            : `You already have an unnamed "${pack?.label ?? input.pack_key}" signal. Give this one a name to keep them apart.`;
          throw new Error(friendly);
        }
        throw error;
      }

      const { error: smartUpdateErr } = await supabase
        .from("lead_lists")
        .update({
          filter_criteria: {
            signal_types: [signalType],
            signal_subscription_id: data.id,
            signal_max_age_days: lookbackDays,
            min_discovery_score: input.min_icp_score ?? 60,
            has_email: true,
          },
        })
        .eq("id", (smartList as { id: string }).id);
      if (smartUpdateErr) throw smartUpdateErr;

      // The segment is created before the subscription exists, so its final
      // signal filter is written above. Refresh the persisted count only
      // after that filter is in place; otherwise new signal segments display
      // an incorrect zero until a later background refresh.
      const { error: countErr } = await supabase.rpc("compute_smart_list_count", {
        p_list_id: (smartList as { id: string }).id,
      });
      if (countErr) console.error("Failed to compute signal smart-list count:", countErr);

      return data as PackSubscription;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pack_subscriptions"] });
      toast.success("Signal created — smart list ready for your campaigns");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Create failed");
    },
  });
}

// ============================================================================
// Smart-list integration: load member count, look up campaigns pointing at it
// ============================================================================

export interface SmartListInfo {
  id: string;
  name: string;
  is_smart: boolean;
  lead_count: number | null;
  member_count_live: number;
  filter_criteria: Record<string, unknown> | null;
}

/**
 * Live member count for a smart list (re-evaluates the filter via the SQL
 * function we built — runs the same query the auto-enroll cron runs).
 */
// ============================================================================
// Companies-centric view: paginated/search/filter/sort table of all companies
// discovered for a signal subscription, with per-company DM + CRM counts.
// ============================================================================

export type CompanyOutcomeFilter =
  | "all"
  | "enrolled"
  | "review_pending"
  | "dropped"
  | "in_crm"
  | "has_dms"
  | "no_dms";

export type CompanySortKey =
  | "latest_signal_at"
  | "latest_signal_date"
  | "best_icp_score"
  | "crm_contacts_count"
  | "company_name";

export interface SignalCompanyRow {
  company_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  country: string | null;
  industry: string | null;
  employee_count: number | null;
  signal_types: string[] | null;
  signal_count: number;
  latest_signal_at: string | null;
  /** Real-world event date for the latest signal (funding date, hiring date,
   *  post date, etc.). Falls back to latest_signal_at::DATE when the pack
   *  doesn't carry a separate event date. ISO YYYY-MM-DD. */
  latest_signal_date: string | null;
  /** signal_type of the most recent signal_activity_log row for this company */
  latest_signal_type: string | null;
  /** Pre-formatted human-readable summary (e.g. "Hiring: Account Rep in Irvine, CA") */
  latest_signal_detail: string | null;
  /** Full SignalBase record for the latest occurrence — every datapoint */
  latest_raw_signal: Record<string, unknown> | null;
  /** Top-level evidence_url from the latest signal_activity_log row.
   *  Mostly used as a fallback for older rows where raw_signal is null
   *  but evidence_url was still set. */
  latest_evidence_url: string | null;
  best_icp_score: number | null;
  best_outcome: string | null;
  dms_count: number;
  verified_emails_count: number;
  crm_contacts_count: number;
  exported: boolean;
  total_count: number;
}

export interface UseSignalCompaniesOptions {
  search?: string;
  outcomeFilter?: CompanyOutcomeFilter;
  sortBy?: CompanySortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export function useSignalCompanies(
  subscriptionId: string | null | undefined,
  options: UseSignalCompaniesOptions = {},
) {
  const {
    search = "",
    outcomeFilter = "all",
    sortBy = "latest_signal_at",
    sortDir = "desc",
    limit = 50,
    offset = 0,
  } = options;
  return useQuery({
    queryKey: [
      "signal_companies",
      subscriptionId,
      search,
      outcomeFilter,
      sortBy,
      sortDir,
      limit,
      offset,
    ],
    enabled: !!subscriptionId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_signal_companies", {
        p_subscription_id: subscriptionId!,
        p_limit: limit,
        p_offset: offset,
        p_search: search || null,
        p_outcome_filter: outcomeFilter === "all" ? null : outcomeFilter,
        p_sort_by: sortBy,
        p_sort_dir: sortDir,
      });
      if (error) throw error;
      // The RPC names the company id column `id`; the table + drilldown read
      // `company_id`. Without this rename every row carries company_id
      // undefined, which silently disables useSignalCompanyDetail (enabled:
      // !!companyId) so the expanded panel never loads its DMs/contacts.
      const rows = ((data ?? []) as (SignalCompanyRow & { id: string })[]).map(
        (r) => ({ ...r, company_id: r.company_id ?? r.id }),
      );
      const total = rows[0]?.total_count ?? 0;
      return { rows, total: Number(total) };
    },
    refetchInterval: 30_000,
  });
}

export interface SignalCompanyDetailRow {
  kind: "signal" | "dm" | "contact";
  ref_id: string;
  occurred_at: string;
  outcome: string | null;
  signal_type: string | null;
  signal_detail: string | null;
  icp_score: number | null;
  raw_signal: Record<string, unknown> | null;
  dm_first_name: string | null;
  dm_last_name: string | null;
  dm_title: string | null;
  dm_linkedin_url: string | null;
  dm_email: string | null;
  dm_email_status: string | null;
  contact_id: string | null;
  contact_display_name: string | null;
  contact_primary_email: string | null;
  contact_job_title: string | null;
  contact_discovery_score: number | null;
}

export function useSignalCompanyDetail(
  subscriptionId: string | null | undefined,
  companyId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["signal_company_detail", subscriptionId, companyId],
    enabled: !!subscriptionId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_signal_company_detail", {
        p_subscription_id: subscriptionId!,
        p_company_id: companyId!,
      });
      if (error) throw error;
      return (data ?? []) as SignalCompanyDetailRow[];
    },
  });
}

export function useSmartListInfo(listId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart_list_info", listId],
    enabled: !!listId,
    queryFn: async (): Promise<SmartListInfo | null> => {
      const { data: list } = await supabase
        .from("lead_lists")
        .select("id, name, is_smart, lead_count, filter_criteria")
        .eq("id", listId!)
        .maybeSingle();
      if (!list) return null;

      let memberCountLive = 0;
      try {
        const { data: ids } = await supabase.rpc("smart_list_eligible_contact_ids", {
          p_list_id: listId,
        });
        memberCountLive = Array.isArray(ids) ? ids.length : 0;
      } catch {
        memberCountLive = 0;
      }

      return {
        id: list.id as string,
        name: list.name as string,
        is_smart: !!list.is_smart,
        lead_count: (list.lead_count as number | null) ?? null,
        member_count_live: memberCountLive,
        filter_criteria: (list.filter_criteria as Record<string, unknown> | null) ?? null,
      };
    },
    refetchInterval: 30_000,
  });
}

async function assertListDestinationOrganization(
  table: "email_sequences" | "linkedin_campaigns",
  destinationId: string,
  listId: string,
  organizationId?: string,
) {
  if (!organizationId) throw new Error("Choose an organization first");
  const [destination, source] = await Promise.all([
    supabase.from(table)
      .select("id, status, lead_list_ids, auto_enroll_new_members")
      .eq("id", destinationId)
      .eq("organization_id", organizationId)
      .single(),
    supabase.from("lead_lists")
      .select("id")
      .eq("id", listId)
      .eq("organization_id", organizationId)
      .single(),
  ]);
  if (destination.error) throw new Error(destination.error.message);
  if (source.error) throw new Error(source.error.message);
  return destination.data;
}

/**
 * Campaigns currently targeting this list. Array-native — see the note on
 * useSequencesTargetingList for why the legacy scalar under-reports.
 */
export function useCampaignsTargetingList(listId: string | null | undefined) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["campaigns_targeting_list", currentOrganization?.id, listId],
    enabled: !!currentOrganization && !!listId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .select("id, name, status, auto_enroll_new_members")
        .eq("organization_id", currentOrganization!.id)
        .contains("lead_list_ids", [listId!])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        status: string;
        auto_enroll_new_members: boolean | null;
      }>;
    },
  });
}

/**
 * Email sequences currently pulling from this list.
 *
 * Matches the `lead_list_ids` ARRAY, not the legacy scalar. The scalar only
 * ever holds the FIRST attached list (kept in step by sync_lead_list_scalar_array),
 * so an `.eq("lead_list_id", …)` match silently missed every sequence where this
 * list sits in position 2+.
 */
export function useSequencesTargetingList(listId: string | null | undefined) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["sequences_targeting_list", currentOrganization?.id, listId],
    enabled: !!currentOrganization && !!listId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("id, name, status, auto_enroll_new_members")
        .eq("organization_id", currentOrganization!.id)
        .contains("lead_list_ids", [listId!])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        status: string;
        auto_enroll_new_members: boolean | null;
      }>;
    },
  });
}

/** Available email sequences the user could point at this signal's smart list. */
export function useAvailableSequences() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["available_sequences", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("id, name, status, lead_list_id, lead_list_ids, auto_enroll_new_members")
        .eq("organization_id", currentOrganization!.id)
        .in("status", ["draft", "active", "paused"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        status: string;
        lead_list_id: string | null;
        lead_list_ids: string[] | null;
        auto_enroll_new_members: boolean | null;
      }>;
    },
  });
}

/**
 * Attach a list as a lead source of an email sequence. The cron
 * `discovery-auto-enroll-sequences` picks up new matches and bulk-enrolls them
 * via the enroll-leads edge function. Sequences in 'draft' status need to be
 * activated separately before enrollments actually start sending.
 *
 * Appends to lead_list_ids — it does NOT replace the sequence's other lists,
 * and it only sets the Ongoing / One-time mode when this is the first list.
 * See attachLeadList for what this used to get wrong.
 */
export function useLinkSmartListToSequence() {
  const qc = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { sequence_id: string; list_id: string; ongoing?: boolean }) => {
      const destination = await assertListDestinationOrganization("email_sequences", input.sequence_id, input.list_id, currentOrganization?.id);
      // Connecting preserves the sequence's existing enrollment and delivery rules.
      const attached = await attachLeadList(
        "email_sequences",
        input.sequence_id,
        input.list_id,
        input.ongoing ?? true,
      );
      if (attached === null) return; // already attached — nothing to do
      const ongoing = (destination.lead_list_ids?.length ?? 0) > 0
        ? destination.auto_enroll_new_members
        : input.ongoing ?? true;
      // One-time audiences are reviewed and enrolled explicitly in the builder.
      // Draft and paused destinations wait until they are active.
      if (!ongoing || destination.status !== "active") return;
      // Trigger the auto-enroll cron's edge equivalent immediately so the
      // user sees current eligible members without waiting for the next tick.
      // Best-effort: cron will retry on next tick anyway.
      await supabase.functions.invoke("enroll-leads", {
        body: {
          sequenceId: input.sequence_id,
          organizationId: currentOrganization!.id,
          listId: input.list_id,
        },
      }).then(() => undefined, () => undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sequences_targeting_list"] });
      qc.invalidateQueries({ queryKey: ["available_sequences"] });
      qc.invalidateQueries({ queryKey: ["email-sequences"] });
      toast.success("Sequence connected. Its audience rules and enrollment mode apply.");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Link failed");
    },
  });
}

/** Available campaigns the user could point at this signal's smart list. */
/** Node types in a campaign's step graph that send email. */
const CAMPAIGN_EMAIL_NODE_TYPES = new Set([
  "email",
  "sendToSmartlead",
  "sendToInstantly",
  "sendToLeadConnector",
  "sendToZapMail",
]);

/**
 * LinkedIn action node types (every node here calls a LinkedIn API and needs
 * primary_linkedin_url on the contact). Conditions like conditionConnection
 * are excluded — they read state from upstream actions but don't make API
 * calls themselves, so they don't independently require a URL.
 */
const CAMPAIGN_LINKEDIN_NODE_TYPES = new Set([
  "connectionRequest",
  "message",
  "inmail",
  "viewProfile",
  "follow",
  "likePost",
  "warmupEngagement",
]);

/** True if the campaign's sequence_nodes include any email-sending step. */
export function campaignNeedsEmail(sequenceNodes: unknown): boolean {
  if (!Array.isArray(sequenceNodes)) return false;
  return sequenceNodes.some((n) => {
    const t = (n as { type?: unknown } | null)?.type;
    return typeof t === "string" && CAMPAIGN_EMAIL_NODE_TYPES.has(t);
  });
}

/** True if the campaign's sequence_nodes include any LinkedIn-action step. */
export function campaignNeedsLinkedIn(sequenceNodes: unknown): boolean {
  if (!Array.isArray(sequenceNodes)) return false;
  return sequenceNodes.some((n) => {
    const t = (n as { type?: unknown } | null)?.type;
    return typeof t === "string" && CAMPAIGN_LINKEDIN_NODE_TYPES.has(t);
  });
}

/**
 * Channel reachability of a smart list — used in the link panel to give the
 * user a forecast: of N members, how many can run email steps and how many
 * can run LinkedIn steps. The campaign-processor skip-and-continues per-step
 * for missing channels, so this is informational, not a gate.
 */
export function useSmartListReachability(listId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart_list_reachability", listId],
    enabled: !!listId,
    queryFn: async () => {
      const { data: idsRaw, error: idsErr } = await supabase.rpc("smart_list_eligible_contact_ids", {
        p_list_id: listId!,
      });
      if (idsErr) throw idsErr;
      const ids = (idsRaw as Array<{ contact_id?: string } | string> | null ?? [])
        .map((r) => (typeof r === "string" ? r : (r as { contact_id?: string }).contact_id))
        .filter(Boolean) as string[];
      if (ids.length === 0) return { total: 0, withEmail: 0, withLinkedIn: 0 };

      // Server-side counts via head:true so no rows transfer.
      const [{ count: withEmail }, { count: withLinkedIn }] = await Promise.all([
        supabase
          .from("crm_contacts")
          .select("id", { count: "exact", head: true })
          .in("id", ids)
          .not("primary_email", "is", null)
          .neq("primary_email", ""),
        supabase
          .from("crm_contacts")
          .select("id", { count: "exact", head: true })
          .in("id", ids)
          .not("primary_linkedin_url", "is", null)
          .neq("primary_linkedin_url", ""),
      ]);
      return {
        total: ids.length,
        withEmail: withEmail ?? 0,
        withLinkedIn: withLinkedIn ?? 0,
      };
    },
  });
}

export function useAvailableCampaigns() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["available_campaigns", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .select("id, name, status, lead_list_id, lead_list_ids, auto_enroll_new_members, sequence_nodes, primary_channel")
        .eq("organization_id", currentOrganization!.id)
        .in("status", ["draft", "active", "paused"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((c) => {
        const row = c as {
          id: string;
          name: string;
          status: string;
          lead_list_id: string | null;
          lead_list_ids: string[] | null;
          auto_enroll_new_members: boolean | null;
          sequence_nodes: unknown;
          primary_channel: string | null;
        };
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          lead_list_id: row.lead_list_id,
          lead_list_ids: row.lead_list_ids,
          auto_enroll_new_members: row.auto_enroll_new_members,
          primary_channel: row.primary_channel,
          needs_email: campaignNeedsEmail(row.sequence_nodes),
          needs_linkedin: campaignNeedsLinkedIn(row.sequence_nodes),
        };
      });
    },
  });
}

export function useLinkSmartListToCampaign() {
  const qc = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { campaign_id: string; list_id: string; ongoing?: boolean }) => {
      await assertListDestinationOrganization("linkedin_campaigns", input.campaign_id, input.list_id, currentOrganization?.id);
      // Connecting preserves the campaign's existing audience and delivery rules.
      await attachLeadList(
        "linkedin_campaigns",
        input.campaign_id,
        input.list_id,
        input.ongoing ?? true,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns_targeting_list"] });
      qc.invalidateQueries({ queryKey: ["available_campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
      qc.invalidateQueries({ queryKey: ["linkedin-campaign"] });
      toast.success("Campaign connected. Its audience rules and enrollment mode apply.");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Link failed");
    },
  });
}

/**
 * Detach ONE lead list from a sequence. Any other lists it pulls from stay
 * attached — the previous version nulled the scalar, which the sync trigger
 * turned into "clear every list".
 */
export function useUnlinkListFromSequence() {
  const qc = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { sequence_id: string; list_id: string }) => {
      await assertListDestinationOrganization("email_sequences", input.sequence_id, input.list_id, currentOrganization?.id);
      await detachLeadList("email_sequences", input.sequence_id, input.list_id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sequences_targeting_list"] });
      qc.invalidateQueries({ queryKey: ["available_sequences"] });
      qc.invalidateQueries({ queryKey: ["email-sequences"] });
      toast.success("Source disconnected. Existing sequence enrollments remain.");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not disconnect sequence");
    },
  });
}

/** Detach ONE lead list from a campaign, leaving its other lists attached. */
export function useUnlinkListFromCampaign() {
  const qc = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { campaign_id: string; list_id: string }) => {
      await assertListDestinationOrganization("linkedin_campaigns", input.campaign_id, input.list_id, currentOrganization?.id);
      await detachLeadList("linkedin_campaigns", input.campaign_id, input.list_id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns_targeting_list"] });
      qc.invalidateQueries({ queryKey: ["available_campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
      qc.invalidateQueries({ queryKey: ["linkedin-campaign"] });
      toast.success("Source disconnected. Existing campaign enrollments remain.");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not disconnect campaign");
    },
  });
}
