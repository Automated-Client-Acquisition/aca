import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Enrichment types that can be requested
 */
export type EnrichmentType = "email" | "phone" | "company" | "social" | "full";

/**
 * Available enrichment providers
 */
export type EnrichmentProvider = "apollo" | "prospeo";

/**
 * Enriched data returned from enrichment
 */
export interface EnrichedData {
  email?: string;
  emailVerified?: boolean;
  emailConfidence?: number;
  alternateEmails?: string[];
  phone?: string;
  phoneType?: "mobile" | "work" | "direct" | "hq";
  alternatePhones?: string[];
  company?: {
    name: string;
    domain?: string;
    industry?: string;
    size?: string;
    website?: string;
    description?: string;
  };
  socialProfiles?: Array<{
    platform: string;
    url: string;
    username?: string;
  }>;
  title?: string;
  seniority?: string;
  department?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
}

/**
 * Result from enrichment API
 */
export interface EnrichmentResult {
  success: boolean;
  provider: EnrichmentProvider;
  creditsUsed: number;
  data: EnrichedData;
  appliedToContact?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

interface EnrichContactParams {
  contactId: string;
  enrichmentTypes?: EnrichmentType[];
  preferredProvider?: EnrichmentProvider;
  applyToContact?: boolean;
}

/**
 * Hook to enrich a single contact
 */
export function useEnrichContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      enrichmentTypes = ["email", "phone"],
      preferredProvider,
      applyToContact = true,
    }: EnrichContactParams): Promise<EnrichmentResult> => {
      const { data, error } = await supabase.functions.invoke("enrich-contact", {
        body: {
          contactId,
          enrichmentTypes,
          preferredProvider,
          applyToContact,
        },
      });

      if (error) throw error;

      return data as EnrichmentResult;
    },
    onSuccess: (data, variables) => {
      // Invalidate contact queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["contact", variables.contactId] });
      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });

      if (data.success) {
        const foundItems: string[] = [];
        if (data.data.email) foundItems.push("email");
        if (data.data.phone) foundItems.push("phone");
        if (data.data.company) foundItems.push("company info");

        if (foundItems.length > 0) {
          toast.success(`Found ${foundItems.join(", ")} via ${data.provider}`);
        } else {
          toast.info("Enrichment completed, but no new data found");
        }
      } else {
        toast.error(data.error?.message || "Enrichment failed");
      }
    },
    onError: (error) => {
      console.error("Enrichment error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to enrich contact"
      );
    },
  });
}

interface QueueEnrichmentParams {
  contactId: string;
  enrichmentTypes?: string;
  priority?: number;
  source?: string;
}

/**
 * Hook to queue a contact for background enrichment
 */
export function useQueueEnrichment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      enrichmentTypes = "email,phone",
      priority = 5,
      source = "manual",
    }: QueueEnrichmentParams) => {
      const { data, error } = await supabase.rpc("queue_contact_enrichment", {
        p_contact_id: contactId,
        p_enrichment_types: enrichmentTypes,
        p_priority: priority,
        p_source: source,
      });

      if (error) throw error;

      return data as string; // Returns job ID
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-jobs"] });
      toast.success("Contact queued for enrichment");
    },
    onError: (error) => {
      console.error("Queue enrichment error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to queue enrichment"
      );
    },
  });
}

interface QueueListEnrichmentParams {
  listId: string;
  enrichmentTypes?: string;
  priority?: number;
  onlyMissing?: boolean;
}

/**
 * Hook to queue all contacts in a list for enrichment
 */
export function useQueueListEnrichment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      listId,
      enrichmentTypes = "email,phone",
      priority = 5,
      onlyMissing = true,
    }: QueueListEnrichmentParams) => {
      const { data, error } = await supabase.rpc("queue_list_enrichment", {
        p_list_id: listId,
        p_enrichment_types: enrichmentTypes,
        p_priority: priority,
        p_only_missing: onlyMissing,
      });

      if (error) throw error;

      return data as number; // Returns count of jobs created
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-jobs"] });
      if (count > 0) {
        toast.success(`Queued ${count} contacts for enrichment`);
      } else {
        toast.info("No contacts need enrichment");
      }
    },
    onError: (error) => {
      console.error("Queue list enrichment error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to queue list enrichment"
      );
    },
  });
}

/**
 * Hook to fetch enrichment history for a contact
 */
export function useEnrichmentHistory(contactId: string | undefined) {
  return {
    queryKey: ["enrichment-history", contactId],
    queryFn: async () => {
      if (!contactId) return [];

      const { data, error } = await supabase
        .from("enrichment_history")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      return data;
    },
    enabled: !!contactId,
  };
}

/**
 * Hook to fetch pending enrichment jobs for an organization
 */
export function useEnrichmentJobs(status: "pending" | "processing" | "completed" | "failed" = "pending") {
  return {
    queryKey: ["enrichment-jobs", status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrichment_jobs")
        .select(`
          *,
          contact:crm_contacts (
            id,
            display_name,
            avatar_url,
            primary_email,
            primary_phone
          )
        `)
        .eq("status", status)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) throw error;

      return data;
    },
  };
}
