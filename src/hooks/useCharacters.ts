import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface HeyGenAvatarProfile {
  id: string; // unique profile id (uuid)
  name: string; // display name for this profile
  avatar_id: string; // HeyGen avatar_id
  avatar_type: 'prebuilt' | 'custom'; // prebuilt = from HeyGen library, custom = trained from reference image
  voice_id: string; // HeyGen voice_id
  voice_name?: string; // display name for the voice
  avatar_name?: string; // display name for the avatar
  preview_image_url?: string; // HeyGen avatar preview thumbnail
  avatar_group_id?: string; // for custom avatars: training group id
  avatar_status?: 'none' | 'training' | 'ready' | 'failed'; // for custom avatars
  config?: Record<string, any>; // background prefs, dimension prefs
}

export interface Character {
  id: string;
  name: string;
  description: string | null;
  visual_style: string | null;
  gender: string | null;
  age_range: string | null;
  build: string | null;
  ethnicity: string | null;
  hair_description: string | null;
  typical_clothing: string | null;
  accessories: any;
  voice_selection: string | null;
  overall_tone: string | null;
  speaking_style: string | null;
  personality: any;
  personality_traits: any;
  expertise: any;
  voice_config: any;
  visual_config: any;
  reference_images: string[] | null;
  reference_videos: string[] | null;
  tags: string[] | null;
  usage_count: number | null;
  organization_id: string;
  created_at: string | null;
  updated_at: string | null;
  // HeyGen integration (legacy single-avatar fields)
  heygen_avatar_id: string | null;
  heygen_avatar_group_id: string | null;
  heygen_avatar_status: 'none' | 'training' | 'ready' | 'failed' | null;
  heygen_voice_id: string | null;
  heygen_config: Record<string, any> | null;
  // Multi-avatar profiles
  heygen_avatars: HeyGenAvatarProfile[];
}

export function useCharacters() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: characters, isLoading, error } = useQuery({
    queryKey: ["characters", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("library_characters")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Character[];
    },
  });

  const createCharacter = useMutation({
    mutationFn: async (newCharacter: Partial<Character>) => {
      if (!user) throw new Error('User not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("library_characters")
        .insert([{ ...newCharacter, organization_id: currentOrganization.id } as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters", currentOrganization?.id] });
      toast.success("Character created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create character: ${error.message}`);
    },
  });

  const updateCharacter = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Character> }) => {
      const { data, error } = await supabase
        .from("library_characters")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters", currentOrganization?.id] });
      toast.success("Character updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update character: ${error.message}`);
    },
  });

  const deleteCharacter = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("library_characters")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters", currentOrganization?.id] });
      toast.success("Character deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete character: ${error.message}`);
    },
  });

  const deleteBulkCharacters = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("library_characters").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["characters", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} character${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete characters: ${error.message}`);
    },
  });

  return {
    characters: characters || [],
    isLoading,
    error,
    createCharacter: (data: Partial<Character>) => createCharacter.mutate(data),
    updateCharacter: (id: string, updates: Partial<Character>) => 
      updateCharacter.mutate({ id, updates }),
    deleteCharacter: (id: string) => deleteCharacter.mutate(id),
    deleteBulkCharacters: (ids: string[]) => deleteBulkCharacters.mutate(ids),
    isCreating: createCharacter.isPending,
    isUpdating: updateCharacter.isPending,
    isDeleting: deleteCharacter.isPending,
    isDeletingBulk: deleteBulkCharacters.isPending,
  };
}
