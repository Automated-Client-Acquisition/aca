import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { LibraryElementType } from "@/types/blueprint";

export function useLibraryElementsForTesting(
  libraryTable?: LibraryElementType,
  fieldName?: string
) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['library-elements-test', libraryTable, fieldName, currentOrganization?.id],
    queryFn: async () => {
      if (!libraryTable || !fieldName) {
        console.log('Missing libraryTable or fieldName:', { libraryTable, fieldName });
        return [];
      }

      // All tables are now valid - no mapping needed
      const actualTable = libraryTable;

      console.log('Fetching from table:', actualTable, 'field:', fieldName);

      const { data, error } = await supabase
        .from(actualTable as any)
        .select(`id, name, ${fieldName}`)
        .eq("organization_id", currentOrganization!.id)
        .order('name');

      if (error) {
        console.error('Error fetching library elements:', error);
        throw error;
      }

      console.log('Fetched data:', data);
      return data || [];
    },
    enabled: !!libraryTable && !!fieldName && !!currentOrganization,
  });
}
