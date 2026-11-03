import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface AddStorageCredentialsParams {
  provider: string;
  credentials: any;
}

export function useAddStorageCredentials() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ provider, credentials }: AddStorageCredentialsParams) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      // Use currentOrganization from AuthContext - it already respects impersonation
      const orgId = currentOrganization.id;

      // Validate storage credentials
      const { data: validation, error: validationError } = await supabase.functions.invoke(
        'validate-storage',
        {
          body: { provider, credentials },
        }
      );

      if (validationError) throw validationError;

      if (!validation?.valid) {
        throw new Error(validation?.error || 'Invalid storage credentials');
      }

      // Deactivate all existing credentials for this organization
      await supabase
        .from('storage_credentials')
        .update({ is_active: false })
        .eq('organization_id', orgId);

      // Store in database with encrypted credentials (new one is active)
      const { data, error } = await supabase
        .from('storage_credentials')
        .insert({
          provider: provider as any,
          credentials_encrypted: validation.encryptedCredentials,
          bucket_name: credentials.bucketName,
          public_url: credentials.publicUrl || null,
          is_active: true,
          is_valid: true,
          organization_id: orgId,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-credentials'] });
      toast.success('Storage credentials added successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add storage credentials');
    },
  });
}
