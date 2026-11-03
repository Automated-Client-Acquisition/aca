import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { Blueprint, CreateBlueprintInput, UpdateBlueprintInput } from "@/types/blueprint";

export function useBlueprints() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["blueprints", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("blueprints")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .neq("is_active", false)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as Blueprint[];
    },
    enabled: !!currentOrganization,
  });
}

export function useCreateBlueprint() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateBlueprintInput) => {
      if (!user) throw new Error("User not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("blueprints")
        .insert({
          name: input.name,
          description: input.description,
          master_prompt: input.master_prompt,
          image_prompt: input.image_prompt,
          director_prompt: input.director_prompt,
          skip_image_generation: input.skip_image_generation ?? false,
          structure: input.structure as any,
          model_config: input.model_config as any,
          pipeline: input.pipeline,
          tags: input.tags,
          reference_image_libraries: input.reference_image_libraries,
          brief: (input.brief ?? null) as any,
          context: (input.context ?? null) as any,
          folder_id: input.folder_id || null,
          organization_id: currentOrganization.id,
          created_by: user.id,
        } as any)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Failed to create blueprint");
      return data as unknown as Blueprint;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprints", currentOrganization?.id] });
      toast.success("Blueprint created successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to create blueprint: ${error.message}`);
    },
  });
}

export function useUpdateBlueprint() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateBlueprintInput) => {
      const updateData: any = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.master_prompt !== undefined) updateData.master_prompt = input.master_prompt;
      if (input.image_prompt !== undefined) updateData.image_prompt = input.image_prompt;
      if (input.director_prompt !== undefined) updateData.director_prompt = input.director_prompt;
      if (input.skip_image_generation !== undefined) updateData.skip_image_generation = input.skip_image_generation;
      if (input.structure !== undefined) updateData.structure = input.structure;
      if (input.model_config !== undefined) updateData.model_config = input.model_config;
      if (input.pipeline !== undefined) updateData.pipeline = input.pipeline;
      if (input.tags !== undefined) updateData.tags = input.tags;
      if (input.reference_image_libraries !== undefined) updateData.reference_image_libraries = input.reference_image_libraries;
      if (input.folder_id !== undefined) updateData.folder_id = input.folder_id;
      if (input.brief !== undefined) updateData.brief = input.brief;
      if (input.context !== undefined) updateData.context = input.context;

      const { data, error } = await supabase
        .from("blueprints")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error("Blueprint not found or update failed");
      return data as unknown as Blueprint;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprints", currentOrganization?.id] });
      toast.success("Blueprint updated successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update blueprint: ${error.message}`);
    },
  });
}

export function useDuplicateBlueprint() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (blueprint: Blueprint) => {
      if (!user) throw new Error("User not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      // (organization_id, name) is unique, so pick the first free "(Copy)" / "(Copy N)" name.
      const baseName = blueprint.name.replace(/ \(Copy(?: \d+)?\)$/, "");
      const { data: existing, error: nameError } = await supabase
        .from("blueprints")
        .select("name")
        .eq("organization_id", currentOrganization.id)
        .ilike("name", `${baseName.replace(/[%_\\]/g, "\\$&")} (Copy%`);
      if (nameError) throw nameError;
      const taken = new Set((existing ?? []).map((b) => b.name));
      let name = `${baseName} (Copy)`;
      for (let n = 2; taken.has(name); n++) name = `${baseName} (Copy ${n})`;

      const { data, error } = await supabase
        .from("blueprints")
        .insert({
          name,
          description: blueprint.description,
          master_prompt: blueprint.master_prompt,
          image_prompt: blueprint.image_prompt,
          director_prompt: blueprint.director_prompt,
          skip_image_generation: blueprint.skip_image_generation ?? false,
          structure: blueprint.structure as any,
          model_config: blueprint.model_config as any,
          pipeline: blueprint.pipeline,
          tags: blueprint.tags,
          reference_image_libraries: blueprint.reference_image_libraries,
          brief: (blueprint.brief ?? null) as any,
          context: (blueprint.context ?? null) as any,
          folder_id: blueprint.folder_id || null,
          organization_id: currentOrganization.id,
          created_by: user.id,
        } as any)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Failed to duplicate blueprint");
      return data as unknown as Blueprint;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprints", currentOrganization?.id] });
      toast.success("Blueprint duplicated successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to duplicate blueprint: ${error.message}`);
    },
  });
}

export function useDeleteBlueprint() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error, count } = await supabase
        .from("blueprints")
        .delete({ count: 'exact' })
        .eq("id", id);

      if (error) throw error;
      if (count === 0) throw new Error("Blueprint not found or already deleted");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprints", currentOrganization?.id] });
      toast.success("Blueprint deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete blueprint: ${error.message}`);
    },
  });
}

/**
 * Studio autosave: same write as useUpdateBlueprint, without a toast per
 * keystroke. Callers show their own "Saving / Saved" state.
 */
export function useAutosaveBlueprint() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateBlueprintInput) => {
      const { data, error } = await supabase
        .from("blueprints")
        .update(input as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Blueprint;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<Blueprint[]>(["blueprints", currentOrganization?.id], (prev) =>
        prev ? prev.map((b) => (b.id === saved.id ? saved : b)) : prev,
      );
    },
    onError: (error: Error) => {
      toast.error(`Couldn't save: ${error.message}`);
    },
  });
}
