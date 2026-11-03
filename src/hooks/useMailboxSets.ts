import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface MailboxSet {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  mailbox_ids: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const KEY = "mailbox-sets";

export function useMailboxSets() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: [KEY, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("mailbox_sets" as never)
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as MailboxSet[];
    },
    enabled: !!currentOrganization,
  });
}

export function useCreateMailboxSet() {
  const queryClient = useQueryClient();
  const { currentOrganization, user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string | null;
      mailbox_ids: string[];
    }): Promise<MailboxSet> => {
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase
        .from("mailbox_sets" as never)
        .insert({
          organization_id: currentOrganization.id,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          mailbox_ids: input.mailbox_ids,
          created_by: user?.id ?? null,
        } as never)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as MailboxSet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, currentOrganization?.id] });
      toast.success("Mailbox preset saved");
    },
    onError: (error: Error) => {
      const msg = /duplicate key/i.test(error.message)
        ? "A preset with that name already exists"
        : error.message;
      toast.error(`Failed to save preset: ${msg}`);
    },
  });
}

export function useUpdateMailboxSet() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      description?: string | null;
      mailbox_ids?: string[];
    }): Promise<MailboxSet> => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.description !== undefined) patch.description = input.description?.trim() || null;
      if (input.mailbox_ids !== undefined) patch.mailbox_ids = input.mailbox_ids;

      const { data, error } = await supabase
        .from("mailbox_sets" as never)
        .update(patch as never)
        .eq("id", input.id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as MailboxSet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, currentOrganization?.id] });
      toast.success("Preset updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update preset: ${error.message}`);
    },
  });
}

export function useDeleteMailboxSet() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("mailbox_sets" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, currentOrganization?.id] });
      toast.success("Preset deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete preset: ${error.message}`);
    },
  });
}
