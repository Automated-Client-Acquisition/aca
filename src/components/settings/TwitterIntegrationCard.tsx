import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Plus,
  CheckCircle2,
  XCircle,
  Trash2,
  RefreshCw,
  ExternalLink,
  Edit,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Shield,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTwitterAccounts, type TwitterAccount } from "@/hooks/useTwitterAccounts";
import { toast } from "sonner";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useQueryClient } from "@tanstack/react-query";

export function TwitterIntegrationCard() {
  const { user, currentOrganization } = useAuth();
  const { data: accounts = [], isLoading } = useTwitterAccounts();
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<TwitterAccount | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showFields, setShowFields] = useState({
    consumerKey: false,
    consumerSecret: false,
    accessToken: false,
    accessTokenSecret: false,
  });

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    consumer_key: "",
    consumer_secret: "",
    access_token: "",
    access_token_secret: "",
  });

  const invalidateAccounts = () => {
    queryClient.invalidateQueries({ queryKey: ["twitter-accounts", currentOrganization?.id] });
  };

  const handleAddAccount = async () => {
    if (!user || !currentOrganization) return;

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-twitter", {
        body: {
          organization_id: currentOrganization.id,
          account_id: selectedAccount?.id,
          name: formData.name,
          consumer_key: formData.consumer_key,
          consumer_secret: formData.consumer_secret,
          access_token: formData.access_token,
          access_token_secret: formData.access_token_secret,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success(
          selectedAccount ? "Twitter account updated" : `Twitter account @${data.twitter_handle} connected`
        );
        setShowAddDialog(false);
        resetForm();
        invalidateAccounts();
      } else {
        toast.error(data.error || "Failed to connect Twitter account");
      }
    } catch (err) {
      console.error("Failed to add Twitter account:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add Twitter account");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestConnection = async (account: TwitterAccount) => {
    setIsTesting(account.id);
    try {
      const { data, error } = await supabase.functions.invoke("validate-twitter", {
        body: {
          account_id: account.id,
          test_only: true,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success("Connection successful!");
      } else {
        toast.error(data.error || "Connection failed");
      }
      invalidateAccounts();
    } catch (err) {
      console.error("Failed to test connection:", err);
      toast.error("Failed to test connection");
    } finally {
      setIsTesting(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedAccount) return;

    try {
      const { error } = await supabase
        .from("twitter_accounts")
        .delete()
        .eq("id", selectedAccount.id);

      if (error) throw error;

      toast.success("Twitter account removed");
      setShowDeleteDialog(false);
      setSelectedAccount(null);
      invalidateAccounts();
    } catch (err) {
      console.error("Failed to delete account:", err);
      toast.error("Failed to remove Twitter account");
    }
  };

  const handleEditAccount = (account: TwitterAccount) => {
    setSelectedAccount(account);
    setFormData({
      name: account.name,
      consumer_key: "",
      consumer_secret: "",
      access_token: "",
      access_token_secret: "",
    });
    setShowAddDialog(true);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      consumer_key: "",
      consumer_secret: "",
      access_token: "",
      access_token_secret: "",
    });
    setSelectedAccount(null);
    setShowFields({
      consumerKey: false,
      consumerSecret: false,
      accessToken: false,
      accessTokenSecret: false,
    });
  };

  const handleCloseDialog = () => {
    setShowAddDialog(false);
    resetForm();
  };

  // Twitter/X icon SVG
  const TwitterIcon = () => (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );

  return (
    <>
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDeleteAccount}
        itemName={selectedAccount?.name || "Twitter account"}
        itemType="Twitter account"
        description="Are you sure you want to remove this Twitter account? You will need to re-add it to publish content."
      />

      <Dialog open={showAddDialog} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedAccount ? "Edit Twitter Account" : "Add Twitter/X Account"}
            </DialogTitle>
            <DialogDescription>
              Enter your Twitter API credentials from{" "}
              <a
                href="https://developer.x.com/en/portal/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-primary"
              >
                developer.x.com
              </a>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tw-name">Account Name</Label>
              <Input
                id="tw-name"
                placeholder="My Twitter Account"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to identify this account
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tw-consumer-key">API Key (Consumer Key)</Label>
              <div className="relative">
                <Input
                  id="tw-consumer-key"
                  type={showFields.consumerKey ? "text" : "password"}
                  placeholder={selectedAccount ? "Leave blank to keep existing" : "Enter API key"}
                  value={formData.consumer_key}
                  onChange={(e) => setFormData({ ...formData, consumer_key: e.target.value })}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowFields({ ...showFields, consumerKey: !showFields.consumerKey })}
                >
                  {showFields.consumerKey ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tw-consumer-secret">API Secret (Consumer Secret)</Label>
              <div className="relative">
                <Input
                  id="tw-consumer-secret"
                  type={showFields.consumerSecret ? "text" : "password"}
                  placeholder={selectedAccount ? "Leave blank to keep existing" : "Enter API secret"}
                  value={formData.consumer_secret}
                  onChange={(e) => setFormData({ ...formData, consumer_secret: e.target.value })}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowFields({ ...showFields, consumerSecret: !showFields.consumerSecret })}
                >
                  {showFields.consumerSecret ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tw-access-token">Access Token</Label>
              <div className="relative">
                <Input
                  id="tw-access-token"
                  type={showFields.accessToken ? "text" : "password"}
                  placeholder={selectedAccount ? "Leave blank to keep existing" : "Enter access token"}
                  value={formData.access_token}
                  onChange={(e) => setFormData({ ...formData, access_token: e.target.value })}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowFields({ ...showFields, accessToken: !showFields.accessToken })}
                >
                  {showFields.accessToken ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tw-access-secret">Access Token Secret</Label>
              <div className="relative">
                <Input
                  id="tw-access-secret"
                  type={showFields.accessTokenSecret ? "text" : "password"}
                  placeholder={selectedAccount ? "Leave blank to keep existing" : "Enter access token secret"}
                  value={formData.access_token_secret}
                  onChange={(e) => setFormData({ ...formData, access_token_secret: e.target.value })}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowFields({ ...showFields, accessTokenSecret: !showFields.accessTokenSecret })}
                >
                  {showFields.accessTokenSecret ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleAddAccount}
              disabled={
                isSubmitting ||
                !formData.name ||
                (!selectedAccount && (!formData.consumer_key || !formData.consumer_secret || !formData.access_token || !formData.access_token_secret))
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {selectedAccount ? "Updating..." : "Connecting..."}
                </>
              ) : selectedAccount ? (
                "Update Account"
              ) : (
                "Connect Account"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <CardTitle className="text-2xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-zinc-800/20 to-zinc-800/5 dark:from-white/20 dark:to-white/5 flex items-center justify-center">
                  <TwitterIcon />
                </div>
                Twitter/X Integration
              </CardTitle>
              <CardDescription className="text-base">
                Connect Twitter/X accounts to publish tweets directly from your content
              </CardDescription>
            </div>
            {accounts.length > 0 && (
              <Badge
                variant="default"
                className={
                  accounts.some((a) => a.is_valid)
                    ? "bg-green-600 text-white"
                    : "bg-muted"
                }
              >
                {accounts.filter((a) => a.is_valid).length} of {accounts.length} Connected
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Setup Guide */}
          <Collapsible open={showHelp} onOpenChange={setShowHelp}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <HelpCircle className="h-4 w-4" />
                  How to Get Twitter API Credentials
                </span>
                {showHelp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Setup Instructions</h4>

                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">1</div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Create a Developer Account</p>
                        <p className="text-xs text-muted-foreground">
                          Go to{" "}
                          <a href="https://developer.x.com" target="_blank" rel="noopener noreferrer" className="underline">
                            developer.x.com
                          </a>{" "}
                          and sign up for a developer account (Free tier works).
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">2</div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Create a Project & App</p>
                        <p className="text-xs text-muted-foreground">
                          In the Developer Portal, create a new Project and App. This gives you your API Key and API Secret.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">3</div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Set App Permissions to Read & Write</p>
                        <p className="text-xs text-muted-foreground">
                          In your App Settings, go to{" "}
                          <span className="font-mono bg-muted px-1 rounded">User authentication settings</span>{" "}
                          and set permissions to <strong>Read and Write</strong>.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">4</div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Generate Access Token & Secret</p>
                        <p className="text-xs text-muted-foreground">
                          Go to{" "}
                          <span className="font-mono bg-muted px-1 rounded">Keys and Tokens</span>{" "}
                          tab and generate an Access Token and Secret. Copy all 4 values.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Security Notes
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />
                      All credentials are encrypted (AES-256-GCM) before storage
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />
                      You can revoke access anytime from the Twitter Developer Portal
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />
                      We only use write permissions to post tweets
                    </li>
                  </ul>
                </div>

                <div className="pt-2 border-t">
                  <a
                    href="https://developer.x.com/en/portal/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Twitter Developer Portal
                  </a>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : accounts.length > 0 ? (
            <div className="space-y-3">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                    account.is_valid
                      ? "bg-card hover:bg-accent/30 border-border"
                      : "bg-destructive/5 border-destructive/30"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        account.is_valid ? "bg-green-500" : "bg-destructive"
                      }`}
                    />
                    {account.profile_image_url && (
                      <img
                        src={account.profile_image_url}
                        alt=""
                        className="w-8 h-8 rounded-full flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{account.name}</div>
                      {account.twitter_handle && (
                        <div className="text-sm text-muted-foreground truncate">
                          @{account.twitter_handle}
                        </div>
                      )}
                      {!account.is_valid && account.error_message && (
                        <div className="text-xs text-destructive mt-1">
                          {account.error_message}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleTestConnection(account)}
                      disabled={isTesting === account.id}
                      title="Test connection"
                    >
                      {isTesting === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    {account.twitter_handle && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(`https://x.com/${account.twitter_handle}`, "_blank")}
                        title="Open profile"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditAccount(account)}
                      title="Edit"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedAccount(account);
                        setShowDeleteDialog(true);
                      }}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowAddDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Another Account
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert>
                <AlertDescription className="text-sm">
                  No Twitter/X accounts configured yet. Click the help section above for setup instructions.
                </AlertDescription>
              </Alert>

              <Button variant="cta" className="w-full" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Twitter/X Account
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
