import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type CrmChannelType,
  type LimitZone,
  type WarmupStatus,
} from "@/hooks/crm/useChannelLimits";
import { Mail, Linkedin, MessageCircle, Instagram, Twitter, Flame, Shield, Zap, AlertTriangle } from "lucide-react";

interface ChannelLimitSliderProps {
  channel: CrmChannelType;
  displayName: string;
  description: string | null;
  icon: string | null;
  currentZone: LimitZone;
  dailyLimit: number;
  todayUsed: number;
  usagePercent: number;
  warmupStatus: WarmupStatus;
  warmupProgress: number;
  safeDailyLimit: number;
  moderateDailyLimit: number;
  fasterDailyLimit: number;
  riskyDailyLimit: number;
  onZoneChange?: (zone: LimitZone) => void;
  onCustomLimitChange?: (limit: number | null) => void;
  absoluteMaxDaily?: number;
  disabled?: boolean;
}

const zoneToValue: Record<LimitZone, number> = {
  safe: 0,
  moderate: 33,
  faster: 66,
  risky: 100,
};

const valueToZone = (value: number): LimitZone => {
  if (value < 17) return "safe";
  if (value < 50) return "moderate";
  if (value < 83) return "faster";
  return "risky";
};

const zoneConfig: Record<LimitZone, { label: string; color: string; bgColor: string; icon: typeof Shield; description: string }> = {
  safe: {
    label: "Safe",
    color: "text-emerald-600",
    bgColor: "bg-emerald-500",
    icon: Shield,
    description: "Conservative limits, lowest risk"
  },
  moderate: {
    label: "Moderate",
    color: "text-blue-600",
    bgColor: "bg-blue-500",
    icon: Zap,
    description: "Balanced speed and safety"
  },
  faster: {
    label: "Faster",
    color: "text-amber-600",
    bgColor: "bg-amber-500",
    icon: Flame,
    description: "Higher volume, moderate risk"
  },
  risky: {
    label: "Risky",
    color: "text-red-600",
    bgColor: "bg-red-500",
    icon: AlertTriangle,
    description: "Maximum speed, highest risk"
  },
};

const getChannelIcon = (icon: string | null, channel: CrmChannelType) => {
  const baseClasses = "flex h-11 w-11 items-center justify-center rounded-xl shadow-sm";

  if (icon === "mail" || channel === "email") {
    return (
      <div className={cn(baseClasses, "bg-gradient-to-br from-blue-500 to-blue-600 text-white")}>
        <Mail className="h-5 w-5" />
      </div>
    );
  }
  if (icon === "linkedin" || channel.startsWith("linkedin")) {
    return (
      <div className={cn(baseClasses, "bg-gradient-to-br from-[#0A66C2] to-[#004182] text-white")}>
        <Linkedin className="h-5 w-5" />
      </div>
    );
  }
  if (icon === "instagram" || channel === "instagram_dm") {
    return (
      <div className={cn(baseClasses, "bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white")}>
        <Instagram className="h-5 w-5" />
      </div>
    );
  }
  if (icon === "twitter" || channel === "twitter_dm") {
    return (
      <div className={cn(baseClasses, "bg-gradient-to-br from-gray-800 to-black text-white")}>
        <Twitter className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div className={cn(baseClasses, "bg-gradient-to-br from-gray-100 to-gray-200 text-gray-600")}>
      <MessageCircle className="h-5 w-5" />
    </div>
  );
};

export function ChannelLimitSlider({
  channel,
  displayName,
  icon,
  currentZone,
  dailyLimit,
  todayUsed,
  warmupStatus,
  warmupProgress,
  safeDailyLimit,
  moderateDailyLimit,
  fasterDailyLimit,
  riskyDailyLimit,
  onZoneChange,
  onCustomLimitChange,
  absoluteMaxDaily = 500,
  disabled = false,
}: ChannelLimitSliderProps) {
  const [localValue, setLocalValue] = useState(zoneToValue[currentZone]);
  const [isEditingLimit, setIsEditingLimit] = useState(false);
  const [editValue, setEditValue] = useState(dailyLimit.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  const currentZoneFromValue = valueToZone(localValue);
  const zoneInfo = zoneConfig[currentZoneFromValue];
  const ZoneIcon = zoneInfo.icon;

  // Calculate the displayed limit based on slider position (interpolated)
  const getInterpolatedLimit = (value: number): number => {
    // Interpolate between zone limits based on slider position
    if (value < 17) {
      // Safe zone (0-16): interpolate from safe to moderate
      const t = value / 17;
      return Math.round(safeDailyLimit + t * (moderateDailyLimit - safeDailyLimit));
    } else if (value < 50) {
      // Moderate zone (17-49): interpolate from moderate to faster
      const t = (value - 17) / 33;
      return Math.round(moderateDailyLimit + t * (fasterDailyLimit - moderateDailyLimit));
    } else if (value < 83) {
      // Faster zone (50-82): interpolate from faster to risky
      const t = (value - 50) / 33;
      return Math.round(fasterDailyLimit + t * (riskyDailyLimit - fasterDailyLimit));
    } else {
      // Risky zone (83-100): interpolate from risky to max
      const t = (value - 83) / 17;
      return Math.round(riskyDailyLimit + t * (absoluteMaxDaily - riskyDailyLimit));
    }
  };

  const displayedLimit = getInterpolatedLimit(localValue);

  useEffect(() => {
    setLocalValue(zoneToValue[currentZone]);
  }, [currentZone]);

  useEffect(() => {
    setEditValue(dailyLimit.toString());
  }, [dailyLimit]);

  useEffect(() => {
    if (isEditingLimit && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingLimit]);

  const handleSaveCustomLimit = () => {
    const newLimit = parseInt(editValue, 10);
    if (!isNaN(newLimit) && newLimit > 0 && newLimit <= absoluteMaxDaily) {
      onCustomLimitChange?.(newLimit);
    }
    setIsEditingLimit(false);
  };

  const handleResetToZone = () => {
    onCustomLimitChange?.(null);
    setIsEditingLimit(false);
  };

  const handleValueChange = (values: number[]) => {
    const value = values[0];
    setLocalValue(value);
  };

  const handleValueCommit = (values: number[]) => {
    const value = values[0];
    const zone = valueToZone(value);
    onZoneChange?.(zone);
  };

  const warmupPercent = warmupStatus === "completed" ? 100 : warmupProgress;
  const usagePercent = displayedLimit > 0 ? Math.min(100, (todayUsed / displayedLimit) * 100) : 0;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card to-card/80 p-5 transition-all duration-200 hover:border-border hover:shadow-lg">
      {/* Subtle gradient overlay based on zone */}
      <div
        className={cn(
          "absolute inset-0 opacity-[0.03] transition-opacity group-hover:opacity-[0.05]",
          currentZoneFromValue === "safe" && "bg-gradient-to-br from-emerald-500 to-transparent",
          currentZoneFromValue === "moderate" && "bg-gradient-to-br from-blue-500 to-transparent",
          currentZoneFromValue === "faster" && "bg-gradient-to-br from-amber-500 to-transparent",
          currentZoneFromValue === "risky" && "bg-gradient-to-br from-red-500 to-transparent",
        )}
      />

      <div className="relative flex items-start gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 pt-0.5">
          {getChannelIcon(icon, channel)}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="font-semibold text-base text-foreground truncate">{displayName}</h4>
              <div className="flex items-center gap-2 mt-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                      zoneInfo.color,
                      "bg-current/10"
                    )}>
                      <ZoneIcon className="h-3.5 w-3.5" />
                      {zoneInfo.label}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{zoneInfo.description}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Daily limit display */}
            <Popover open={isEditingLimit} onOpenChange={setIsEditingLimit}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex flex-col items-end px-4 py-2 rounded-xl transition-all",
                    "bg-muted/50 hover:bg-muted border border-transparent hover:border-border/50",
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                  disabled={disabled}
                >
                  <span className="text-2xl font-bold text-foreground tabular-nums">{displayedLimit}</span>
                  <span className="text-xs text-muted-foreground">per day</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-4" align="end">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-sm mb-1">Custom Daily Limit</h4>
                    <p className="text-xs text-muted-foreground">Set a specific limit for this channel</p>
                  </div>
                  <div className="space-y-2">
                    <Input
                      ref={inputRef}
                      type="number"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveCustomLimit();
                        if (e.key === "Escape") setIsEditingLimit(false);
                      }}
                      min={1}
                      max={absoluteMaxDaily}
                      className="h-10 text-lg font-semibold"
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum allowed: {absoluteMaxDaily}/day
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="cta"
                      size="sm"
                      className="flex-1"
                      onClick={handleSaveCustomLimit}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={handleResetToZone}
                    >
                      Reset to Zone
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Slider section */}
          <div className="space-y-3">
            {/* Custom slider track with zone colors */}
            <div className="relative h-3 rounded-full bg-muted overflow-hidden">
              {/* Zone color segments */}
              <div className="absolute inset-0 flex">
                <div className="w-[17%] bg-emerald-400/80" />
                <div className="w-[33%] bg-blue-400/80" />
                <div className="w-[33%] bg-amber-400/80" />
                <div className="w-[17%] bg-red-400/80" />
              </div>
              {/* Progress overlay */}
              <div
                className="absolute inset-y-0 left-0 bg-foreground/10 backdrop-blur-sm transition-all duration-150"
                style={{ width: `${localValue}%` }}
              />
            </div>

            {/* Actual slider (invisible track, visible thumb) */}
            <Slider
              value={[localValue]}
              onValueChange={handleValueChange}
              onValueCommit={handleValueCommit}
              max={100}
              step={1}
              disabled={disabled}
              className={cn(
                "-mt-6 relative z-10",
                "[&_[role=slider]]:h-5 [&_[role=slider]]:w-5",
                "[&_[role=slider]]:border-2 [&_[role=slider]]:border-white",
                "[&_[role=slider]]:shadow-md [&_[role=slider]]:shadow-black/20",
                "[&_[role=slider]]:bg-foreground",
                "[&_[role=slider]]:transition-transform [&_[role=slider]]:hover:scale-110",
                "[&_[role=slider]]:focus-visible:ring-2 [&_[role=slider]]:focus-visible:ring-ring",
                "[&_.relative]:bg-transparent",
                "[&_[data-disabled]]:opacity-50"
              )}
            />

            {/* Zone labels */}
            <div className="flex justify-between text-[11px] text-muted-foreground px-0.5 -mt-1">
              <span className="text-emerald-600 font-medium">Safe</span>
              <span className="text-blue-600 font-medium">Moderate</span>
              <span className="text-amber-600 font-medium">Faster</span>
              <span className="text-red-600 font-medium">Risky</span>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-6 pt-1">
            {/* Today's usage */}
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted-foreground">Today</div>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      usagePercent < 70 && "bg-emerald-500",
                      usagePercent >= 70 && usagePercent < 90 && "bg-amber-500",
                      usagePercent >= 90 && "bg-red-500"
                    )}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
                <span className="text-xs font-medium tabular-nums">
                  {todayUsed}/{displayedLimit}
                </span>
              </div>
            </div>

            {/* Warmup progress */}
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted-foreground">Warmup</div>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      warmupStatus === "completed" && "bg-emerald-500",
                      warmupStatus === "in_progress" && "bg-blue-500",
                      warmupStatus === "paused" && "bg-amber-500",
                      warmupStatus === "not_started" && "bg-muted-foreground/30"
                    )}
                    style={{ width: `${warmupPercent}%` }}
                  />
                </div>
                <span className={cn(
                  "text-xs font-medium tabular-nums",
                  warmupStatus === "completed" && "text-emerald-600",
                  warmupStatus === "in_progress" && "text-blue-600",
                  warmupStatus === "paused" && "text-amber-600"
                )}>
                  {warmupPercent}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
