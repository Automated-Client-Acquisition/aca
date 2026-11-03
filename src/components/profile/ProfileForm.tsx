import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, User, Mail, Camera, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";

const profileSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export function ProfileForm() {
  const { user, extendedUser, refreshOrganizationContext } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    extendedUser?.avatar_url || null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadAvatar, deleteAvatar, isUploading } = useAvatarUpload();

  // Parse existing full_name into first/last if needed
  const getDefaultNames = () => {
    const fullName = extendedUser?.full_name || user?.user_metadata?.full_name || "";
    const parts = fullName.split(" ");
    return {
      first_name: (extendedUser as any)?.first_name || parts[0] || "",
      last_name: (extendedUser as any)?.last_name || parts.slice(1).join(" ") || "",
    };
  };

  const defaultNames = getDefaultNames();

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      first_name: defaultNames.first_name,
      last_name: defaultNames.last_name,
      email: extendedUser?.email || user?.email || "",
    },
  });

  const getInitials = () => {
    const firstName = form.watch("first_name");
    const lastName = form.watch("last_name");
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    }
    if (firstName) {
      return firstName.slice(0, 2).toUpperCase();
    }
    return user?.email?.slice(0, 2).toUpperCase() || "??";
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const url = await uploadAvatar(file, "user", user.id);
    if (url) {
      setAvatarUrl(url);
      // Update the database
      const { error } = await supabase.from("users").update({ avatar_url: url }).eq("id", user.id);
      if (!error) {
        // Refresh context to update avatar in header
        await refreshOrganizationContext();
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;

    const success = await deleteAvatar("user", user.id);
    if (success) {
      setAvatarUrl(null);
      await supabase.from("users").update({ avatar_url: null }).eq("id", user.id);
      await refreshOrganizationContext();
    }
  };

  const onSubmit = async (data: ProfileFormData) => {
    if (!user) return;

    setIsUpdating(true);
    try {
      const fullName = `${data.first_name} ${data.last_name}`.trim();

      // Update auth metadata
      const { error: authError } = await supabase.auth.updateUser({
        data: { full_name: fullName },
      });

      if (authError) throw authError;

      // Update users table
      const { error: dbError } = await supabase
        .from("users")
        .update({
          first_name: data.first_name,
          last_name: data.last_name,
          full_name: fullName,
        })
        .eq("id", user.id);

      if (dbError) throw dbError;

      // Handle email change if different
      if (data.email !== user.email) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: data.email,
        });

        if (emailError) {
          toast.error(`Email update failed: ${emailError.message}`);
        } else {
          toast.success(
            "Profile updated. Please check your new email for verification."
          );
        }
      } else {
        toast.success("Profile updated successfully");
      }

      await refreshOrganizationContext();
    } catch (error: any) {
      toast.error(`Failed to update profile: ${error.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Avatar Section */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar className="w-20 h-20">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="text-lg">{getInitials()}</AvatarFallback>
            </Avatar>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              onChange={handleAvatarChange}
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
          </div>
          <div className="flex-1">
            <h3 className="font-medium">Profile Photo</h3>
            <p className="text-sm text-muted-foreground">
              Click the camera icon to update your photo
            </p>
            {avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50 mt-1 h-7 px-2"
                onClick={handleRemoveAvatar}
                disabled={isUploading}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Remove
              </Button>
            )}
          </div>
        </div>

        {/* Name Fields */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="first_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="First name" className="pl-9" {...field} />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="last_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name</FormLabel>
                <FormControl>
                  <Input placeholder="Last name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Email Field */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email Address</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="your@email.com" className="pl-9" {...field} />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button variant="cta" type="submit" disabled={isUpdating || isUploading}>
          {isUpdating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Changes
        </Button>
      </form>
    </Form>
  );
}
