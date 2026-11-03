import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Piece } from "@/lib/piece";
import { threadContentFromText } from "@/lib/thread-text";

/**
 * Everything the Review screen can do to one piece. Edits merge into the
 * latest stage_data / data read right before writing, so a stage finishing in
 * the background isn't overwritten by a stale copy.
 */
export function useReviewActions(output: any, piece: Piece) {
  const queryClient = useQueryClient();
  const outputId: string = output?.id;
  const jobId: string | undefined = output?.job_id;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["content-outputs", jobId] });
    queryClient.invalidateQueries({ queryKey: ["generation-job", jobId] });
  };

  const fresh = async (): Promise<{ stage_data: Record<string, any>; data: Record<string, any> }> => {
    const { data, error } = await supabase.from("content_outputs").select("stage_data, data").eq("id", outputId).single();
    if (error) throw error;
    return { stage_data: (data?.stage_data as any) ?? {}, data: (data?.data as any) ?? {} };
  };

  const saveText = useMutation({
    mutationFn: async (text: string) => {
      const target = piece.textTarget;
      if (!target) throw new Error("This piece has no editable text");
      const current = await fresh();
      const patch =
        target.where === "stage"
          ? {
              stage_data: {
                ...current.stage_data,
                [target.stageId]: {
                  ...current.stage_data[target.stageId],
                  // Threads keep the {"tweets":[...]} shape publishing reads.
                  content: target.format === "thread" ? threadContentFromText(text) : text,
                  edited_at: new Date().toISOString(),
                },
              },
            }
          : { data: { ...current.data, text } };
      const { error } = await supabase.from("content_outputs").update(patch).eq("id", outputId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(`Couldn't save: ${e.message}`),
  });

  const replaceImage = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith("image/")) throw new Error(`${file.name} isn't an image`);
      if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is over 20 MB`);
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${outputId}/image_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("content-media").upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const url = supabase.storage.from("content-media").getPublicUrl(path).data.publicUrl;
      const current = await fresh();
      if (piece.imageTarget === "stage") {
        const prev = current.stage_data.image ?? {};
        const { error } = await supabase
          .from("content_outputs")
          .update({
            stage_data: {
              ...current.stage_data,
              image: { ...prev, url, image_url: url, source: "upload", status: prev.status === "approved" ? "approved" : "awaiting_approval" },
            },
          })
          .eq("id", outputId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("content_outputs").update({ data: { ...current.data, image_url: url } }).eq("id", outputId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success("Image replaced");
    },
    onError: (e: Error) => toast.error(`Couldn't replace the image: ${e.message}`),
  });

  const newImage = useMutation({
    mutationFn: async (instructions?: string) => {
      if (piece.imageTarget === "stage") {
        const current = await fresh();
        const { error: upErr } = await supabase
          .from("content_outputs")
          .update({ stage_data: { ...current.stage_data, image: { ...current.stage_data.image, status: "generating" } }, status: "generating" })
          .eq("id", outputId);
        if (upErr) throw upErr;
        const { error } = await supabase.functions.invoke("execute-stage", {
          body: { output_id: outputId, stage_id: "image", custom_prompt: piece.imagePrompt || undefined, instructions: instructions || undefined },
        });
        if (error) throw error;
      } else {
        if (!piece.imagePrompt) throw new Error("This piece has no image description to draw from");
        const { error } = await supabase.functions.invoke("generate-image", {
          body: { output_id: outputId, prompt: piece.imagePrompt, instructions: instructions || undefined, organization_id: output?.organization_id },
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success("Drawing a new image");
    },
    onError: (e: Error) => {
      invalidate();
      toast.error(`Couldn't start a new image: ${e.message}`);
    },
  });

  /** OK a stage that's waiting (or that the run stopped after) so the next one runs. */
  const continueRun = useMutation({
    mutationFn: async (stageId: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("approve-stage", {
        body: { output_id: outputId, stage_id: stageId, action: "approve", user_id: user?.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(`Couldn't continue: ${e.message}`),
  });

  /** Run a failed stage again (the whole piece for single-step pipelines). */
  const retry = useMutation({
    mutationFn: async (stageId?: string) => {
      const { error } = await supabase.functions.invoke("regenerate-content", {
        body: { output_id: outputId, stage_id: stageId, organization_id: output?.organization_id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Trying again");
    },
    onError: (e: Error) => {
      invalidate();
      toast.error(`Retry failed: ${e.message}`);
    },
  });

  const setStatus = useMutation({
    mutationFn: async (status: "approved" | "rejected" | "review") => {
      const { error } = await supabase.from("content_outputs").update({ status }).eq("id", outputId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const rewrite = useMutation({
    mutationFn: async ({ text, instruction }: { text: string; instruction: string }): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("rewrite-text", {
        body: { output_id: outputId, text, instruction },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "The rewrite failed");
      return data.text as string;
    },
  });

  return { saveText, replaceImage, newImage, continueRun, retry, setStatus, rewrite };
}
