import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedIn } from "@/hooks/crm/useContacts";

export interface AnalyzeCompaniesInput {
  contactIds: string[];
  unipileAccountId?: string;
}

export interface AnalyzeCompaniesResult {
  success: boolean;
  summary: {
    total: number;
    processed: number;
    skipped: number;
    failed: number;
  };
  breakdown: {
    withWebsite: number;
    withLinkedIn: number;
    withNeither: number;
  };
  results: Array<{
    contactId: string;
    status: 'success' | 'skipped' | 'failed' | 'pending';
    error?: string;
  }>;
}

export interface ContactAnalysisPreview {
  id: string;
  display_name: string;
  company: string | null;
  company_website: string | null;
  primary_linkedin_url: string | null;
  canAnalyze: boolean;
  hasWebsite: boolean;
  hasLinkedIn: boolean;
  enriched_at: string | null;
  isAlreadyAnalyzed: boolean;
}

/**
 * Hook to get a preview of what will be analyzed for selected contacts
 */
export function useAnalyzePreview(contactIds: string[]) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['analyze-preview', contactIds],
    queryFn: async (): Promise<{
      contacts: ContactAnalysisPreview[];
      summary: {
        total: number;
        withWebsite: number;
        withLinkedIn: number;
        canAnalyze: number;
        willSkip: number;
        alreadyAnalyzed: number;
        needsAnalysis: number;
      };
    }> => {
      if (contactIds.length === 0) {
        return {
          contacts: [],
          summary: { total: 0, withWebsite: 0, withLinkedIn: 0, canAnalyze: 0, willSkip: 0, alreadyAnalyzed: 0, needsAnalysis: 0 }
        };
      }

      const data = await chunkedIn(contactIds, (chunk) =>
        supabase
          .from('crm_contacts')
          .select('id, display_name, company, company_website, primary_linkedin_url, enriched_at')
          .in('id', chunk)
          .eq('organization_id', currentOrganization?.id)
      );

      const contacts: ContactAnalysisPreview[] = (data || []).map(contact => ({
        ...contact,
        hasWebsite: !!contact.company_website,
        hasLinkedIn: !!contact.primary_linkedin_url,
        canAnalyze: !!contact.company_website || !!contact.primary_linkedin_url,
        isAlreadyAnalyzed: !!contact.enriched_at,
      }));

      const withWebsite = contacts.filter(c => c.hasWebsite).length;
      const withLinkedIn = contacts.filter(c => c.hasLinkedIn).length;
      const canAnalyze = contacts.filter(c => c.canAnalyze).length;
      const alreadyAnalyzed = contacts.filter(c => c.isAlreadyAnalyzed && c.canAnalyze).length;
      const needsAnalysis = contacts.filter(c => !c.isAlreadyAnalyzed && c.canAnalyze).length;

      return {
        contacts,
        summary: {
          total: contacts.length,
          withWebsite,
          withLinkedIn,
          canAnalyze,
          willSkip: contacts.length - canAnalyze,
          alreadyAnalyzed,
          needsAnalysis,
        },
      };
    },
    enabled: contactIds.length > 0 && !!currentOrganization?.id,
  });
}

/**
 * Hook to analyze a single company
 */
export function useAnalyzeCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      contactId: string;
      companyWebsite?: string;
      linkedinUrl?: string;
      unipileAccountId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('analyze-company', {
        body: params,
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Analysis failed');

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact', variables.contactId] });
      toast.success('Company analysis complete');
    },
    onError: (error) => {
      toast.error(`Analysis failed: ${error.message}`);
    },
  });
}

/**
 * Hook to analyze multiple companies in batch
 */
export function useAnalyzeCompaniesBatch() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: AnalyzeCompaniesInput): Promise<AnalyzeCompaniesResult> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      const { data, error } = await supabase.functions.invoke('analyze-companies-batch', {
        body: {
          contactIds: input.contactIds,
          organizationId: currentOrganization.id,
          unipileAccountId: input.unipileAccountId,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Batch analysis failed');

      return data as AnalyzeCompaniesResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['lead-list-members'] });

      const { summary } = result;
      if (summary.processed > 0) {
        toast.success(
          `Analyzed ${summary.processed} companies` +
          (summary.skipped > 0 ? ` (${summary.skipped} skipped)` : '') +
          (summary.failed > 0 ? ` (${summary.failed} failed)` : '')
        );
      } else if (summary.skipped > 0) {
        toast.warning(`All ${summary.skipped} contacts skipped - no website or LinkedIn URL available`);
      }
    },
    onError: (error) => {
      toast.error(`Batch analysis failed: ${error.message}`);
    },
  });
}
