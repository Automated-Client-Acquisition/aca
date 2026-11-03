import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface ColorPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  textMuted: string;
}

export type VisualTemplate = 'minimal' | 'bold' | 'elegant' | 'playful' | 'professional';
export type FontStyle = 'sans-serif' | 'serif' | 'display' | 'handwritten';
export type AccentStyle = 'gradient' | 'solid' | 'outline' | 'glow';

export interface BrandVoice {
  id: string;
  name: string;
  description: string | null;
  tone: string | null;
  style_guidelines: string | null;
  logo: string | null;
  logos: string[] | null;
  organization_id: string;
  created_at: string;
  updated_at: string;
  // Visual styling fields
  visual_template: VisualTemplate | null;
  color_palette: ColorPalette | null;
  font_style: FontStyle | null;
  accent_style: AccentStyle | null;
  visual_style_description: string | null;
  mood_keywords: string[] | null;
}

export function useBrandVoices() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: brandVoices, isLoading, error } = useQuery({
    queryKey: ["brand-voices", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("library_brand_voices")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as BrandVoice[];
    },
  });

  const createBrandVoice = useMutation({
    mutationFn: async (newVoice: Partial<BrandVoice>) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("library_brand_voices")
        .insert([{ ...newVoice, organization_id: currentOrganization.id } as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-voices", currentOrganization?.id] });
      toast.success("Brand voice created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create brand voice: ${error.message}`);
    },
  });

  const updateBrandVoice = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<BrandVoice> }) => {
      const { data, error } = await supabase
        .from("library_brand_voices")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-voices", currentOrganization?.id] });
      toast.success("Brand voice updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update brand voice: ${error.message}`);
    },
  });

  const deleteBrandVoice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("library_brand_voices")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-voices", currentOrganization?.id] });
      toast.success("Brand voice deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete brand voice: ${error.message}`);
    },
  });

  const deleteBulkBrandVoices = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("library_brand_voices").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["brand-voices", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} brand voice${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete brand voices: ${error.message}`);
    },
  });

  return {
    brandVoices: brandVoices || [],
    isLoading,
    error,
    createBrandVoice: (data: Partial<BrandVoice>) => createBrandVoice.mutate(data),
    updateBrandVoice: (id: string, updates: Partial<BrandVoice>) => 
      updateBrandVoice.mutate({ id, updates }),
    deleteBrandVoice: (id: string) => deleteBrandVoice.mutate(id),
    deleteBulkBrandVoices: (ids: string[]) => deleteBulkBrandVoices.mutate(ids),
    isCreating: createBrandVoice.isPending,
    isUpdating: updateBrandVoice.isPending,
    isDeleting: deleteBrandVoice.isPending,
    isDeletingBulk: deleteBulkBrandVoices.isPending,
  };
}
