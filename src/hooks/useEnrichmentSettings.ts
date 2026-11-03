import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Enrichment settings stored in organization settings
 */
export interface EnrichmentSettings {
  providerPriority: string[]; // Order of providers to try
  defaultEnrichmentType: "email" | "phone" | "email,phone" | "full";
  autoEnrichOnImport: boolean;
  autoEnrichBeforeCampaign: boolean;
  acceptCatchAllEmails: boolean; // Accept catch-all emails (risky but more results)
  requireEmailValidation: boolean; // Only accept verified/valid emails
  skipIfHasEmail: boolean;
  skipIfHasPhone: boolean;
  skipIfHasCompany: boolean;
}

export const DEFAULT_ENRICHMENT_SETTINGS: EnrichmentSettings = {
  // MoltSets last — lower coverage (~33%) and a paid daily-quota cap, so it
  // should only be tried after the uncapped waterfall providers miss.
  // QuickEnrich sits before MoltSets: similar waterfall role but name+company fallback
  // makes it more broadly applicable than LI-only MoltSets.
  providerPriority: ["apollo", "prospeo", "quickenrich", "moltsets"],
  defaultEnrichmentType: "email,phone",
  autoEnrichOnImport: false,
  autoEnrichBeforeCampaign: false,
  acceptCatchAllEmails: false,
  requireEmailValidation: true,
  skipIfHasEmail: true,
  skipIfHasPhone: false,
  skipIfHasCompany: false,
};

/**
 * Hook to get enrichment provider API keys and their status
 */
export function useEnrichmentProviders() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["enrichment-providers", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("api_keys")
        .select("id, provider, is_valid, key_hint, created_at")
        .eq("organization_id", currentOrganization.id)
        .in("provider", ["apollo", "prospeo", "moltsets", "quickenrich"]);

      if (error) throw error;

      // Map to enrichment provider format
      return data.map((key) => ({
        id: key.id,
        provider: key.provider,
        isConnected: key.is_valid,
        keyHint: key.key_hint,
        createdAt: key.created_at,
      }));
    },
    enabled: !!currentOrganization,
  });
}

/**
 * Hook to get enrichment settings for the organization
 */
export function useEnrichmentSettings() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["enrichment-settings", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return DEFAULT_ENRICHMENT_SETTINGS;

      const { data, error } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", currentOrganization.id)
        .single();

      if (error) throw error;

      // Extract enrichment settings from org settings
      const settings = data?.settings as Record<string, unknown> | null;
      const enrichmentSettings = settings?.enrichment as Partial<EnrichmentSettings> | undefined;

      return {
        ...DEFAULT_ENRICHMENT_SETTINGS,
        ...enrichmentSettings,
      };
    },
    enabled: !!currentOrganization,
  });
}

/**
 * Hook to update enrichment settings
 */
export function useUpdateEnrichmentSettings() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (newSettings: Partial<EnrichmentSettings>) => {
      if (!currentOrganization) throw new Error("No organization selected");

      // First get current settings
      const { data: org, error: fetchError } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", currentOrganization.id)
        .single();

      if (fetchError) throw fetchError;

      // Merge with new settings
      const currentSettings = (org?.settings as Record<string, unknown>) || {};
      const currentEnrichment = (currentSettings.enrichment as Partial<EnrichmentSettings>) || {};

      const updatedSettings = {
        ...currentSettings,
        enrichment: {
          ...currentEnrichment,
          ...newSettings,
        },
      };

      // Update organization settings
      const { error: updateError } = await supabase
        .from("organizations")
        .update({ settings: updatedSettings })
        .eq("id", currentOrganization.id);

      if (updateError) throw updateError;

      return updatedSettings.enrichment as EnrichmentSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-settings"] });
      toast.success("Enrichment settings saved");
    },
    onError: (error) => {
      console.error("Failed to save enrichment settings:", error);
      toast.error("Failed to save enrichment settings");
    },
  });
}

/**
 * Hook to get enrichment job stats
 */
export function useEnrichmentJobStats() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["enrichment-job-stats", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) {
        return { pending: 0, processing: 0, completed: 0, failed: 0 };
      }

      // Use lightweight count queries instead of fetching all rows
      const statuses = ["pending", "processing", "completed", "failed"] as const;
      const counts = await Promise.all(
        statuses.map(async (status) => {
          const { count, error } = await supabase
            .from("enrichment_jobs")
            .select("id", { count: "exact" })
            .eq("organization_id", currentOrganization.id)
            .eq("status", status);
          if (error) throw error;
          return [status, count || 0] as const;
        })
      );

      return Object.fromEntries(counts) as Record<typeof statuses[number], number>;
    },
    enabled: !!currentOrganization,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

/**
 * Hook to get enrichment credits used this month per provider
 */
export function useEnrichmentCreditsUsed() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["enrichment-credits", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return {};

      // Get start of current month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from("enrichment_history")
        .select("provider, credits_used")
        .eq("organization_id", currentOrganization.id)
        .gte("created_at", monthStart.toISOString());

      if (error) throw error;

      // Sum credits by provider
      const creditsPerProvider: Record<string, number> = {};
      data.forEach((entry) => {
        const provider = entry.provider;
        creditsPerProvider[provider] = (creditsPerProvider[provider] || 0) + (entry.credits_used || 0);
      });

      return creditsPerProvider;
    },
    enabled: !!currentOrganization,
  });
}
