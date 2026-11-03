import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/supabase-functions";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface ContentTeardown {
  format?: string;
  summary?: string;
  topic?: string;
  hook?: { text?: string; type?: string; why_it_works?: string };
  structure?: { beat?: string; purpose?: string; what_happens?: string; approx_seconds?: number | null }[];
  talking_points?: string[];
  ctas?: { text?: string; type?: string; placement?: string }[];
  engagement_drivers?: string[];
  voice?: string;
  pacing?: string;
  visual_style?: string;
  audience?: string;
  why_it_worked?: string;
  formula?: string;
}

/** Full transcript for one post — kept out of the list query because of its size. */
export function useScrapedContentTranscript(contentId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["research-content-transcript", contentId],
    enabled: !!contentId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("research_content")
        .select("transcript")
        .eq("id", contentId!)
        .single();
      if (error) throw error;
      return (data as { transcript: string | null }).transcript;
    },
  });
}

export function useTranscribeScrapedContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contentIds: string[]) =>
      invokeEdgeFunction<{ results: Record<string, string> }>("transcribe-scraped-content", { content_ids: contentIds }),
    onSuccess: ({ results }, ids) => {
      queryClient.invalidateQueries({ queryKey: ["research-content"] });
      ids.forEach((id) => queryClient.invalidateQueries({ queryKey: ["research-content-transcript", id] }));
      const outcomes = Object.values(results);
      if (outcomes.includes("processing")) toast.success("Transcribing — this usually takes under a minute");
      else if (outcomes.includes("completed")) toast.success("Transcript ready");
      else toast.error("No transcript available for this post");
    },
    onError: (error: Error) => toast.error(`Transcription failed: ${error.message}`),
  });
}

export function useAnalyzeScrapedContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentIds, force }: { contentIds: string[]; force?: boolean }) =>
      invokeEdgeFunction<{ results: { id: string; analysis?: ContentTeardown; error?: string }[] }>(
        "analyze-scraped-content",
        { content_ids: contentIds, force: !!force }
      ),
    onSuccess: ({ results }) => {
      queryClient.invalidateQueries({ queryKey: ["research-content"] });
      queryClient.invalidateQueries({ queryKey: ["trending-content"] });
      const failed = results.filter((r) => r.error);
      if (failed.length) toast.warning(`${failed.length} post${failed.length !== 1 ? "s" : ""} couldn't be analyzed: ${failed[0].error}`);
      else toast.success(results.length > 1 ? `Analyzed ${results.length} posts` : "Analysis ready");
    },
    onError: (error: Error) => toast.error(`Analysis failed: ${error.message}`),
  });
}

export function useReverseEngineerBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contentIds: string[]; pipeline?: string; name?: string }) =>
      invokeEdgeFunction<{ blueprint_id: string; name: string; pipeline: string }>("reverse-engineer-blueprint", {
        content_ids: input.contentIds,
        ...(input.pipeline ? { pipeline: input.pipeline } : {}),
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research-content"] });
      queryClient.invalidateQueries({ queryKey: ["blueprints"] });
    },
    onError: (error: Error) => toast.error(`Couldn't create blueprint: ${error.message}`),
  });
}

export type ImportPostInput =
  | { url: string }
  | { text: string; images?: string[]; platform?: string; author_name?: string; source_url?: string };

/** Import one post (by link, or pasted) into Scraped Content — see the import-post edge function. */
export function useImportPost() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: (input: ImportPostInput) =>
      invokeEdgeFunction<{ content_id: string; existing: boolean }>("import-post", {
        ...input,
        organization_id: currentOrganization?.id,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["research-content"] }),
    onError: (error: Error) => toast.error(error.message),
  });
}

/**
 * Make post images permanent: files go to the library-images bucket (per-user
 * folder, like AddLibraryImageDialog), links are copied by save-remote-images.
 */
export async function persistPostImages(files: File[], links: string[]): Promise<string[]> {
  const urls: string[] = [];
  if (files.length) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    for (const file of files) {
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.name.split(".").pop() || "jpg"}`;
      const { error } = await supabase.storage.from("library-images").upload(path, file);
      if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
      urls.push(supabase.storage.from("library-images").getPublicUrl(path).data.publicUrl);
    }
  }
  if (links.length) {
    const { results } = await invokeEdgeFunction<{ results: { url?: string; error?: string }[] }>("save-remote-images", {
      urls: links,
    });
    const failed = results.filter((r) => !r.url);
    if (failed.length) toast.warning(`${failed.length} image link${failed.length !== 1 ? "s" : ""} couldn't be saved: ${failed[0].error}`);
    urls.push(...results.flatMap((r) => (r.url ? [r.url] : [])));
  }
  return urls;
}
