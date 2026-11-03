import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { chunkedIn } from '@/hooks/crm/useContacts';

export interface ContactProductScore {
  id: string;
  contact_id: string;
  product_id: string;
  organization_id: string;
  icp_score: number | null;
  icp_score_reasoning: string | null;
  primary_need: string | null;
  primary_need_reasoning: string | null;
  selected_outcome: string | null;
  decision_maker_score: number | null;
  decision_maker_reasoning: string | null;
  decision_maker_source: 'rule' | 'ai' | null;
  analyzed_at: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  // Joined from library_products
  product_name?: string;
}

/**
 * Fetch all product scores for a single contact (for ContactDetail page).
 * Joins product name for display.
 */
export function useContactProductScores(contactId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['contact-product-scores', contactId],
    queryFn: async (): Promise<ContactProductScore[]> => {
      if (!contactId || !currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('contact_product_scores')
        .select('*, library_products!inner(name)')
        .eq('contact_id', contactId)
        .eq('organization_id', currentOrganization.id)
        .order('icp_score', { ascending: false });

      if (error) {
        console.error('Failed to fetch contact product scores:', error);
        return [];
      }

      return (data || []).map((row: Record<string, unknown>) => ({
        ...row,
        product_name: (row.library_products as { name: string } | null)?.name,
      })) as ContactProductScore[];
    },
    enabled: !!contactId && !!currentOrganization?.id,
  });
}

/**
 * Fetch scores for a specific product across multiple contacts (for table column display).
 * Returns a map of contact_id -> score for fast lookup.
 */
export function useContactScoresForProduct(
  contactIds: string[],
  productId: string | null
) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['contact-scores-for-product', productId, contactIds.sort().join(',')],
    queryFn: async (): Promise<Map<string, ContactProductScore>> => {
      if (!productId || contactIds.length === 0 || !currentOrganization?.id) {
        return new Map();
      }

      let data: ContactProductScore[];
      try {
        data = await chunkedIn<ContactProductScore>(contactIds, (chunk) =>
          supabase
            .from('contact_product_scores')
            .select('*')
            .eq('product_id', productId)
            .eq('organization_id', currentOrganization.id)
            .in('contact_id', chunk)
        );
      } catch (error) {
        console.error('Failed to fetch product scores for contacts:', error);
        return new Map();
      }

      const map = new Map<string, ContactProductScore>();
      for (const row of data) {
        map.set(row.contact_id, row as ContactProductScore);
      }
      return map;
    },
    enabled: !!productId && contactIds.length > 0 && !!currentOrganization?.id,
  });
}
