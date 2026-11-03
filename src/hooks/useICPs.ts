import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface ICP {
  id: string;
  organization_id: string;
  name: string;
  summary: string | null;
  description: string | null;
  pain_points: string[] | null;
  desires: string[] | null;
  objections: string[] | null;
  language_style: string | null;
  tags: string[] | null;
  target_locations: string[] | null;
  target_seniorities: string[] | null;
  target_departments: string[] | null;
  target_title_keywords: string[] | null;
  decision_maker_notes: string | null;
  // NOT NULL columns, default '{}' — never null, unlike the targeting fields above.
  target_employee_bands: string[];
  target_revenue_bands: string[];
  target_industries: string[];
  created_at: string;
  updated_at: string;
}

export function useICPs() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: icps, isLoading, error } = useQuery({
    queryKey: ["library-icps", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("library_icps")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as ICP[];
    },
  });

  const createICP = useMutation({
    mutationFn: async (newICP: Partial<ICP>) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("library_icps")
        .insert([{ ...newICP, organization_id: currentOrganization.id }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-icps", currentOrganization?.id] });
      toast.success("ICP created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create ICP: ${error.message}`);
    },
  });

  const updateICP = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ICP> }) => {
      const { data, error } = await supabase
        .from("library_icps")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-icps", currentOrganization?.id] });
      toast.success("ICP updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update ICP: ${error.message}`);
    },
  });

  const deleteICP = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("library_icps")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-icps", currentOrganization?.id] });
      toast.success("ICP deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete ICP: ${error.message}`);
    },
  });

  const deleteBulkICPs = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("library_icps").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["library-icps", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} ICP${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete ICPs: ${error.message}`);
    },
  });

  return {
    icps: icps || [],
    isLoading,
    error,
    createICP: (data: Partial<ICP>) => createICP.mutate(data),
    updateICP: (id: string, updates: Partial<ICP>) => updateICP.mutate({ id, updates }),
    deleteICP: (id: string) => deleteICP.mutate(id),
    deleteBulkICPs: (ids: string[]) => deleteBulkICPs.mutate(ids),
    isCreating: createICP.isPending,
    isUpdating: updateICP.isPending,
    isDeleting: deleteICP.isPending,
    isDeletingBulk: deleteBulkICPs.isPending,
  };
}

// ============================================================================
// AI scrape — generate an ICP from a website URL + a LinkedIn profile URL.
// Streams SSE progress events from the scrape-and-analyze-icp edge function
// then inserts the resulting row via createICP. Returns the inserted ICP so
// callers can auto-select it (e.g. the signal wizard's empty-state).
// Mirrors useScrapeProduct.ts.
// ============================================================================

interface ScrapeIcpParams {
  websiteUrl: string;
  linkedinProfileUrl: string;
  onProgress?: (status: string, message: string) => void;
}

// AI-returned shape — matches the edge function's prompt output.
interface ScrapedIcpData {
  name: string;
  summary: string | null;
  description: string | null;
  pain_points: string[] | null;
  desires: string[] | null;
  objections: string[] | null;
  language_style: string | null;
  tags: string[] | null;
  target_locations: string[] | null;
  target_seniorities: string[] | null;
  target_departments: string[] | null;
  target_title_keywords: string[] | null;
  decision_maker_notes: string | null;
  // Firmographics are not scraped — the site says what a company sells, not who
  // it sells to. Set them by hand in the ICP editor; omitted here, the columns
  // take their '{}' default (they are NOT NULL, so null would be rejected).
  target_employee_bands?: string[] | null;
  target_revenue_bands?: string[] | null;
  target_industries?: string[] | null;
}

export function useScrapeAndCreateIcp() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      websiteUrl,
      linkedinProfileUrl,
      onProgress,
    }: ScrapeIcpParams): Promise<ICP> => {
      if (!currentOrganization) throw new Error('No organization context');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scrape-and-analyze-icp`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ websiteUrl, linkedinProfileUrl }),
        }
      );

      if (!response.ok) {
        let errorMsg = 'Failed to generate ICP';
        try {
          const j = await response.json();
          errorMsg = j.error || errorMsg;
        } catch { /* keep default */ }
        throw new Error(errorMsg);
      }
      if (!response.body) throw new Error('No response body');

      // Stream SSE — same shape as useScrapeProduct.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let icpData: ScrapedIcpData | null = null;
      let buffer = '';

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const payload = line.slice(6);
        if (!payload) return;
        let data: { status?: string; message?: string; data?: ScrapedIcpData };
        try {
          data = JSON.parse(payload);
        } catch (err) {
          console.warn('Skipping malformed SSE line:', payload.slice(0, 200), err);
          return;
        }
        if (data.status && data.message) onProgress?.(data.status, data.message);
        if (data.status === 'complete' && data.data) icpData = data.data;
        if (data.status === 'error') throw new Error(data.message ?? 'Unknown error');
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) processLine(line);
      }
      buffer += decoder.decode();
      if (buffer) {
        for (const line of buffer.split('\n')) processLine(line);
      }
      if (!icpData) throw new Error('No ICP data received');

      // Insert. RLS ensures org scoping; we still pass organization_id for
      // explicitness (matches the AddICPDialog manual path).
      const insertPayload = {
        organization_id: currentOrganization.id,
        name: icpData.name,
        summary: icpData.summary ?? null,
        description: icpData.description ?? null,
        pain_points: icpData.pain_points?.length ? icpData.pain_points : null,
        desires: icpData.desires?.length ? icpData.desires : null,
        objections: icpData.objections?.length ? icpData.objections : null,
        language_style: icpData.language_style ?? null,
        tags: icpData.tags?.length ? icpData.tags : null,
        target_locations: icpData.target_locations?.length ? icpData.target_locations : null,
        target_seniorities: icpData.target_seniorities?.length ? icpData.target_seniorities : null,
        target_departments: icpData.target_departments?.length ? icpData.target_departments : null,
        target_title_keywords: icpData.target_title_keywords?.length ? icpData.target_title_keywords : null,
        decision_maker_notes: icpData.decision_maker_notes ?? null,
      };

      const { data: inserted, error } = await supabase
        .from('library_icps')
        .insert([insertPayload])
        .select()
        .single();
      if (error) throw error;
      return inserted as ICP;
    },
    onSuccess: () => {
      // Invalidate both the useICPs key AND the useDiscovery key (different
      // queryKey shape — the wizard reads via useLibraryIcps).
      queryClient.invalidateQueries({ queryKey: ['library-icps', currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ['library_icps', currentOrganization?.id] });
      toast.success('ICP generated and saved');
    },
    onError: (error) => {
      console.error('Scrape ICP error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate ICP');
    },
  });
}
