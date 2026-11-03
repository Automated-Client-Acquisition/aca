import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface CustomFieldDef {
  id: string;
  organization_id: string;
  field_key: string;
  display_name: string;
  field_type: string;
  options: unknown[];
  is_required: boolean;
  validation_rules: Record<string, unknown>;
  display_order: number;
  is_visible_in_list: boolean;
  is_searchable: boolean;
  default_value: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Queries
// ============================================================================

export function useCustomFieldDefs() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["custom-field-defs", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("crm_custom_field_defs")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("display_order", { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as CustomFieldDef[];
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateCustomFieldDefs() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (
      fields: Array<{
        field_key: string;
        display_name: string;
        field_type: string;
        default_value?: string | null;
        description?: string | null;
        display_order?: number;
      }>
    ) => {
      if (!currentOrganization) throw new Error("No organization selected");

      const rows = fields.map((f, i) => ({
        organization_id: currentOrganization.id,
        field_key: f.field_key,
        display_name: f.display_name,
        field_type: f.field_type,
        default_value: f.default_value ?? null,
        description: f.description ?? null,
        display_order: f.display_order ?? i,
      }));

      const { data, error } = await supabase
        .from("crm_custom_field_defs")
        .upsert(rows as any, {
          onConflict: "organization_id,field_key",
          ignoreDuplicates: true,
        })
        .select();

      if (error) throw error;
      return data as unknown as CustomFieldDef[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["custom-field-defs", currentOrganization?.id],
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to create custom fields: ${error.message}`);
    },
  });
}

export function useUpdateCustomFieldDef() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      display_name?: string;
      default_value?: string | null;
      description?: string | null;
      is_visible_in_list?: boolean;
      is_searchable?: boolean;
      display_order?: number;
      field_type?: string;
      is_required?: boolean;
    }) => {
      if (!currentOrganization) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("crm_custom_field_defs")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(patch as any)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as CustomFieldDef;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["custom-field-defs", currentOrganization?.id],
      });
      toast.success("Custom field updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update custom field: ${error.message}`);
    },
  });
}

export function useDeleteCustomFieldDef() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("crm_custom_field_defs")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["custom-field-defs", currentOrganization?.id],
      });
      toast.success("Custom field deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete custom field: ${error.message}`);
    },
  });
}
