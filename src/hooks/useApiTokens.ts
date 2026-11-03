import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ApiToken {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  organization_id: string;
}

export interface IssuedToken {
  id: string;
  name: string;
  token: string; // plaintext, shown ONCE
  token_prefix: string;
  expires_at: string | null;
  organization_id: string;
  created_at: string;
  scopes: string[];
}

export function useApiTokens() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["api-tokens", user?.id],
    queryFn: async (): Promise<ApiToken[]> => {
      const { data, error } = await supabase.functions.invoke("cli-auth-list");
      if (error) throw error;
      const payload = data as { tokens?: ApiToken[]; error?: string };
      if (payload?.error) throw new Error(payload.error);
      return payload?.tokens ?? [];
    },
    enabled: !!user,
  });

  const createToken = useMutation({
    mutationFn: async (input: {
      name: string;
      expires_in_days?: number;
      scopes?: string[];
    }): Promise<IssuedToken> => {
      const { data, error } = await supabase.functions.invoke("cli-auth-issue", {
        body: input,
      });
      if (error) throw error;
      const payload = data as IssuedToken & { error?: string };
      if (payload?.error) throw new Error(payload.error);
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-tokens", user?.id] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to create token: ${err.message}`);
    },
  });

  const revokeToken = useMutation({
    mutationFn: async (tokenId: string): Promise<void> => {
      const { data, error } = await supabase.functions.invoke("cli-auth-revoke", {
        body: { token_id: tokenId },
      });
      if (error) throw error;
      const payload = data as { error?: string };
      if (payload?.error) throw new Error(payload.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-tokens", user?.id] });
      toast.success("Token revoked");
    },
    onError: (err: Error) => {
      toast.error(`Failed to revoke token: ${err.message}`);
    },
  });

  return {
    tokens: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createToken: createToken.mutateAsync,
    revokeToken: revokeToken.mutate,
    isCreating: createToken.isPending,
    isRevoking: revokeToken.isPending,
  };
}
