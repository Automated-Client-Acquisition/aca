import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { nanoid } from "nanoid";

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

type AvatarType = "user" | "organization" | "mailbox";

export function useAvatarUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const uploadAvatar = async (
    file: File,
    type: AvatarType,
    id: string
  ): Promise<string | null> => {
    try {
      setIsUploading(true);
      setProgress({ loaded: 0, total: file.size, percentage: 0 });

      // Validate file type
      const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!validTypes.includes(file.type)) {
        toast.error("Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.");
        return null;
      }

      // Validate file size (2MB max for avatars)
      const maxSize = 2 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error("File too large. Maximum size is 2MB.");
        return null;
      }

      // Generate file path based on type
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `avatar-${nanoid(8)}.${fileExt}`;
      const folder = type === "user" ? "users" : type === "mailbox" ? "mailboxes" : "organizations";
      const filePath = `${folder}/${id}/${fileName}`;

      // Replace the previous avatar for users/orgs (one image per entity).
      // NEVER for mailboxes: that folder is keyed by ORG id and shared by every
      // bulk upload, and each file's URL is baked into live mailbox signatures.
      // Wiping it on 2026-09-18 deleted the image 1,771 signatures pointed at.
      if (type !== "mailbox") {
        const { data: existingFiles } = await supabase.storage
          .from("avatars")
          .list(`${folder}/${id}`);

        if (existingFiles && existingFiles.length > 0) {
          const filesToDelete = existingFiles.map((f) => `${folder}/${id}/${f.name}`);
          await supabase.storage.from("avatars").remove(filesToDelete);
        }
      }

      // Upload new avatar
      const { data, error } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (error) {
        console.error("Upload error:", error);
        toast.error(`Upload failed: ${error.message}`);
        return null;
      }

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);

      setProgress({ loaded: file.size, total: file.size, percentage: 100 });
      toast.success("Image uploaded successfully!");

      return publicUrl;
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
      return null;
    } finally {
      setIsUploading(false);
      setTimeout(() => setProgress(null), 1000);
    }
  };

  const deleteAvatar = async (
    type: AvatarType,
    id: string
  ): Promise<boolean> => {
    try {
      const folder = type === "user" ? "users" : type === "mailbox" ? "mailboxes" : "organizations";

      // List and delete all files in the folder
      const { data: existingFiles } = await supabase.storage
        .from("avatars")
        .list(`${folder}/${id}`);

      if (existingFiles && existingFiles.length > 0) {
        const filesToDelete = existingFiles.map((f) => `${folder}/${id}/${f.name}`);
        const { error } = await supabase.storage.from("avatars").remove(filesToDelete);

        if (error) {
          console.error("Delete error:", error);
          toast.error(`Failed to delete image: ${error.message}`);
          return false;
        }
      }

      toast.success("Image removed successfully");
      return true;
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete image");
      return false;
    }
  };

  return {
    uploadAvatar,
    deleteAvatar,
    isUploading,
    progress,
  };
}
