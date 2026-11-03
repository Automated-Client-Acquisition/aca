import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useLibraryBrandVoices() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["library-brand-voices", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_brand_voices")
        .select("id, name")
        .eq("organization_id", currentOrganization!.id)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!currentOrganization,
  });
}

export function useLibraryCharacters() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["library-characters", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_characters")
        .select("id, name, reference_images")
        .eq("organization_id", currentOrganization!.id)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!currentOrganization,
  });
}

export function useLibraryBlocks(blockType?: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: blockType
      ? ["library-blocks", blockType, currentOrganization?.id]
      : ["library-blocks", currentOrganization?.id],
    queryFn: async () => {
      let query = supabase
        .from("library_blocks")
        .select("id, name, block_type, content")
        .eq("organization_id", currentOrganization!.id)
        .order("name");

      if (blockType) {
        query = query.eq("block_type", blockType);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
    enabled: !!currentOrganization,
  });
}

export function useLibraryProducts() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["library-products", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_products")
        .select("id, name, images")
        .eq("organization_id", currentOrganization!.id)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!currentOrganization,
  });
}

export function useLibraryICPs() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["library-icps", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_icps")
        .select("id, name")
        .eq("organization_id", currentOrganization!.id)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!currentOrganization,
  });
}
