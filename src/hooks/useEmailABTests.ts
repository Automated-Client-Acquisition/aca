import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { EmailABVariant } from "@/types/email";

// ============================================================================
// Queries
// ============================================================================

export function useABVariants(
  sequenceId: string | undefined,
  stepIndex?: number,
) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: [
      "email-ab-variants",
      sequenceId,
      stepIndex,
      currentOrganization?.id,
    ],
    queryFn: async () => {
      if (!sequenceId || !currentOrganization) return [];

      let query = supabase
        .from("email_ab_variants")
        .select("*, email_sequences!inner(organization_id)")
        .eq("email_sequences.organization_id", currentOrganization.id)
        .eq("sequence_id", sequenceId)
        .order("variant_label", { ascending: true });

      if (stepIndex !== undefined) {
        query = query.eq("step_index", stepIndex);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data as unknown as EmailABVariant[];
    },
    enabled: !!sequenceId && !!currentOrganization,
    refetchInterval: 30_000,
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateABVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sequence_id: string;
      step_index: number;
      variant_label: string;
      subject: string;
      body: string;
      split_percentage: number;
    }) => {
      const { data, error } = await supabase
        .from("email_ab_variants")
        .insert(input)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as EmailABVariant;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["email-ab-variants", data.sequence_id],
      });
      toast.success(`Variant ${data.variant_label} created`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create variant: ${error.message}`);
    },
  });
}

export function useUpdateABVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id: string;
      subject?: string;
      body?: string;
      split_percentage?: number;
      sequence_id: string;
    }) => {
      const updateData: Record<string, unknown> = {};
      if (input.subject !== undefined) updateData.subject = input.subject;
      if (input.body !== undefined) updateData.body = input.body;
      if (input.split_percentage !== undefined)
        updateData.split_percentage = input.split_percentage;

      const { data, error } = await supabase
        .from("email_ab_variants")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return {
        variant: data as unknown as EmailABVariant,
        sequence_id: input.sequence_id,
      };
    },
    onSuccess: ({ sequence_id }) => {
      queryClient.invalidateQueries({
        queryKey: ["email-ab-variants", sequence_id],
      });
      toast.success("Variant updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update variant: ${error.message}`);
    },
  });
}

/**
 * Sync A/B variants from the JSONB steps to the email_ab_variants table.
 * Called when sequence steps are saved. Uses upsert (by id) so existing
 * stats/winner flags are preserved.
 */
export function useSyncABVariants() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sequence_id,
      steps,
    }: {
      sequence_id: string;
      steps: Array<{
        order: number;
        type: string;
        variants?: Array<{
          id?: string;
          variant_label: string;
          subject: string;
          body: string;
          split_percentage: number;
        }>;
      }>;
    }) => {
      // Collect all variant rows that should exist
      const variantRows: Array<{
        id: string;
        sequence_id: string;
        step_index: number;
        variant_label: string;
        subject: string;
        body: string;
        split_percentage: number;
      }> = [];

      for (const step of steps) {
        if (step.type === "ab_test" && step.variants) {
          for (const v of step.variants) {
            if (!v.id) continue;
            variantRows.push({
              id: v.id,
              sequence_id,
              step_index: step.order,
              variant_label: v.variant_label,
              subject: v.subject,
              body: v.body,
              split_percentage: v.split_percentage,
            });
          }
        }
      }

      if (variantRows.length === 0) {
        // No A/B test steps — clean up any stale rows
        const { error: cleanupError } = await supabase
          .from("email_ab_variants")
          .delete()
          .eq("sequence_id", sequence_id);
        if (cleanupError) throw cleanupError;
        return;
      }

      // Upsert all variants (preserves stats columns: sent, opened, clicked, replied, bounced, is_winner)
      const { error } = await supabase
        .from("email_ab_variants")
        .upsert(variantRows, {
          onConflict: "id",
          ignoreDuplicates: false,
        });

      if (error) throw error;

      // Remove any stale variants that are no longer in the steps
      const activeIds = variantRows.map((r) => r.id);
      const { error: cleanupError } = await supabase
        .from("email_ab_variants")
        .delete()
        .eq("sequence_id", sequence_id)
        .not("id", "in", `(${activeIds.join(",")})`);
      if (cleanupError) throw cleanupError;
    },
    onSuccess: (_, { sequence_id }) => {
      queryClient.invalidateQueries({
        queryKey: ["email-ab-variants", sequence_id],
      });
    },
  });
}

export function useDeclareWinner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      variant_id,
      sequence_id,
      step_index,
    }: {
      variant_id: string;
      sequence_id: string;
      step_index: number;
    }) => {
      // Reset all variants for this step
      const { error: resetError } = await supabase
        .from("email_ab_variants")
        .update({ is_winner: false })
        .eq("sequence_id", sequence_id)
        .eq("step_index", step_index);
      if (resetError) throw resetError;

      // Set winner
      const { data, error } = await supabase
        .from("email_ab_variants")
        .update({ is_winner: true })
        .eq("id", variant_id)
        .eq("sequence_id", sequence_id)
        .eq("step_index", step_index)
        .select()
        .single();

      if (error) throw error;
      return { variant: data as unknown as EmailABVariant, sequence_id };
    },
    onSuccess: ({ variant, sequence_id }) => {
      queryClient.invalidateQueries({
        queryKey: ["email-ab-variants", sequence_id],
      });
      toast.success(`Variant ${variant.variant_label} declared as winner`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to declare winner: ${error.message}`);
    },
  });
}
