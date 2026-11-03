import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type {
  StarterBrandVoice,
  StarterCharacter,
  StarterICP,
  StarterProduct,
  StarterBlock,
  StarterIdea,
} from "@/data/starterPack";

interface ImportPayload {
  brandVoices: StarterBrandVoice[];
  characters: StarterCharacter[];
  icps: StarterICP[];
  products: StarterProduct[];
  blocks: StarterBlock[];
  ideas: StarterIdea[];
}

export function useStarterPackImport() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();
  const [importProgress, setImportProgress] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: async (payload: ImportPayload) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      // Use currentOrganization from AuthContext - it already respects impersonation
      const orgId = currentOrganization.id;
      const results = {
        brandVoices: 0,
        characters: 0,
        icps: 0,
        products: 0,
        blocks: 0,
        ideas: 0,
      };

      // Import Brand Voices
      if (payload.brandVoices.length > 0) {
        setImportProgress("Importing brand voices...");
        const brandVoicesData = payload.brandVoices.map((v) => ({
          name: v.name,
          description: v.description,
          tone: v.tone,
          style_guidelines: v.style_guidelines,
          visual_template: v.visual_template,
          mood_keywords: v.mood_keywords,
          organization_id: orgId,
        }));

        const { error } = await supabase
          .from("library_brand_voices")
          .insert(brandVoicesData);

        if (error) {
          console.error("Error importing brand voices:", error);
          throw new Error(`Failed to import brand voices: ${error.message}`);
        }
        results.brandVoices = payload.brandVoices.length;
      }

      // Import Characters
      if (payload.characters.length > 0) {
        setImportProgress("Importing characters...");
        const charactersData = payload.characters.map((c) => ({
          name: c.name,
          description: c.description,
          gender: c.gender,
          age_range: c.age_range,
          ethnicity: c.ethnicity,
          build: c.build,
          hair_description: c.hair_description,
          typical_clothing: c.typical_clothing,
          overall_tone: c.overall_tone,
          speaking_style: c.speaking_style,
          personality_traits: c.personality_traits,
          tags: c.tags,
          reference_images: c.reference_images,
          organization_id: orgId,
        }));

        const { error } = await supabase
          .from("library_characters")
          .insert(charactersData);

        if (error) {
          console.error("Error importing characters:", error);
          throw new Error(`Failed to import characters: ${error.message}`);
        }
        results.characters = payload.characters.length;
      }

      // Import ICPs
      if (payload.icps.length > 0) {
        setImportProgress("Importing target audiences...");
        const icpsData = payload.icps.map((i) => ({
          name: i.name,
          description: i.description,
          pain_points: i.pain_points,
          desires: i.desires,
          objections: i.objections,
          language_style: i.language_style,
          tags: i.tags,
          organization_id: orgId,
        }));

        const { error } = await supabase
          .from("library_icps")
          .insert(icpsData);

        if (error) {
          console.error("Error importing ICPs:", error);
          throw new Error(`Failed to import target audiences: ${error.message}`);
        }
        results.icps = payload.icps.length;
      }

      // Import Products
      if (payload.products.length > 0) {
        setImportProgress("Importing products...");
        const productsData = payload.products.map((p) => ({
          name: p.name,
          description: p.description,
          category: p.category,
          features: p.features,
          key_benefits: p.key_benefits,
          tags: p.tags,
          organization_id: orgId,
        }));

        const { error } = await supabase
          .from("library_products")
          .insert(productsData);

        if (error) {
          console.error("Error importing products:", error);
          throw new Error(`Failed to import products: ${error.message}`);
        }
        results.products = payload.products.length;
      }

      // Import Blocks
      if (payload.blocks.length > 0) {
        setImportProgress("Importing blocks...");
        const blocksData = payload.blocks.map((b) => ({
          name: b.name,
          block_type: b.block_type,
          content: b.content,
          tags: b.tags,
          organization_id: orgId,
        }));

        const { error } = await supabase
          .from("library_blocks")
          .insert(blocksData);

        if (error) {
          console.error("Error importing blocks:", error);
          throw new Error(`Failed to import blocks: ${error.message}`);
        }
        results.blocks = payload.blocks.length;
      }

      // Import Ideas
      if (payload.ideas.length > 0) {
        setImportProgress("Importing content ideas...");
        const ideasData = payload.ideas.map((i) => ({
          title: i.title,
          organization_id: orgId,
        }));

        const { error } = await supabase
          .from("content_ideas")
          .insert(ideasData);

        if (error) {
          console.error("Error importing ideas:", error);
          throw new Error(`Failed to import content ideas: ${error.message}`);
        }
        results.ideas = payload.ideas.length;
      }

      setImportProgress(null);
      return results;
    },
    onSuccess: (results) => {
      // Invalidate all relevant queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      queryClient.invalidateQueries({ queryKey: ["library-icps"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["library-blocks"] });
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });

      // Build success message
      const parts: string[] = [];
      if (results.brandVoices > 0) parts.push(`${results.brandVoices} brand voice${results.brandVoices > 1 ? "s" : ""}`);
      if (results.characters > 0) parts.push(`${results.characters} character${results.characters > 1 ? "s" : ""}`);
      if (results.icps > 0) parts.push(`${results.icps} target audience${results.icps > 1 ? "s" : ""}`);
      if (results.products > 0) parts.push(`${results.products} product${results.products > 1 ? "s" : ""}`);
      if (results.blocks > 0) parts.push(`${results.blocks} block${results.blocks > 1 ? "s" : ""}`);
      if (results.ideas > 0) parts.push(`${results.ideas} content idea${results.ideas > 1 ? "s" : ""}`);

      const total = results.brandVoices + results.characters + results.icps + results.products + results.blocks + results.ideas;

      toast.success(`Successfully imported ${total} items`, {
        description: parts.join(", "),
      });
    },
    onError: (error) => {
      setImportProgress(null);
      toast.error("Import failed", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    },
  });

  return {
    importItems: importMutation.mutateAsync,
    isImporting: importMutation.isPending,
    importProgress,
  };
}
