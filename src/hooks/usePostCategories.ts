import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface PostCategory {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export function usePostCategories() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const { data: categories, isLoading, error } = useQuery({
    queryKey: ["post-categories", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_categories")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      return data as PostCategory[];
    },
    enabled: !!currentOrganization,
  });

  const createCategory = useMutation({
    mutationFn: async (newCategory: Partial<PostCategory>) => {
      const { data, error } = await supabase
        .from("post_categories")
        .insert([newCategory as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-categories"] });
      toast.success("Category created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create category: ${error.message}`);
    },
  });

  const updateCategory = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<PostCategory> }) => {
      const { data, error } = await supabase
        .from("post_categories")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-categories"] });
      toast.success("Category updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update category: ${error.message}`);
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("post_categories")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-categories"] });
      toast.success("Category deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete category: ${error.message}`);
    },
  });

  return {
    categories: categories || [],
    isLoading,
    error,
    createCategory,
    updateCategory,
    deleteCategory,
    isCreating: createCategory.isPending,
    isUpdating: updateCategory.isPending,
    isDeleting: deleteCategory.isPending,
  };
}
