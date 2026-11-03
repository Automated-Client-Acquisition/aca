import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface Product {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  logo: string | null;
  sku: string | null;
  price: number | null;
  currency: string | null;
  images: string[] | null;
  videos: string[] | null;
  features: string[] | null;
  specifications: any;
  affiliate_links: any;
  key_benefits: string[] | null;
  tags: string[] | null;
  analysis_questions: string[] | null;
  organization_id: string;
  created_at: string;
  updated_at: string;
}

export function useProducts() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: products, isLoading, error } = useQuery({
    queryKey: ["products", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("library_products")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Product[];
    },
  });

  const createProduct = useMutation({
    mutationFn: async (newProduct: Partial<Product>) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("library_products")
        .insert([{ ...newProduct, organization_id: currentOrganization.id } as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", currentOrganization?.id] });
      toast.success("Product created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create product: ${error.message}`);
    },
  });

  const updateProduct = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Product> }) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { data, error } = await supabase
        .from("library_products")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Product not found");
      return data[0];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", currentOrganization?.id] });
      toast.success("Product updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update product: ${error.message}`);
    },
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { error } = await supabase
        .from("library_products")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", currentOrganization?.id] });
      toast.success("Product deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete product: ${error.message}`);
    },
  });

  const deleteBulkProducts = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentOrganization) throw new Error('No organization context');
      await chunkedMutate(ids, (chunk) =>
        supabase.from("library_products").delete().in("id", chunk).eq("organization_id", currentOrganization.id)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["products", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} product${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete products: ${error.message}`);
    },
  });

  return {
    products: products || [],
    isLoading,
    error,
    createProduct: (data: Partial<Product>) => createProduct.mutate(data),
    updateProduct: (id: string, updates: Partial<Product>) => 
      updateProduct.mutate({ id, updates }),
    deleteProduct: (id: string) => deleteProduct.mutate(id),
    deleteBulkProducts: (ids: string[]) => deleteBulkProducts.mutate(ids),
    isCreating: createProduct.isPending,
    isUpdating: updateProduct.isPending,
    isDeleting: deleteProduct.isPending,
    isDeletingBulk: deleteBulkProducts.isPending,
  };
}
