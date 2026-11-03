import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import type {
  AccountWithLimits,
  UpdateAccountLimitsInput,
} from "@/hooks/useAccountsWithLimits";
import { useUpdateAccountLimits } from "@/hooks/useAccountsWithLimits";

interface AccountLimitsSheetProps {
  account: AccountWithLimits | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSchedule: () => void;
}

interface LimitConfig {
  key: keyof AccountWithLimits["limits"];
  label: string;
  max: number;
  default: number;
}

const LIMIT_CONFIGS: LimitConfig[] = [
  { key: "follows", label: "Max Follows/day", max: 100, default: 40 },
  { key: "messages", label: "Max Messages/day", max: 100, default: 40 },
  { key: "inmails", label: "Max InMail Messages/day", max: 100, default: 40 },
  { key: "connection_requests", label: "Max Connection Requests/day", max: 50, default: 25 },
  { key: "profile_views", label: "Max Profile Views/day", max: 100, default: 40 },
  { key: "post_likes", label: "Max Post Likes/day", max: 100, default: 40 },
];

export function AccountLimitsSheet({
  account,
  open,
  onOpenChange,
  onOpenSchedule,
}: AccountLimitsSheetProps) {
  // Conservative placeholder until the account's real effective limits load
  // (synced from account.limits in the effect below). Mirrors the backend
  // safe-zone defaults so nothing over-states what will actually be sent.
  const [limits, setLimits] = useState<AccountWithLimits["limits"]>({
    connection_requests: 10,
    messages: 15,
    inmails: 10,
    profile_views: 20,
    follows: 20,
    post_likes: 20,
  });

  const updateLimits = useUpdateAccountLimits();

  // Sync limits when account changes
  useEffect(() => {
    if (account) {
      setLimits(account.limits);
    }
  }, [account]);

  const handleLimitChange = (key: keyof AccountWithLimits["limits"], value: number) => {
    setLimits((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    if (!account) return;

    // Only persist channels the user actually changed. The state is seeded
    // from `account.limits` (the effective values shown to the user), so any
    // key still equal to that value was never touched. Saving the full set
    // would write a custom_daily_limit override for every channel, converting
    // "follow org/zone default" into a pinned per-account value and breaking
    // future propagation of org limit changes to this sender.
    const changed: UpdateAccountLimitsInput["limits"] = {};
    (Object.keys(limits) as (keyof AccountWithLimits["limits"])[]).forEach(
      (key) => {
        if (limits[key] !== account.limits[key]) {
          changed[key] = limits[key];
        }
      }
    );

    if (Object.keys(changed).length === 0) {
      onOpenChange(false);
      return;
    }

    await updateLimits.mutateAsync({
      accountId: account.id,
      limits: changed,
    });

    onOpenChange(false);
  };

  const getInitials = (name: string | null) => {
    if (!name) return "??";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (!account) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle>Setup sender limits</SheetTitle>
            <SheetDescription className="sr-only">
              Configure daily action limits for this sender account
            </SheetDescription>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onOpenSchedule();
              }}
            >
              Go to sender schedule
            </Button>
          </div>
        </SheetHeader>

        {/* Account info */}
        <div className="flex items-center gap-3 pb-6 border-b">
          <Avatar className="h-12 w-12">
            <AvatarImage
              src={account.avatar_url || undefined}
              referrerPolicy="no-referrer"
            />
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
              {getInitials(account.display_name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">
              {account.display_name || account.username || "Unknown"}
            </div>
          </div>
        </div>

        {/* Info alert */}
        <Alert className="my-6 border-blue-200 bg-blue-50">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800 text-sm">
            <span className="font-medium">Note:</span> The numbers below may vary based on your account's health and activities on other campaigns. We do this to keep your accounts safe.
          </AlertDescription>
        </Alert>

        {/* Limit sliders */}
        <div className="space-y-6">
          {LIMIT_CONFIGS.map((config) => (
            <div key={config.key} className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{config.label}</label>
              </div>
              <div className="flex items-center gap-4">
                <Slider
                  value={[limits[config.key]]}
                  onValueChange={([value]) => handleLimitChange(config.key, value)}
                  max={config.max}
                  min={1}
                  step={1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={limits[config.key]}
                  onChange={(e) =>
                    handleLimitChange(
                      config.key,
                      Math.min(config.max, Math.max(1, parseInt(e.target.value) || 1))
                    )
                  }
                  className="w-20 text-center"
                  min={1}
                  max={config.max}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Save button */}
        <div className="flex justify-end gap-3 pt-6 mt-6 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSave} disabled={updateLimits.isPending}>
            {updateLimits.isPending ? "Saving..." : "Save limits"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
