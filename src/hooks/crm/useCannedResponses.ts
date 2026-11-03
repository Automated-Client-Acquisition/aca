import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface CannedResponse {
  id: string;
  organization_id: string;
  title: string;
  content: string;
  shortcut: string | null;
  category: string | null;
  created_by: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export function useCannedResponses() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["canned-responses", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_canned_responses")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("usage_count", { ascending: false });

      if (error) throw error;
      return data as CannedResponse[];
    },
    enabled: !!currentOrganization,
    retry: false,
  });
}

export function useCreateCannedResponse() {
  const { currentOrganization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      title: string;
      content: string;
      shortcut?: string;
      category?: string;
    }) => {
      const { data, error } = await supabase
        .from("inbox_canned_responses")
        .insert({
          organization_id: currentOrganization!.id,
          title: input.title,
          content: input.content,
          shortcut: input.shortcut || null,
          category: input.category || null,
          created_by: user!.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CannedResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canned-responses"] });
      toast.success("Canned response created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create canned response");
    },
  });
}

export function useUpdateCannedResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      title?: string;
      content?: string;
      shortcut?: string | null;
      category?: string | null;
    }) => {
      const { id, ...updates } = input;
      const { error } = await supabase
        .from("inbox_canned_responses")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canned-responses"] });
      toast.success("Canned response updated");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update canned response");
    },
  });
}

export function useDeleteCannedResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("inbox_canned_responses")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canned-responses"] });
      toast.success("Canned response deleted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete canned response");
    },
  });
}

export function useIncrementCannedResponseUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("increment_counter", {
        row_id: id,
        table_name: "inbox_canned_responses",
        column_name: "usage_count",
      });
      // Fallback: if RPC doesn't exist, do a manual increment
      if (error) {
        const { data } = await supabase
          .from("inbox_canned_responses")
          .select("usage_count")
          .eq("id", id)
          .single();
        if (data) {
          await supabase
            .from("inbox_canned_responses")
            .update({ usage_count: (data.usage_count || 0) + 1 })
            .eq("id", id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canned-responses"] });
    },
  });
}
