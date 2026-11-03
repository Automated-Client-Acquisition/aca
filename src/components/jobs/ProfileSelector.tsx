import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, Loader2 } from "lucide-react";
import { GHLAccount } from "@/hooks/useGHLAccounts";
import { cn } from "@/lib/utils";
import { FaFacebook, FaInstagram, FaLinkedin, FaYoutube, FaTiktok, FaGoogle } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";

interface ProfileSelectorProps {
  accounts: GHLAccount[];
  selectedAccounts: string[];
  onAccountToggle: (accountId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  customizePerChannel: boolean;
  onCustomizeChange: (value: boolean) => void;
  isLoading?: boolean;
  onPlatformClick?: (platformId: string) => void;
  activePlatform?: string | null;
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  facebook: <FaFacebook className="h-5 w-5 text-[#1877F2]" />,
  instagram: <FaInstagram className="h-5 w-5 text-[#E4405F]" />,
  linkedin: <FaLinkedin className="h-5 w-5 text-[#0A66C2]" />,
  youtube: <FaYoutube className="h-5 w-5 text-[#FF0000]" />,
  tiktok: <FaTiktok className="h-5 w-5" />,
  google_business: <FaGoogle className="h-5 w-5 text-[#4285F4]" />,
  gmb: <FaGoogle className="h-5 w-5 text-[#4285F4]" />,
  twitter: <FaXTwitter className="h-5 w-5" />,
  x: <FaXTwitter className="h-5 w-5" />,
};

const PLATFORM_COLORS: Record<string, string> = {
  facebook: "#1877F2",
  instagram: "#E4405F",
  linkedin: "#0A66C2",
  youtube: "#FF0000",
  tiktok: "#000000",
  google_business: "#4285F4",
  gmb: "#4285F4",
  twitter: "#000000",
  x: "#000000",
};

export function ProfileSelector({
  accounts,
  selectedAccounts,
  onAccountToggle,
  onSelectAll,
  onClearAll,
  customizePerChannel,
  onCustomizeChange,
  isLoading = false,
  onPlatformClick,
  activePlatform,
}: ProfileSelectorProps) {
  const [open, setOpen] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);

  // Get unique platforms from accounts
  const availablePlatforms = Array.from(
    new Set(accounts.map((a) => a.type.toLowerCase()))
  );

  // Filter accounts by platform if filter is set
  const filteredAccounts = platformFilter
    ? accounts.filter((a) => a.type.toLowerCase() === platformFilter)
    : accounts;

  // Group accounts by platform
  const groupedAccounts = filteredAccounts.reduce((acc, account) => {
    const platform = account.type.toLowerCase();
    if (!acc[platform]) acc[platform] = [];
    acc[platform].push(account);
    return acc;
  }, {} as Record<string, GHLAccount[]>);

  // Get selected accounts objects
  const selectedAccountObjects = accounts.filter((a) =>
    selectedAccounts.includes(a.id)
  );

  // Get initials from name
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Post to</Label>

      <div className="flex items-center gap-3">
        {/* Avatar stack and dropdown */}
        <div className="flex-1">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between h-auto min-h-[44px] py-2"
              >
                <div className="flex items-center gap-2">
                  {selectedAccountObjects.length > 0 ? (
                    <>
                      {/* Overlapping avatars */}
                      <div className="flex -space-x-2">
                        {selectedAccountObjects.slice(0, 5).map((account, i) => (
                          <Avatar
                            key={account.id}
                            className={cn(
                              "h-8 w-8 border-2 border-background",
                              i > 0 && "-ml-2"
                            )}
                            style={{ zIndex: 5 - i }}
                          >
                            <AvatarImage src={account.profileImage} alt={account.name} />
                            <AvatarFallback
                              className="text-xs"
                              style={{
                                backgroundColor: PLATFORM_COLORS[account.type.toLowerCase()] || "#6366f1",
                                color: "white",
                              }}
                            >
                              {getInitials(account.name)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {selectedAccountObjects.length > 5 && (
                          <div className="h-8 w-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs font-medium -ml-2">
                            +{selectedAccountObjects.length - 5}
                          </div>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {selectedAccountObjects.length} account{selectedAccountObjects.length !== 1 ? "s" : ""} selected
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Select a social account</span>
                  )}
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <ScrollArea className="h-72">
                <div className="p-2">
                  {Object.entries(groupedAccounts).map(([platform, platformAccounts]) => (
                    <div key={platform} className="mb-3">
                      <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-muted-foreground">
                        {PLATFORM_ICONS[platform]}
                        <span className="capitalize">{platform.replace("_", " ")}</span>
                      </div>
                      {platformAccounts.map((account) => (
                        <div
                          key={account.id}
                          className="flex items-center gap-3 px-2 py-2 hover:bg-muted rounded-md cursor-pointer"
                          onClick={() => onAccountToggle(account.id)}
                        >
                          <Checkbox
                            checked={selectedAccounts.includes(account.id)}
                            onClick={(e) => e.stopPropagation()}
                            onCheckedChange={() => onAccountToggle(account.id)}
                          />
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={account.profileImage} alt={account.name} />
                            <AvatarFallback className="text-xs">
                              {getInitials(account.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{account.name}</div>
                            {account.username && (
                              <div className="text-xs text-muted-foreground truncate">
                                @{account.username}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  {accounts.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      No social accounts connected
                    </div>
                  )}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* Clear all link */}
          {selectedAccounts.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Customize toggle */}
        {selectedAccounts.length > 0 && (
          <div className="flex items-center gap-2">
            <Switch
              id="customize-toggle"
              checked={customizePerChannel}
              onCheckedChange={onCustomizeChange}
            />
            <Label
              htmlFor="customize-toggle"
              className="text-sm cursor-pointer whitespace-nowrap"
            >
              Customize for each channel
            </Label>
          </div>
        )}
      </div>

      {/* Platform icons - show only selected platforms, click to edit content */}
      {selectedAccounts.length > 0 && onPlatformClick && (
        <div className="flex items-center gap-2">
          {availablePlatforms
            .filter((platform) =>
              selectedAccounts.some(
                (id) => accounts.find((a) => a.id === id)?.type.toLowerCase() === platform
              )
            )
            .map((platform) => {
              const isActive = customizePerChannel && activePlatform === platform;
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => onPlatformClick(platform)}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    isActive
                      ? "bg-primary/10 ring-2 ring-primary"
                      : "bg-muted hover:bg-muted/80"
                  )}
                  title={`Edit ${platform} content`}
                >
                  {PLATFORM_ICONS[platform]}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
