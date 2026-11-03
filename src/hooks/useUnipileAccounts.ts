import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface UnipileAccountMetadata {
  initial_sync_completed?: boolean;
  initial_sync_at?: string;
  initial_sync_stats?: {
    conversations: number;
    messages: number;
    contacts: number;
  };
  connection_params?: Record<string, unknown>;
  sources?: unknown[];
}

export type UnipileProvider = 'LINKEDIN' | 'INSTAGRAM' | 'EMAIL' | 'WHATSAPP' | 'TELEGRAM' | 'MESSENGER' | 'GOOGLE' | 'OUTLOOK' | 'MAIL' | 'TWITTER';

export interface UnipileAccount {
  id: string;
  unipile_account_id: string;
  provider: UnipileProvider;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  status: 'active' | 'expired' | 'disconnected' | 'error';
  last_synced_at: string | null;
  error_message: string | null;
  owner_user_id: string | null;
  created_at: string;
  metadata: UnipileAccountMetadata | null;
}

export interface UnipileLimits {
  linkedin: number;
  instagram: number;
  whatsapp: number;
  telegram: number;
  messenger: number;
  email: number;
  twitter: number;
}

/**
 * Check if a LinkedIn Unipile account has Sales Navigator access
 * by inspecting connection_params metadata from Unipile.
 */
export function hasSalesNavigator(account: UnipileAccount): boolean {
  const connectionParams = account.metadata?.connection_params as Record<string, unknown> | undefined;
  const im = connectionParams?.im as Record<string, unknown> | undefined;
  const premiumFeatures = (im?.premiumFeatures || []) as unknown[];
  const premiumId = im?.premiumId;
  return !!(premiumId || premiumFeatures.length > 0);
}

// LinkedIn, Instagram, WhatsApp, Telegram and email connect on Unipile v2 (the org's own v2 key or
// ACA's application). Messenger and X are not on v2, so they need the org's own v1 key.
const UNLIMITED: UnipileLimits = { linkedin: 99, instagram: 99, whatsapp: 99, telegram: 99, messenger: 99, email: 99, twitter: 99 };
const V2_ONLY: UnipileLimits = { ...UNLIMITED, messenger: 0, twitter: 0 };

/** Providers that connect through Unipile v2 hosted auth. */
export const UNIPILE_V2_PROVIDERS: ReadonlySet<string> = new Set(['LINKEDIN', 'WHATSAPP', 'TELEGRAM', 'INSTAGRAM', 'GOOGLE', 'OUTLOOK']);

export function useUnipileAccounts() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['unipile-accounts', user?.id, currentOrganization?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated');

      const orgId = currentOrganization?.id;
      if (!orgId) throw new Error('No organization selected');

      // Fetch connected Unipile accounts
      const { data: accounts, error: accountsError } = await supabase
        .from('unipile_accounts')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (accountsError) throw accountsError;

      // The org's own Unipile keys: 'unipile' (v1, with DSN) and 'unipile_v2'.
      // Client orgs inherit API keys from their parent agency.
      const keyProviders = async (id: string) => {
        const { data } = await supabase
          .from('api_keys')
          .select('provider')
          .eq('organization_id', id)
          .in('provider', ['unipile', 'unipile_v2'])
          .eq('is_valid', true);
        return new Set((data || []).map((k) => k.provider));
      };
      let providers = await keyProviders(orgId);
      if (providers.size === 0) {
        const { data: org } = await supabase
          .from('organizations')
          .select('parent_id')
          .eq('id', orgId)
          .single();
        if (org?.parent_id) providers = await keyProviders(org.parent_id);
      }

      const hasBYOK = providers.has('unipile');
      const hasV2Key = providers.has('unipile_v2');

      const limits: UnipileLimits = hasBYOK ? UNLIMITED : V2_ONLY;

      // Count accounts by provider
      const allAccounts = (accounts || []) as UnipileAccount[];
      const byProvider = (p: UnipileProvider) => allAccounts.filter(a => a.provider === p);

      const linkedinAccounts = byProvider('LINKEDIN');
      const instagramAccounts = byProvider('INSTAGRAM');
      const whatsappAccounts = byProvider('WHATSAPP');
      const telegramAccounts = byProvider('TELEGRAM');
      const messengerAccounts = byProvider('MESSENGER');
      const emailAccounts = byProvider('EMAIL').concat(byProvider('GOOGLE'), byProvider('OUTLOOK'), byProvider('MAIL'));
      const twitterAccounts = byProvider('TWITTER');

      return {
        accounts: allAccounts,
        /** Org has its own Unipile v1 key (needed for Messenger and X). */
        hasBYOK,
        /** Org has its own Unipile v2 key; otherwise v2 accounts go on ACA's application. */
        hasV2Key,
        organizationId: orgId,
        linkedinAccount: linkedinAccounts[0] as UnipileAccount | undefined,
        instagramAccount: instagramAccounts[0] as UnipileAccount | undefined,
        linkedinAccounts,
        instagramAccounts,
        whatsappAccounts,
        telegramAccounts,
        messengerAccounts,
        emailAccounts,
        twitterAccounts,
        limits,
        usage: {
          linkedin: linkedinAccounts.length,
          instagram: instagramAccounts.length,
          whatsapp: whatsappAccounts.length,
          telegram: telegramAccounts.length,
          messenger: messengerAccounts.length,
          email: emailAccounts.length,
          twitter: twitterAccounts.length,
        },
        canConnect: hasBYOK, // a v1 key also unlocks Messenger and X
        canConnectLinkedin: linkedinAccounts.length < limits.linkedin,
        canConnectInstagram: instagramAccounts.length < limits.instagram,
      };
    },
    enabled: !!user && !!currentOrganization?.id,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to trigger history sync for a Unipile account
 */
export function useSyncUnipileHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke('unipile-sync-history', {
        body: {
          account_id: accountId,
          limit: 50,
          messages_per_conversation: 20,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Invalidate accounts query to refresh sync status
      queryClient.invalidateQueries({ queryKey: ['unipile-accounts'] });
    },
  });
}

export interface SyncProgress {
  totalProcessed: number;
  contactsImported: number;
  contactsUpdated: number;
  contactsSkipped: number;
  isComplete: boolean;
}

/**
 * Hook to trigger LinkedIn connections sync for a Unipile account
 * This imports all LinkedIn connections into CRM contacts.
 * Automatically continues syncing in batches until all contacts are processed.
 */
export function useSyncUnipileConnections(onProgress?: (progress: SyncProgress) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (accountId: string) => {
      let cursor: string | null = null;
      const totalStats = {
        contactsImported: 0,
        contactsUpdated: 0,
        contactsSkipped: 0,
        totalProcessed: 0,
      };

      // Keep syncing until there are no more contacts
      while (true) {
        const { data, error } = await supabase.functions.invoke('unipile-sync-connections', {
          body: {
            account_id: accountId,
            limit: 1000, // Unipile API max
            max_total: 5000, // Process up to 5000 per edge function call
            start_cursor: cursor,
          },
        });

        if (error) throw error;

        const stats = data?.stats || {};
        totalStats.contactsImported += stats.contactsImported || 0;
        totalStats.contactsUpdated += stats.contactsUpdated || 0;
        totalStats.contactsSkipped += stats.contactsSkipped || 0;
        totalStats.totalProcessed += stats.totalProcessed || 0;

        // Report progress if callback provided
        if (onProgress) {
          onProgress({
            ...totalStats,
            isComplete: !data?.has_more,
          });
        }

        // Check if there are more contacts to sync
        if (!data?.has_more || !data?.next_cursor) {
          break;
        }

        cursor = data.next_cursor;

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      return {
        success: true,
        stats: totalStats,
      };
    },
    onSuccess: () => {
      // Invalidate accounts query to refresh sync status
      queryClient.invalidateQueries({ queryKey: ['unipile-accounts'] });
      // Invalidate contacts query to show new contacts
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
    },
  });
}

/**
 * Assign or remove an owner user from a Unipile account.
 * When a Unipile account has an owner, new inbound conversations on that
 * account will be auto-assigned to the owner via DB trigger.
 */
export function useUpdateUnipileAccountOwner() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      accountId,
      userId,
    }: {
      accountId: string;
      userId: string | null;
    }) => {
      const { data, error } = await supabase
        .from('unipile_accounts')
        .update({
          owner_user_id: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountId)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as UnipileAccount;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['unipile-accounts', user?.id, currentOrganization?.id] });
      toast.success(vars.userId ? 'Account owner assigned' : 'Account owner removed');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update owner: ${error.message}`);
    },
  });
}

/**
 * Hook to check and sync Unipile account statuses from the API.
 * Call on Senders page mount to refresh disconnected/expired statuses.
 */
export function useCheckUnipileStatus() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('unipile-check-status');
      if (error) throw error;
      return data as { checked: number; updated: number };
    },
    onSuccess: () => {
      // Always refetch after status check so UI reflects current DB state
      queryClient.invalidateQueries({ queryKey: ['unipile-accounts', user?.id, currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts-with-limits'] });
    },
  });
}

/**
 * Syncs the org's Unipile v2 accounts: imports accounts linked on its own v2 application,
 * refreshes statuses, and sets up the webhook that brings replies into the inbox.
 */
export function useSyncUnipileV2Accounts() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('unipile-v2-sync-accounts', {
        body: { organizationId: currentOrganization?.id },
      });
      if (error) throw error;
      return data as {
        imported: number;
        updated: number;
        disconnected: number;
        webhook: 'ok' | 'not_permitted' | 'skipped';
      };
    },
    onSuccess: (data) => {
      if (data?.imported || data?.updated || data?.disconnected) {
        queryClient.invalidateQueries({ queryKey: ['unipile-accounts', user?.id, currentOrganization?.id] });
        queryClient.invalidateQueries({ queryKey: ['accounts-with-limits'] });
      }
    },
  });
}

/**
 * Hook to delete a Unipile account
 */
export function useDeleteUnipileAccount() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke('unipile-delete-account', {
        body: { accountId },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to delete account');
      return data as { success: boolean; unipileDeleted: boolean };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['unipile-accounts', user?.id, currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts-with-limits'] });
      toast.success(data?.unipileDeleted
        ? 'Account removed from Unipile and deleted'
        : 'Account deleted locally (could not reach Unipile)');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete account: ${error.message}`);
    },
  });
}
