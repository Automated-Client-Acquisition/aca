import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { nanoid } from "nanoid";

// ── Types ─────────────────────────────────────────────────────────────────

export interface UploadProgress {
  fileName: string;
  progress: number; // 0-100
  status: "pending" | "uploading" | "complete" | "error";
  url?: string;
  error?: string;
}

export interface SingleFileUploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

const VALID_MEDIA_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/x-m4a',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip',
];

const MAX_SINGLE_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export interface TranscriptionResult {
  wordTimestamps: Array<{ word: string; start: number; end: number }>;
  fullText: string;
}

export interface UploadResult {
  screenVideoUrl: string | null;
  webcamVideoUrl: string | null;
  transcription: TranscriptionResult | null;
}

// ── Constants ─────────────────────────────────────────────────────────────

const VIDEO_RENDERER_WORKER_URL =
  import.meta.env.VITE_VIDEO_RENDERER_WORKER_URL || "";

const RETRY_DELAY_MS = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 1
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return withRetry(fn, retries - 1);
    }
    throw err;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useMediaUpload() {
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<SingleFileUploadProgress | null>(null);
  const [transcriptionProgress, setTranscriptionProgress] = useState<
    "idle" | "transcribing" | "complete" | "error"
  >("idle");

  // -- Upload a single user-selected file (attachments, saved content, etc.) --
  const uploadMedia = useCallback(async (file: File): Promise<string | null> => {
    try {
      setIsUploading(true);
      setProgress({ loaded: 0, total: file.size, percentage: 0 });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to upload files");
        return null;
      }

      if (!VALID_MEDIA_TYPES.includes(file.type)) {
        toast.error("Unsupported file type. Supported: images, videos, audio, PDF, Office docs, CSV, ZIP.");
        return null;
      }

      if (file.size > MAX_SINGLE_FILE_SIZE) {
        toast.error("File too large. Maximum size is 50MB.");
        return null;
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${nanoid()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error } = await supabase.storage
        .from('content-media')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        console.error("Upload error:", error);
        toast.error(`Upload failed: ${error.message}`);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('content-media')
        .getPublicUrl(filePath);

      setProgress({ loaded: file.size, total: file.size, percentage: 100 });
      toast.success("File uploaded successfully!");

      return publicUrl;
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload file");
      return null;
    } finally {
      setIsUploading(false);
      setTimeout(() => setProgress(null), 1000);
    }
  }, []);

  // -- Update a single entry in the uploads array --
  const updateUpload = useCallback(
    (fileName: string, patch: Partial<UploadProgress>) => {
      setUploads((prev) =>
        prev.map((u) => (u.fileName === fileName ? { ...u, ...patch } : u))
      );
    },
    []
  );

  // -- Upload a single blob to Supabase Storage (content-media bucket) --
  const uploadBlob = useCallback(
    async (
      blob: Blob,
      fileName: string,
      userId: string
    ): Promise<string> => {
      const timestamp = Date.now();
      const storagePath = `${userId}/recordings/${timestamp}_${fileName}`;

      // Register in progress state
      setUploads((prev) => [
        ...prev,
        { fileName, progress: 0, status: "pending" },
      ]);

      try {
        updateUpload(fileName, { status: "uploading", progress: 10 });

        const result = await withRetry(async () => {
          const { error } = await supabase.storage
            .from("content-media")
            .upload(storagePath, blob, {
              contentType: blob.type || "video/webm",
              upsert: true,
            });

          if (error) {
            throw new Error(`Storage upload failed: ${error.message}`);
          }

          return supabase.storage
            .from("content-media")
            .getPublicUrl(storagePath);
        });

        const publicUrl = result.data.publicUrl;

        updateUpload(fileName, {
          status: "complete",
          progress: 100,
          url: publicUrl,
        });

        return publicUrl;
      } catch (err: any) {
        const errorMsg = err?.message || "Upload failed";
        updateUpload(fileName, {
          status: "error",
          progress: 0,
          error: errorMsg,
        });
        throw new Error(errorMsg);
      }
    },
    [updateUpload]
  );

  // -- Transcribe a video URL via the video-renderer worker --
  const transcribeVideo = useCallback(
    async (videoUrl: string): Promise<TranscriptionResult> => {
      if (!VIDEO_RENDERER_WORKER_URL) {
        throw new Error("Video renderer worker URL not configured");
      }

      setTranscriptionProgress("transcribing");

      try {
        // The worker /transcribe endpoint returns 202 (fire-and-forget) for pipeline use.
        // For client-side we POST and treat 202 as accepted — results will be written to DB.
        const response = await withRetry(async () => {
          const res = await fetch(`${VIDEO_RENDERER_WORKER_URL}/transcribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_url: videoUrl }),
          });

          if (!res.ok && res.status !== 202) {
            const body = await res.text();
            throw new Error(
              `Transcription request failed (${res.status}): ${body}`
            );
          }

          return res.json();
        });

        // The worker returns 202 with { success, message, output_id } for async processing,
        // or may return results directly. Parse whatever we get.
        const result: TranscriptionResult = {
          wordTimestamps: response.word_timestamps || [],
          fullText: response.transcript || response.text || "",
        };

        setTranscriptionProgress("complete");
        return result;
      } catch (err: any) {
        console.error("[useMediaUpload] Transcription error:", err);
        setTranscriptionProgress("error");
        throw err;
      }
    },
    []
  );

  // -- Upload screen + webcam recordings in parallel --
  const uploadRecordings = useCallback(
    async (params: {
      screenBlob: Blob | null;
      webcamBlob: Blob | null;
      userId: string;
      jobId?: string;
    }): Promise<UploadResult> => {
      const { screenBlob, webcamBlob, userId } = params;

      setIsUploading(true);
      setUploads([]);
      setTranscriptionProgress("idle");

      try {
        const timestamp = Date.now();

        // Upload screen and webcam blobs in parallel
        const [screenVideoUrl, webcamVideoUrl] = await Promise.all([
          screenBlob
            ? uploadBlob(
                screenBlob,
                `screen_${timestamp}.webm`,
                userId
              )
            : Promise.resolve(null),
          webcamBlob
            ? uploadBlob(
                webcamBlob,
                `webcam_${timestamp}.webm`,
                userId
              )
            : Promise.resolve(null),
        ]);

        // Attempt transcription on the screen video (has audio)
        let transcription: TranscriptionResult | null = null;
        if (screenVideoUrl) {
          try {
            transcription = await transcribeVideo(screenVideoUrl);
          } catch {
            // Transcription failure is non-fatal
            console.warn(
              "[useMediaUpload] Transcription failed, continuing without it"
            );
            transcription = null;
          }
        }

        return { screenVideoUrl, webcamVideoUrl, transcription };
      } finally {
        setIsUploading(false);
      }
    },
    [uploadBlob, transcribeVideo]
  );

  return {
    uploadMedia,
    uploadRecordings,
    transcribeVideo,
    uploadBlob,
    uploads,
    isUploading,
    progress,
    transcriptionProgress,
  };
}
