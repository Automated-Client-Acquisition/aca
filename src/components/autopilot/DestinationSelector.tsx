import { useState, useEffect } from "react";
import { X, AlertCircle, Link as LinkIcon, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectedAccounts, type ConnectedAccount } from "@/hooks/useConnectedAccounts";
import { PlatformBadge, getPlatformConfig } from "./PlatformBadge";
import type { PublishDestination } from "@/types/autopilot";

interface DestinationSelectorProps {
  value: PublishDestination[];
  onChange: (value: PublishDestination[]) => void;
}

export function DestinationSelector({ value, onChange }: DestinationSelectorProps) {
  const { accounts, needsGHLOAuth, needsGHLReconnect, isLoading, hasGHL, hasWordPress, hasTwitter } = useConnectedAccounts();
  const [destinations, setDestinations] = useState<PublishDestination[]>(value);

  // Sync with parent
  useEffect(() => {
    setDestinations(value);
  }, [value]);

  // Filter to only show active accounts not already added
  const availableAccounts = accounts.filter(
    (acc) => acc.isActive && !destinations.some((dest) => dest.account_id === acc.id)
  );

  const handleAddDestination = (accountId: string) => {
    const account = accounts.find((acc) => acc.id === accountId);
    if (!account) return;

    const newDest: PublishDestination = {
      account_id: accountId,
      platform: account.platform,
      enabled: true,
    };

    const newDestinations = [...destinations, newDest];
    setDestinations(newDestinations);
    onChange(newDestinations);
  };

  const handleRemoveDestination = (index: number) => {
    const newDestinations = destinations.filter((_, i) => i !== index);
    setDestinations(newDestinations);
    onChange(newDestinations);
  };

  const handleToggleEnabled = (index: number) => {
    const newDestinations = [...destinations];
    newDestinations[index] = {
      ...newDestinations[index],
      enabled: !newDestinations[index].enabled,
    };
    setDestinations(newDestinations);
    onChange(newDestinations);
  };

  const getAccountInfo = (accountId: string): ConnectedAccount | undefined => {
    return accounts.find((acc) => acc.id === accountId);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Label>Publish Destinations</Label>
        <div className="animate-pulse bg-muted h-24 rounded-lg" />
      </div>
    );
  }

  // Show warning only if no accounts at all (need to connect something)
  const noAccountsAvailable = accounts.length === 0 && !needsGHLOAuth;

  if (noAccountsAvailable) {
    return (
      <div className="space-y-4">
        <Label>Publish Destinations</Label>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Accounts Connected</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Connect publishing destinations to enable content distribution.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" asChild>
                <a href="/settings?tab=wordpress">Add WordPress Site</a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="/settings?tab=ghl">
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Connect GHL
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="/settings?tab=integrations">Connect Twitter</a>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Label>Publish Destinations</Label>

      {/* GHL OAuth warning if needed */}
      {(needsGHLOAuth || needsGHLReconnect) && (
        <Alert variant="default" className="border-amber-500/50 bg-amber-500/5">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-700 dark:text-amber-400">GHL Not Connected</AlertTitle>
          <AlertDescription className="text-amber-600 dark:text-amber-300">
            <p className="text-sm">
              {needsGHLOAuth
                ? "Connect GHL to access social media accounts."
                : "Your GHL connection has expired."}
            </p>
            <Button variant="outline" size="sm" className="mt-2" asChild>
              <a href="/settings?tab=ghl">
                <LinkIcon className="h-4 w-4 mr-2" />
                {needsGHLOAuth ? "Connect GHL" : "Reconnect"}
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {destinations.map((dest, index) => {
          const account = getAccountInfo(dest.account_id);
          // Account is disconnected if not found OR if isValid is false (expired/disconnected in GHL)
          const isDisconnected = !account || !account.isValid;

          return (
            <div
              key={dest.account_id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                isDisconnected
                  ? "bg-destructive/5 border-destructive/30"
                  : "bg-muted/50"
              }`}
            >
              <Switch
                checked={dest.enabled && !isDisconnected}
                onCheckedChange={() => handleToggleEnabled(index)}
                disabled={isDisconnected}
              />

              <PlatformBadge
                platform={dest.platform}
                name={account?.name}
                username={account?.username}
                avatarUrl={account?.avatarUrl}
                showAvatar={true}
                showLabel={false}
                size="md"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {account?.name || account?.username || "Unknown"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {getPlatformConfig(dest.platform).label}
                </span>
              </div>

              {isDisconnected && (
                <span className="text-xs text-destructive">Disconnected</span>
              )}

              <div className="flex-1" />

              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveDestination(index)}
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>

      {availableAccounts.length > 0 && (
        <Select onValueChange={handleAddDestination}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Add destination..." />
          </SelectTrigger>
          <SelectContent>
            {availableAccounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id} disabled={!acc.isValid}>
                <div className="flex items-center gap-2 w-full">
                  <PlatformBadge
                    platform={acc.platform}
                    name={acc.name}
                    username={acc.username}
                    avatarUrl={acc.avatarUrl}
                    showAvatar={true}
                    showLabel={false}
                    size="sm"
                  />
                  <span className="text-sm font-medium truncate max-w-[120px]">
                    {acc.name || acc.username}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {getPlatformConfig(acc.platform).label}
                  </span>
                  <div className="flex-1" />
                  {acc.isValid ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      Disconnected
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {destinations.length === 0 && (
        <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
          <p>No destinations added yet.</p>
          <p className="text-sm">Select accounts above to publish content to.</p>
        </div>
      )}

      {destinations.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Content will be published to {destinations.filter((d) => d.enabled).length} of{" "}
          {destinations.length} destinations.
        </p>
      )}
    </div>
  );
}
