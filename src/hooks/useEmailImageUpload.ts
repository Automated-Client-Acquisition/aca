import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { nanoid } from "nanoid";

const VALID_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

export function useEmailImageUpload() {
  const [isUploading, setIsUploading] = useState(false);

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      setIsUploading(true);

      if (!VALID_TYPES.includes(file.type)) {
        toast.error("Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.");
        return null;
      }

      if (file.size > MAX_SIZE) {
        toast.error("File too large. Maximum size is 2MB.");
        return null;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to upload images");
        return null;
      }

      const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filePath = `${user.id}/email-editor/${nanoid(8)}.${fileExt}`;

      const { error } = await supabase.storage.from("content-media").upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (error) {
        console.error("Upload error:", error);
        toast.error(`Upload failed: ${error.message}`);
        return null;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("content-media").getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  return { uploadImage, isUploading };
}
