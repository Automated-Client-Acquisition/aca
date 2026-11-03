import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGHLAccounts, type GHLAccount } from "./useGHLAccounts";
import { useTwitterAccounts } from "./useTwitterAccounts";

export interface WordPressSite {
  id: string;
  name: string;
  site_url: string;
  username: string;
  is_active: boolean;
  is_valid: boolean;
  favicon_url?: string;
}

export interface ConnectedAccount {
  id: string;
  type: "social" | "wordpress" | "ghl" | "twitter";
  platform: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  isActive: boolean;
  isValid: boolean;
  metadata?: Record<string, unknown>;
}

export interface ConnectedAccountsResponse {
  accounts: ConnectedAccount[];
  hasGHL: boolean;
  hasWordPress: boolean;
  hasTwitter: boolean;
  needsGHLOAuth: boolean;
  needsGHLReconnect: boolean;
  isLoading: boolean;
}

export function useConnectedAccounts(): ConnectedAccountsResponse {
  const { user, currentOrganization } = useAuth();
  const { data: ghlData, isLoading: ghlLoading } = useGHLAccounts();
  const { data: twitterAccounts, isLoading: twitterLoading } = useTwitterAccounts();

  const { data: wordPressSites, isLoading: wpLoading } = useQuery<WordPressSite[]>({
    queryKey: ["wordpress-sites", currentOrganization?.id],
    queryFn: async () => {
      if (!user || !currentOrganization) return [];

      // Use currentOrganization from AuthContext - it already respects impersonation
      // RLS will also filter by organization, but we explicitly filter for clarity
      const { data, error } = await supabase
        .from("wordpress_sites")
        .select("id, name, site_url, username, is_active, is_valid")
        .eq("organization_id", currentOrganization.id)
        .eq("is_active", true);

      if (error) {
        console.error("Error fetching WordPress sites:", error);
        return [];
      }

      return (data || []).map((site) => ({
        ...site,
        favicon_url: `${site.site_url}/favicon.ico`,
      }));
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 5 * 60 * 1000,
  });

  // Transform GHL accounts to ConnectedAccount format
  // isActive from GHL indicates whether the account is properly connected
  const ghlAccounts: ConnectedAccount[] = (ghlData?.accounts || []).map(
    (acc: GHLAccount) => ({
      id: acc.id,
      type: "social" as const,
      platform: acc.type,
      name: acc.name,
      username: acc.username,
      avatarUrl: acc.profileImage,
      isActive: acc.isActive,
      isValid: acc.isActive, // Use isActive as the validity indicator - disconnected accounts show isActive: false
    })
  );

  // Transform WordPress sites to ConnectedAccount format
  const wpAccounts: ConnectedAccount[] = (wordPressSites || []).map((site) => ({
    id: site.id,
    type: "wordpress" as const,
    platform: "wordpress",
    name: site.name,
    username: site.username,
    avatarUrl: site.favicon_url,
    isActive: site.is_active,
    isValid: site.is_valid,
    metadata: {
      site_url: site.site_url,
    },
  }));

  // Transform Twitter accounts to ConnectedAccount format
  const twAccounts: ConnectedAccount[] = (twitterAccounts || []).map((acc) => ({
    id: acc.id,
    type: "twitter" as const,
    platform: "twitter",
    name: acc.name,
    username: acc.twitter_handle || undefined,
    avatarUrl: acc.profile_image_url || undefined,
    isActive: acc.is_active,
    isValid: acc.is_valid,
  }));

  // Combine all accounts
  const allAccounts = [...ghlAccounts, ...wpAccounts, ...twAccounts];

  return {
    accounts: allAccounts,
    hasGHL: ghlAccounts.length > 0,
    hasWordPress: wpAccounts.length > 0,
    hasTwitter: twAccounts.length > 0,
    needsGHLOAuth: ghlData?.needsOAuth || false,
    needsGHLReconnect: ghlData?.needsReconnect || false,
    isLoading: ghlLoading || wpLoading || twitterLoading,
  };
}

// Helper to get account details by ID
export function useAccountDetails(accountId: string | undefined) {
  const { accounts, isLoading } = useConnectedAccounts();

  const account = accountId
    ? accounts.find((acc) => acc.id === accountId)
    : undefined;

  return {
    account,
    isLoading,
  };
}
