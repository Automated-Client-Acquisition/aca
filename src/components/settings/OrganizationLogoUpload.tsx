import { useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, Camera, Trash2, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { getOrgInitials, getOrgColor } from "@/types/organization";
import { useQueryClient } from "@tanstack/react-query";

interface OrganizationLogoUploadProps {
  logoUrl: string | null;
  onLogoChange: (url: string | null) => void;
}

export function OrganizationLogoUpload({
  logoUrl,
  onLogoChange,
}: OrganizationLogoUploadProps) {
  const { currentOrganization, userRole, refreshOrganizationContext } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadAvatar, deleteAvatar, isUploading } = useAvatarUpload();
  const queryClient = useQueryClient();

  const canEdit = userRole === "owner" || userRole === "admin" || userRole === "super_admin";

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentOrganization) return;

    const url = await uploadAvatar(file, "organization", currentOrganization.id);
    if (url) {
      // Update the database
      const { error } = await supabase
        .from("organizations")
        .update({ logo_url: url })
        .eq("id", currentOrganization.id);

      if (error) {
        toast.error("Failed to save logo");
        console.error(error);
        return;
      }

      onLogoChange(url);
      await refreshOrganizationContext();
      // Invalidate and refetch user organizations query to update sidebar immediately
      await queryClient.invalidateQueries({ queryKey: ["user-organizations"] });
      await queryClient.refetchQueries({ queryKey: ["user-organizations"] });
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = async () => {
    if (!currentOrganization) return;

    const success = await deleteAvatar("organization", currentOrganization.id);
    if (success) {
      const { error } = await supabase
        .from("organizations")
        .update({ logo_url: null })
        .eq("id", currentOrganization.id);

      if (error) {
        toast.error("Failed to remove logo");
        console.error(error);
        return;
      }

      onLogoChange(null);
      await refreshOrganizationContext();
      // Invalidate and refetch user organizations query to update sidebar immediately
      await queryClient.invalidateQueries({ queryKey: ["user-organizations"] });
      await queryClient.refetchQueries({ queryKey: ["user-organizations"] });
    }
  };

  if (!currentOrganization) return null;

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar className="w-20 h-20 rounded-lg">
          {logoUrl ? (
            <AvatarImage src={logoUrl} className="object-cover" />
          ) : null}
          <AvatarFallback
            className={`rounded-lg text-white font-bold text-xl ${getOrgColor(currentOrganization.id)}`}
          >
            {getOrgInitials(currentOrganization.name)}
          </AvatarFallback>
        </Avatar>
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleLogoChange}
              disabled={isUploading}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute -bottom-1 -right-1 rounded-full w-8 h-8"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </Button>
          </>
        )}
      </div>
      <div className="flex-1">
        <h3 className="font-medium flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Organization Logo
        </h3>
        <p className="text-sm text-muted-foreground">
          {logoUrl
            ? "Your organization logo is displayed across the platform"
            : "Upload a logo to customize your organization's branding"}
        </p>
        {canEdit && logoUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50 mt-1 h-7 px-2"
            onClick={handleRemoveLogo}
            disabled={isUploading}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Remove
          </Button>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground mt-1">
            Only organization owners and admins can change the logo
          </p>
        )}
      </div>
    </div>
  );
}
