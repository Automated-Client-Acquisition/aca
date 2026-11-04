import { useState } from "react";
import { getPlatformConfig } from "@/components/autopilot/PlatformBadge";
import { cn } from "@/lib/utils";
import { normPlatform, ruleFor } from "@/lib/scheduler";

/** A platform's icon in its brand color, no chrome. */
export function PlatformGlyph({ platform, className }: { platform: string; className?: string }) {
  const config = getPlatformConfig(normPlatform(platform) === "twitter" ? "twitter" : normPlatform(platform));
  const Icon = config.icon;
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", config.textColor, className)} aria-label={ruleFor(platform).label} />;
}

/** Overlapping glyphs for a post that goes to several platforms. */
export function PlatformStack({ platforms, max = 4, className }: { platforms: string[]; max?: number; className?: string }) {
  const shown = platforms.slice(0, max);
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        <span
          key={p}
          className={cn("grid h-5 w-5 place-items-center rounded-full border border-background bg-card shadow-sm", i > 0 && "-ml-1.5")}
          title={ruleFor(p).label}
        >
          <PlatformGlyph platform={p} className="h-3 w-3" />
        </span>
      ))}
      {platforms.length > max && <span className="ml-1 text-[10px] font-medium text-muted-foreground">+{platforms.length - max}</span>}
    </span>
  );
}

/** An account's avatar with its platform in the corner. */
export function AccountAvatar({
  name,
  avatarUrl,
  platform,
  size = 36,
  className,
}: {
  name: string;
  avatarUrl?: string;
  platform: string;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      {avatarUrl && !broken ? (
        <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full text-[11px] font-semibold text-white"
          style={{ background: ruleFor(platform).color }}
        >
          {initials || "?"}
        </span>
      )}
      <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-card bg-card">
        <PlatformGlyph platform={platform} className="h-2.5 w-2.5" />
      </span>
    </span>
  );
}
