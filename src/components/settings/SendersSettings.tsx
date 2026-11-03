import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Plus, Key } from "lucide-react";
import {
  LinkedInIcon,
  WhatsAppIcon,
  TelegramIcon,
  InstagramIcon,
  MessengerIcon,
  TwitterXIcon,
  GmailIcon,
  OutlookIcon,
} from "@/components/marketing/BrandIcons";
import { AccountsTable } from "@/components/accounts/AccountsTable";
import { AccountLimitsSheet } from "@/components/accounts/AccountLimitsSheet";
import { AccountScheduleSheet } from "@/components/accounts/AccountScheduleSheet";
import {
  useAccountsWithLimits,
  type AccountWithLimits,
} from "@/hooks/useAccountsWithLimits";
import {
  useUnipileAccounts,
  useUpdateUnipileAccountOwner,
  useDeleteUnipileAccount,
  useCheckUnipileStatus,
  useSyncUnipileV2Accounts,
  UNIPILE_V2_PROVIDERS,
} from "@/hooks/useUnipileAccounts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { AccountBulkActionsBar } from "@/components/accounts/AccountBulkActionsBar";
import { LinkedInCampaignsShowcase } from "@/components/showcase/LinkedInCampaignsShowcase";

// Provider display config
const PROVIDER_OPTIONS = [
  { value: 'LINKEDIN', label: 'LinkedIn', Icon: LinkedInIcon, color: '#0A66C2' },
  { value: 'WHATSAPP', label: 'WhatsApp', Icon: WhatsAppIcon, color: '#25D366' },
  { value: 'TELEGRAM', label: 'Telegram', Icon: TelegramIcon, color: '#0088cc' },
  { value: 'INSTAGRAM', label: 'Instagram', Icon: InstagramIcon, color: '#E1306C' },
  { value: 'MESSENGER', label: 'Messenger', Icon: MessengerIcon, color: '#0084FF' },
  { value: 'TWITTER', label: 'X (Twitter)', Icon: TwitterXIcon, color: '#000000' },
  { value: 'GOOGLE', label: 'Gmail', Icon: GmailIcon, color: '#EA4335' },
  { value: 'OUTLOOK', label: 'Outlook', Icon: OutlookIcon, color: '#0078D4' },
] as const;

const getProviderLabel = (provider: string) => {
  return PROVIDER_OPTIONS.find(p => p.value === provider)?.label || provider;
};

// LinkedIn & social senders (Unipile accounts). Lives in Settings > Sending;
// /senders redirects here.
export function SendersSettings() {
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseLinkedIn = hasFeature("linkedin_campaigns");
  const { data: accountsData, isLoading, refetch } = useAccountsWithLimits();
  const { data: unipileData, refetch: refetchUnipile } = useUnipileAccounts();
  const updateAccountOwner = useUpdateUnipileAccountOwner();
  const deleteAccount = useDeleteUnipileAccount();
  const checkStatus = useCheckUnipileStatus();
  const syncV2 = useSyncUnipileV2Accounts();
  const { data: orgMembers } = useOrganizationMembers();

  const [selectedAccount, setSelectedAccount] = useState<AccountWithLimits | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [limitsSheetOpen, setLimitsSheetOpen] = useState(false);
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep link from the /get-started wizard: ?connect=linkedin fires the hosted
  // auth popup as soon as the page has an org, so "Connect LinkedIn" on the
  // ready screen really is one click instead of sign-in-then-go-hunting.
  // Sits above the feature-gate early returns so hook order stays stable;
  // handleConnect is a hoisted function declaration, so calling it from here
  // is safe even though it is defined further down.
  const autoConnectFired = useRef(false);
  useEffect(() => {
    const want = searchParams.get("connect");
    if (!want || autoConnectFired.current) return;
    if (!unipileData?.organizationId) return;
    autoConnectFired.current = true;
    searchParams.delete("connect");
    setSearchParams(searchParams, { replace: true });
    handleConnect(want.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams, unipileData?.organizationId]);

  // Handle OAuth callback success/error from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('unipile_connected');
    const provider = params.get('provider');
    const error = params.get('unipile_error');

    // Strip only the callback params so ?tab=senders survives.
    const clearCallbackParams = () => {
      ['unipile_connected', 'provider', 'unipile_error'].forEach((k) => params.delete(k));
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    };

    if (connected === 'true') {
      toast.success(`${getProviderLabel(provider?.toUpperCase() || '')} connected successfully!`);
      refetch();
      refetchUnipile();
      clearCallbackParams();
    } else if (error) {
      toast.error(`Connection failed: ${error}`);
      clearCallbackParams();
    }
  }, [refetch, refetchUnipile]);

  // Listen for postMessage from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // The popup ends on this app's /connect/complete page, so only trust our own origin.
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'UNIPILE_OAUTH_SUCCESS') {
        toast.success(`${getProviderLabel(event.data.provider?.toUpperCase() || '')} connected successfully!`);
        refetch();
        refetchUnipile();
        setIsConnecting(false);
      } else if (event.data?.type === 'UNIPILE_OAUTH_ERROR') {
        toast.error(`Connection failed: ${event.data.error}`);
        setIsConnecting(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refetch, refetchUnipile]);

  // Sync accounts from Unipile on page load (imports missing + updates statuses)
  const statusCheckedRef = useRef(false);
  useEffect(() => {
    if (unipileData?.hasBYOK && !statusCheckedRef.current) {
      statusCheckedRef.current = true;
      checkStatus.mutate();
    }
  }, [unipileData?.hasBYOK]);

  // Same for Unipile v2: imports accounts linked on the org's own v2 application (for example
  // from the Unipile dashboard) and refreshes the status of every v2 account.
  const v2SyncedRef = useRef<string | null>(null);
  useEffect(() => {
    const orgId = unipileData?.organizationId;
    if (!orgId || v2SyncedRef.current === orgId) return;
    v2SyncedRef.current = orgId;
    syncV2.mutate(undefined, {
      onSuccess: (data) => {
        if (data?.imported) {
          toast.success(`Found ${data.imported} connected account${data.imported === 1 ? '' : 's'} in Unipile`);
        }
      },
    });
  }, [unipileData?.organizationId]);

  async function handleConnect(provider: string, reconnectAccountId?: string) {
    if (!unipileData?.organizationId) return;

    setIsConnecting(true);
    try {
      const body: Record<string, string> = {
        organizationId: unipileData.organizationId,
        provider,
      };
      if (reconnectAccountId) {
        // The server reconnects on whichever Unipile stack the account lives on.
        body.reconnectAccountId = reconnectAccountId;
      } else if (UNIPILE_V2_PROVIDERS.has(provider)) {
        // New accounts go on Unipile v2: the org's own v2 key when it saved one, otherwise ACA's
        // application. No DSN needed.
        body.apiVersion = 'v2';
      }

      const { data: connectData, error } = await supabase.functions.invoke('unipile-connect', {
        body,
      });

      if (error) {
        // Try to extract the JSON error message from the response
        const errBody = typeof error === 'object' && 'context' in error
          ? await (error as any).context?.json?.().catch(() => null)
          : null;
        throw new Error(errBody?.error || error.message || 'Connection failed');
      }

      if (!connectData?.success && connectData?.error) {
        throw new Error(connectData.error);
      }

      if (connectData.authUrl) {
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
          connectData.authUrl,
          'unipile-oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
        );

        if (!popup) {
          throw new Error('Popup blocked. Please allow popups and try again.');
        }

        const checkPopup = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopup);
            setIsConnecting(false);
            setTimeout(() => {
              refetch();
              refetchUnipile();
            }, 1000);
          }
        }, 500);
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error) {
      console.error('Failed to initiate Unipile OAuth:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to connect account');
      setIsConnecting(false);
    }
  }

  const handleConfigureLimits = (account: AccountWithLimits) => {
    setSelectedAccount(account);
    setLimitsSheetOpen(true);
  };

  const handleConfigureSchedule = (account: AccountWithLimits) => {
    setSelectedAccount(account);
    setScheduleSheetOpen(true);
  };

  const handleOpenLimitsFromSchedule = () => {
    setScheduleSheetOpen(false);
    setLimitsSheetOpen(true);
  };

  const handleOpenScheduleFromLimits = () => {
    setLimitsSheetOpen(false);
    setScheduleSheetOpen(true);
  };

  // Hide accounts that no longer exist in Unipile. The status sync marks an
  // account 'disconnected' only when its unipile_account_id is absent from
  // Unipile entirely (see _shared/unipile-status-sync.ts) — these are orphaned
  // records that can't send and can't be meaningfully reconnected (reconnect
  // creates a brand-new account). We keep the rows in the DB for referential
  // integrity (they're FK-referenced by conversations, campaign progress, etc.)
  // but they shouldn't clutter the Senders list. 'expired'/'error' accounts
  // still exist in Unipile and are reconnectable, so they stay visible.
  const allAccounts = (accountsData?.accounts || []).filter(
    (a) => a.status !== "disconnected"
  );
  // Messenger and X are not on Unipile v2, so they still need the org's own v1 key.
  const hasV1Key = unipileData?.hasBYOK ?? false;

  const handleReconnect = (account: AccountWithLimits) => {
    handleConnect(account.provider, account.unipile_account_id);
  };

  const handleDeleteAccount = (account: AccountWithLimits) => {
    deleteAccount.mutate(account.id);
  };

  const handleBulkAssignOwner = (userId: string | null) => {
    for (const id of selectedIds) {
      updateAccountOwner.mutate({ accountId: id, userId });
    }
    setSelectedIds(new Set());
  };

  // Feature gating. Sits after every hook so hook order stays stable when
  // feature access resolves.
  if (!canUseLinkedIn && showUpgradePrompts) {
    return <LinkedInCampaignsShowcase />;
  }

  if (!canUseLinkedIn) {
    return (
      <p className="text-muted-foreground text-center py-12">
        This feature is not available for your organization.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">LinkedIn &amp; social accounts</h2>
          <p className="text-muted-foreground">
            Accounts that send your automations: LinkedIn, WhatsApp, Telegram, Instagram and more.
            Each one has its own limits and schedule.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="cta" className="shrink-0" disabled={!unipileData?.organizationId || isConnecting}>
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Connect account
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Select provider</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {PROVIDER_OPTIONS.map((provider) => {
              const needsV1Key = !UNIPILE_V2_PROVIDERS.has(provider.value) && !hasV1Key;
              return (
                <DropdownMenuItem
                  key={provider.value}
                  onClick={() => handleConnect(provider.value)}
                  disabled={needsV1Key}
                  className="gap-3 cursor-pointer"
                >
                  <provider.Icon className="h-4 w-4 shrink-0" style={{ color: provider.color }} />
                  <span>{provider.label}</span>
                  {needsV1Key && (
                    <span className="ml-auto text-xs text-muted-foreground">Needs v1 key</span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* The org's own v2 key can't register the webhook, so replies would never arrive */}
      {syncV2.data?.webhook === 'not_permitted' && unipileData?.hasV2Key && (
        <Alert className="border-amber-300 bg-amber-50">
          <Key className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            Your Unipile v2 key can't set up webhooks, so replies won't reach your inbox. Add a Service
            API key from your Unipile dashboard in{" "}
            <Link to="/settings?tab=integrations" className="font-medium underline hover:no-underline">
              Settings → Integrations
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border bg-card p-6">
        <AccountsTable
          accounts={allAccounts}
          onConfigureLimits={handleConfigureLimits}
          onConfigureSchedule={handleConfigureSchedule}
          onReconnect={handleReconnect}
          onDelete={handleDeleteAccount}
          onOwnerChange={(accountId, userId) =>
            updateAccountOwner.mutate({ accountId, userId })
          }
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          isLoading={isLoading}
        />
      </div>

      {/* Limits Sheet */}
      <AccountLimitsSheet
        account={selectedAccount}
        open={limitsSheetOpen}
        onOpenChange={setLimitsSheetOpen}
        onOpenSchedule={handleOpenScheduleFromLimits}
      />

      {/* Schedule Sheet */}
      <AccountScheduleSheet
        account={selectedAccount}
        open={scheduleSheetOpen}
        onOpenChange={setScheduleSheetOpen}
        onOpenLimits={handleOpenLimitsFromSchedule}
      />

      <AccountBulkActionsBar
        selectedCount={selectedIds.size}
        onClearSelection={() => setSelectedIds(new Set())}
        onBulkAssignOwner={handleBulkAssignOwner}
        members={orgMembers}
      />
    </div>
  );
}
