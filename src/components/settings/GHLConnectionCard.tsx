import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Link as LinkIcon, CheckCircle2, XCircle, Save, Calendar, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useGHLAccounts } from "@/hooks/useGHLAccounts";
import { useDisconnectGHL } from "@/hooks/useDisconnectGHL";
import { useUpdateGHLUserId } from "@/hooks/useUpdateGHLUserId";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { GHLConnectionTutorial } from "./GHLConnectionTutorial";

export function GHLConnectionCard() {
  const { user, currentOrganization } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [ghlUserId, setGhlUserId] = useState("");
  const { data: accountsData, isLoading, refetch } = useGHLAccounts();
  const disconnectMutation = useDisconnectGHL();
  const updateUserIdMutation = useUpdateGHLUserId();
  const ghlConnected = !!(accountsData?.success && !accountsData?.needsOAuth && !accountsData?.needsReconnect);
  
  // Sync ghlUserId state with fetched data
  useEffect(() => {
    if (accountsData?.ghlUserId) {
      setGhlUserId(accountsData.ghlUserId);
    }
  }, [accountsData?.ghlUserId]);
  
  // Handle OAuth callback success/error from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('ghl_connected');
    const error = params.get('ghl_error');
    
    if (connected === 'true') {
      toast.success('LeadConnector connected successfully!');
      refetch();
      // Clean up URL params
      window.history.replaceState({}, '', '/settings');
    } else if (error) {
      toast.error(`Connection failed: ${error}`);
      // Clean up URL params
      window.history.replaceState({}, '', '/settings');
    }
  }, [refetch]);

  const handleConnect = async () => {
    if (!user || !currentOrganization) return;

    setIsConnecting(true);
    try {
      // Use currentOrganization from AuthContext - it already respects impersonation
      const orgId = currentOrganization.id;

      // Call ghl-oauth-init to get authorization URL
      const { data, error } = await supabase.functions.invoke('ghl-oauth-init', {
        body: { organizationId: orgId },
      });

      if (error) throw error;

      if (data.authUrl) {
        // Open in popup window
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const popup = window.open(
          data.authUrl,
          'ghl-oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
        );

        if (!popup) {
          throw new Error('Popup blocked. Please allow popups and try again.');
        }

        // Listen for message from popup
        const expectedOrigin = (() => {
          try {
            return new URL(import.meta.env.VITE_SUPABASE_URL as string).origin;
          } catch {
            return null;
          }
        })();

        const handleMessage = (event: MessageEvent) => {
          if (expectedOrigin && event.origin !== expectedOrigin) return;
          if (event.data?.type === 'GHL_OAUTH_SUCCESS') {
            toast.success('LeadConnector connected successfully!');
            refetch();
            popup?.close();
            window.removeEventListener('message', handleMessage);
            setIsConnecting(false);
          } else if (event.data?.type === 'GHL_OAUTH_ERROR') {
            toast.error(`Connection failed: ${event.data.error}`);
            popup?.close();
            window.removeEventListener('message', handleMessage);
            setIsConnecting(false);
          }
        };

        window.addEventListener('message', handleMessage);

        // Cleanup if popup is closed manually
        const checkPopup = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopup);
            window.removeEventListener('message', handleMessage);
            setIsConnecting(false);
          }
        }, 500);
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error) {
      console.error('Failed to initiate GHL OAuth:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to connect to LeadConnector');
      setIsConnecting(false);
    }
  };

  const hasOAuthToken = accountsData?.success && !accountsData?.needsOAuth && !accountsData?.needsReconnect;
  const hasSocialAccounts = accountsData?.accounts && accountsData.accounts.length > 0;
  const needsOAuth = accountsData?.needsOAuth;
  const needsReconnect = accountsData?.needsReconnect;

  const handleDisconnect = () => {
    disconnectMutation.mutate();
    setShowDisconnectDialog(false);
  };

  return (
    <>
      <DeleteConfirmDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
        onConfirm={handleDisconnect}
        itemName="LeadConnector"
        itemType="connection"
        description="Are you sure you want to disconnect your LeadConnector account? You will need to reconnect and re-authorize to publish content."
      />
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle className="text-2xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <LinkIcon className="h-5 w-5 text-primary" />
              </div>
              LeadConnector Integration
            </CardTitle>
            <CardDescription className="text-base flex items-center gap-2">
              <span>Connect your LeadConnector account to publish content directly to social media platforms</span>
              <GHLConnectionTutorial />
            </CardDescription>
          </div>
          {hasOAuthToken && hasSocialAccounts && (
            <Badge variant="default" className="bg-green-600 text-white">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Connected
            </Badge>
          )}
          {hasOAuthToken && !hasSocialAccounts && (
            <Badge variant="default" className="bg-[hsl(var(--status-warning))] text-white">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              OAuth Connected
            </Badge>
          )}
          {(needsOAuth || needsReconnect) && (
            <Badge variant="secondary" className="bg-muted">
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Not Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : hasSocialAccounts ? (
          <div className="space-y-6">
            {accountsData.accounts.filter(a => !a.isActive).length > 0 && (
              <Alert variant="destructive" className="border-destructive/50">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-sm leading-relaxed">
                  <strong className="font-semibold">
                    {accountsData.accounts.filter(a => !a.isActive).length} account
                    {accountsData.accounts.filter(a => !a.isActive).length !== 1 ? 's have' : ' has'} expired or been disconnected.
                  </strong>
                  <br />
                  Go to your GHL Social Planner settings to reconnect these accounts.
                </AlertDescription>
              </Alert>
            )}
            
            <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-sm text-green-900 dark:text-green-100">
                <strong className="font-semibold">
                  {accountsData.accounts.filter(a => a.isActive).length} active social account
                  {accountsData.accounts.filter(a => a.isActive).length !== 1 ? 's' : ''}
                </strong> ready for publishing.
              </AlertDescription>
            </Alert>
            
            {accountsData.locationId && (
              <div className="flex items-center justify-between px-4 py-3 bg-muted/50 rounded-lg">
                <span className="text-sm font-medium text-muted-foreground">Location ID</span>
                <code className="text-sm font-mono bg-background px-2 py-1 rounded">{accountsData.locationId}</code>
              </div>
            )}
            
            {/* GHL User ID Configuration */}
            <div className="space-y-3 p-4 border rounded-lg bg-card">
              <div className="space-y-2">
                <Label htmlFor="ghl-user-id" className="text-sm font-semibold">
                  GHL User ID <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Required for publishing. Find this in GHL: <strong>Settings → My Staff → Profile URL</strong>
                  <br />
                  Example: If your profile URL is <code className="text-xs bg-muted px-1 rounded">app.leadconnectorhq.com/v2/location/.../settings/users/<strong>abc123xyz</strong></code>,
                  your User ID is <code className="text-xs bg-muted px-1 rounded">abc123xyz</code>
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  id="ghl-user-id"
                  type="text"
                  placeholder="Enter your GHL User ID"
                  value={ghlUserId}
                  onChange={(e) => setGhlUserId(e.target.value)}
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  onClick={() => updateUserIdMutation.mutate(ghlUserId)}
                  disabled={!ghlUserId.trim() || updateUserIdMutation.isPending}
                  size="sm"
                  className="shrink-0"
                >
                  {updateUserIdMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>
              </div>
              {!accountsData?.ghlUserId && (
                <Alert variant="destructive" className="mt-2">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Publishing will fail until you configure your User ID
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-semibold">Connected Accounts</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  asChild
                >
                  <a 
                    href={`https://app.leadconnectorhq.com/v2/location/${accountsData.locationId}/marketing/social-planner/settings?tab=all`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Manage in GHL →
                  </a>
                </Button>
              </div>
              <div className="space-y-4">
                {/* Group accounts by platform */}
                {['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok'].map((platform) => {
                  const platformAccounts = accountsData.accounts.filter(a => a.type === platform);
                  if (platformAccounts.length === 0) return null;
                  
                  const platformConfig = {
                    facebook: { name: 'Facebook', color: '#1877f2', bgClass: 'bg-[#1877f2]' },
                    instagram: { name: 'Instagram', color: '#e1306c', bgClass: 'bg-gradient-to-tr from-[#feda75] via-[#fa7e1e] to-[#d62976]' },
                    linkedin: { name: 'LinkedIn', color: '#0077b5', bgClass: 'bg-[#0077b5]' },
                    twitter: { name: 'Twitter / X', color: '#000000', bgClass: 'bg-black' },
                    tiktok: { name: 'TikTok', color: '#000000', bgClass: 'bg-black' },
                  }[platform] || { name: platform, color: '#888888', bgClass: 'bg-muted' };
                  
                  return (
                    <div key={platform} className="space-y-2">
                      {/* Platform Header */}
                      <div className="flex items-center gap-2 px-1">
                        {platform === 'facebook' && (
                          <div className={`w-5 h-5 rounded ${platformConfig.bgClass} flex items-center justify-center`}>
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                            </svg>
                          </div>
                        )}
                        {platform === 'instagram' && (
                          <div className={`w-5 h-5 rounded ${platformConfig.bgClass} flex items-center justify-center`}>
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                            </svg>
                          </div>
                        )}
                        {platform === 'linkedin' && (
                          <div className={`w-5 h-5 rounded ${platformConfig.bgClass} flex items-center justify-center`}>
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                            </svg>
                          </div>
                        )}
                        {platform === 'twitter' && (
                          <div className={`w-5 h-5 rounded ${platformConfig.bgClass} flex items-center justify-center`}>
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                            </svg>
                          </div>
                        )}
                        {platform === 'tiktok' && (
                          <div className={`w-5 h-5 rounded ${platformConfig.bgClass} flex items-center justify-center`}>
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
                            </svg>
                          </div>
                        )}
                        <h5 className="text-sm font-semibold" style={{ color: platformConfig.color }}>
                          {platformConfig.name}
                        </h5>
                        <span className="text-xs text-muted-foreground">
                          ({platformAccounts.length} {platformAccounts.length === 1 ? 'account' : 'accounts'})
                        </span>
                      </div>
                      
                      {/* Platform Accounts */}
                      <div className="space-y-2">
                        {platformAccounts.map((account) => (
                          <div
                            key={account.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                              account.isActive 
                                ? 'bg-card hover:bg-accent/30 border-border' 
                                : 'bg-destructive/5 border-destructive/30'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className={`font-semibold text-base truncate mb-0.5 ${!account.isActive ? 'text-muted-foreground' : ''}`}>
                                {account.name}
                              </div>
                              <div className="flex items-center gap-2">
                                {account.username && (
                                  <span className="text-xs text-muted-foreground truncate">@{account.username}</span>
                                )}
                                <span className="text-xs text-muted-foreground">•</span>
                                <span className="text-xs text-muted-foreground capitalize">{platformConfig.name} Profile</span>
                                {!account.isActive && (
                                  <>
                                    <span className="text-xs text-muted-foreground">•</span>
                                    <Badge variant="destructive" className="text-xs">
                                      Reconnect in GHL
                                    </Badge>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div 
                                className={`w-2 h-2 rounded-full ${
                                  account.isActive ? 'bg-green-500' : 'bg-destructive'
                                }`}
                                title={account.isActive ? 'Connected' : 'Disconnected - Reconnect in GHL'}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* GHL Calendars redirect */}
            <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" />
              <span>
                GHL Calendars have moved to{" "}
                <a
                  href="/settings?tab=calendar"
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  Settings &rarr; Calendar
                </a>
              </span>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={handleConnect}
                disabled={isConnecting || disconnectMutation.isPending}
                className="flex-1"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Reconnecting...
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Reconnect Account
                  </>
                )}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={isConnecting || disconnectMutation.isPending}
                className="flex-1"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </div>
        ) : hasOAuthToken && !hasSocialAccounts ? (
          <div className="space-y-4">
            <Alert className="bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30">
              <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-warning))]" />
              <AlertDescription className="text-sm text-[hsl(var(--status-warning))] leading-relaxed">
                <strong className="font-semibold">OAuth connected successfully</strong>, but no social media accounts are linked in your LeadConnector location.
                <br />
                <br />
                <strong>Next step:</strong> Go to your LeadConnector dashboard and connect social media accounts 
                (Instagram, Facebook, LinkedIn, etc.) to this location, then refresh this page.
              </AlertDescription>
            </Alert>

            {accountsData?.locationId && (
              <div className="flex items-center justify-between px-4 py-3 bg-muted/50 rounded-lg">
                <span className="text-sm font-medium text-muted-foreground">Location ID</span>
                <code className="text-sm font-mono bg-background px-2 py-1 rounded">{accountsData.locationId}</code>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => refetch()}
                disabled={isConnecting || disconnectMutation.isPending}
                className="flex-1"
              >
                Refresh Accounts
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={isConnecting || disconnectMutation.isPending}
                className="flex-1"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert variant={needsReconnect ? "destructive" : "default"} className={needsReconnect ? "border-destructive/50" : ""}>
              <XCircle className="h-4 w-4" />
              <AlertDescription className="text-sm leading-relaxed">
                {needsReconnect
                  ? "Your LeadConnector connection needs to be refreshed. Please reconnect to continue publishing."
                  : "Connect your LeadConnector account to start publishing content to social media platforms."}
              </AlertDescription>
            </Alert>

            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="w-full h-11 text-base font-medium"
              size="lg"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <LinkIcon className="h-5 w-5 mr-2" />
                  Connect LeadConnector
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground px-4">
              You'll be redirected to LeadConnector to authorize this application. Your credentials are never stored.
            </p>

            <Alert className="border-border">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs leading-relaxed">
                <strong>Using a white-label domain?</strong> The authorization popup opens on <code className="text-xs bg-muted px-1 rounded">app.leadconnectorhq.com</code>.
                If you normally log in via a custom domain (e.g. app.youragency.com), you'll need to sign in again on the popup. Use the same email and password as your custom domain.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
}
