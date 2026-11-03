import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { slugify } from "@/lib/skillUtils";

export interface Skill {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  slug: string;
  content: string;
  is_public: boolean;
  install_count: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SkillWithOrg extends Skill {
  organizations?: {
    name: string;
    slug: string | null;
  } | null;
}

export interface CreateSkillData {
  name: string;
  description?: string;
  content: string;
  is_public: boolean;
  tags?: string[];
}

export interface UpdateSkillData {
  id: string;
  name?: string;
  description?: string;
  content?: string;
  is_public?: boolean;
  tags?: string[];
}

/** Fetch org's own skills */
export function useSkills() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["skills", currentOrganization?.id],
    queryFn: async (): Promise<Skill[]> => {
      const { data, error } = await supabase
        .from("skills")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!currentOrganization,
  });
}

/** Fetch all public skills (community marketplace) */
export function usePublicSkills(searchQuery?: string) {
  return useQuery({
    queryKey: ["skills", "public", searchQuery],
    queryFn: async (): Promise<SkillWithOrg[]> => {
      let query = supabase
        .from("skills")
        .select("*, organizations(name, slug)")
        .eq("is_public", true)
        .order("install_count", { ascending: false });

      if (searchQuery) {
        query = query.or(`name.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SkillWithOrg[];
    },
  });
}

/** Create a skill */
export function useCreateSkill() {
  const { currentOrganization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSkillData) => {
      const slug = slugify(data.name);
      const { data: skill, error } = await supabase
        .from("skills")
        .insert({
          organization_id: currentOrganization!.id,
          created_by: user!.id,
          name: data.name,
          description: data.description ?? null,
          slug,
          content: data.content,
          is_public: data.is_public,
          tags: data.tags ?? [],
        })
        .select()
        .single();
      if (error) throw error;
      return skill;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", currentOrganization?.id] });
      if (true) queryClient.invalidateQueries({ queryKey: ["skills", "public"] });
      toast.success("Skill created");
    },
    onError: (error: Error) => {
      toast.error(`Failed to create skill: ${error.message}`);
    },
  });
}

/** Update a skill */
export function useUpdateSkill() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateSkillData) => {
      const payload: Record<string, unknown> = { ...updates };
      if (updates.name) {
        payload.slug = slugify(updates.name);
      }
      const { data, error } = await supabase
        .from("skills")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["skills", "public"] });
      toast.success("Skill updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update skill: ${error.message}`);
    },
  });
}

/** Delete a skill */
export function useDeleteSkill() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("skills").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["skills", "public"] });
      toast.success("Skill deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete skill: ${error.message}`);
    },
  });
}

/** Increment install count for a public skill */
export function useIncrementSkillInstall() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("increment_skill_install_count", { skill_id: id });
      if (error) {
        // Fallback: direct update (if RPC not available yet)
        const { data: current } = await supabase
          .from("skills")
          .select("install_count")
          .eq("id", id)
          .single();
        await supabase
          .from("skills")
          .update({ install_count: (current?.install_count ?? 0) + 1 })
          .eq("id", id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", "public"] });
    },
  });
}
