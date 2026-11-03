import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Globe,
  MessageSquare,
  Youtube,
  MapPin,
  Pin,
} from "lucide-react";

export type PlatformType =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "twitter"
  | "x"
  | "tiktok"
  | "wordpress"
  | "ghl"
  | "google_business"
  | string;

interface PlatformConfig {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  facebook: {
    icon: Facebook,
    label: "Facebook",
    bgColor: "bg-[#1877F2]/10",
    textColor: "text-[#1877F2]",
    borderColor: "border-[#1877F2]/30",
  },
  instagram: {
    icon: Instagram,
    label: "Instagram",
    bgColor: "bg-gradient-to-br from-[#833AB4]/10 via-[#FD1D1D]/10 to-[#F77737]/10",
    textColor: "text-[#E4405F]",
    borderColor: "border-[#E4405F]/30",
  },
  linkedin: {
    icon: Linkedin,
    label: "LinkedIn",
    bgColor: "bg-[#0A66C2]/10",
    textColor: "text-[#0A66C2]",
    borderColor: "border-[#0A66C2]/30",
  },
  twitter: {
    icon: Twitter,
    label: "X",
    bgColor: "bg-black/5 dark:bg-white/10",
    textColor: "text-black dark:text-white",
    borderColor: "border-black/20 dark:border-white/20",
  },
  x: {
    icon: Twitter,
    label: "X",
    bgColor: "bg-black/5 dark:bg-white/10",
    textColor: "text-black dark:text-white",
    borderColor: "border-black/20 dark:border-white/20",
  },
  tiktok: {
    icon: ({ className }: { className?: string }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
      </svg>
    ),
    label: "TikTok",
    bgColor: "bg-black/5 dark:bg-white/10",
    textColor: "text-black dark:text-white",
    borderColor: "border-black/20 dark:border-white/20",
  },
  wordpress: {
    icon: ({ className }: { className?: string }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm-1.895 15.962L6.31 8.836c.466-.025.886-.074.886-.074.418-.05.369-.663-.049-.64 0 0-1.255.099-2.066.099-.146 0-.317-.004-.498-.01A8.463 8.463 0 0112 3.545c2.573 0 4.911 1.144 6.488 2.95-.041-.003-.081-.008-.124-.008-.783 0-1.338.682-1.338 1.415 0 .657.378 1.213.781 1.869.303.527.656 1.202.656 2.177 0 .675-.259 1.457-.604 2.55l-.792 2.646-2.867-8.533c.467-.025.887-.074.887-.074.418-.05.369-.663-.05-.64 0 0-1.254.099-2.065.099-.145 0-.317-.004-.498-.01l.117.046 3.68 10.95z" />
        <path d="M18.969 8.913a8.411 8.411 0 01.559 3.02 8.459 8.459 0 01-4.867 7.64l2.99-8.636c.557-1.393.743-2.507.743-3.499 0-.359-.024-.693-.069-1.006.225.455.421.93.585 1.422l.059 1.059zM12 20.455a8.413 8.413 0 01-2.582-.406l2.743-7.97 2.81 7.697c.019.045.041.086.065.125a8.407 8.407 0 01-3.036.554z" />
      </svg>
    ),
    label: "WordPress",
    bgColor: "bg-[#21759B]/10",
    textColor: "text-[#21759B]",
    borderColor: "border-[#21759B]/30",
  },
  ghl: {
    icon: MessageSquare,
    label: "LeadConnector",
    bgColor: "bg-[#00C853]/10",
    textColor: "text-[#00C853]",
    borderColor: "border-[#00C853]/30",
  },
  google_business: {
    icon: ({ className }: { className?: string }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 11.5A2.5 2.5 0 019.5 9 2.5 2.5 0 0112 6.5 2.5 2.5 0 0114.5 9a2.5 2.5 0 01-2.5 2.5M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7z" />
      </svg>
    ),
    label: "Google Business",
    bgColor: "bg-[#4285F4]/10",
    textColor: "text-[#4285F4]",
    borderColor: "border-[#4285F4]/30",
  },
  // GHL reports Google Business Profile accounts as "google".
  google: {
    icon: MapPin,
    label: "Google Business",
    bgColor: "bg-[#4285F4]/10",
    textColor: "text-[#4285F4]",
    borderColor: "border-[#4285F4]/30",
  },
  youtube: {
    icon: Youtube,
    label: "YouTube",
    bgColor: "bg-[#FF0000]/10",
    textColor: "text-[#CC0000]",
    borderColor: "border-[#FF0000]/30",
  },
  pinterest: {
    icon: Pin,
    label: "Pinterest",
    bgColor: "bg-[#E60023]/10",
    textColor: "text-[#B8001C]",
    borderColor: "border-[#E60023]/30",
  },
};

const DEFAULT_CONFIG: PlatformConfig = {
  icon: Globe,
  label: "Unknown",
  bgColor: "bg-muted",
  textColor: "text-muted-foreground",
  borderColor: "border-border",
};

interface PlatformBadgeProps {
  platform: PlatformType;
  name?: string;
  username?: string;
  avatarUrl?: string;
  showLabel?: boolean;
  showAvatar?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function PlatformBadge({
  platform,
  name,
  username,
  avatarUrl,
  showLabel = true,
  showAvatar = true,
  size = "md",
  className,
}: PlatformBadgeProps) {
  const normalizedPlatform = platform.toLowerCase().replace(/\s+/g, "_");
  const config = PLATFORM_CONFIGS[normalizedPlatform] || DEFAULT_CONFIG;
  const Icon = config.icon;

  const sizeClasses = {
    sm: {
      container: "h-6 px-2 gap-1.5 text-xs",
      icon: "h-3 w-3",
      avatar: "h-4 w-4",
    },
    md: {
      container: "h-8 px-3 gap-2 text-sm",
      icon: "h-4 w-4",
      avatar: "h-5 w-5",
    },
    lg: {
      container: "h-10 px-4 gap-2.5 text-base",
      icon: "h-5 w-5",
      avatar: "h-6 w-6",
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        config.bgColor,
        config.textColor,
        config.borderColor,
        sizes.container,
        className
      )}
    >
      {showAvatar && avatarUrl ? (
        <Avatar className={cn(sizes.avatar, "border border-current/20")}>
          <AvatarImage src={avatarUrl} alt={name || platform} />
          <AvatarFallback className="bg-transparent">
            <Icon className={sizes.icon} />
          </AvatarFallback>
        </Avatar>
      ) : (
        <Icon className={sizes.icon} />
      )}
      {showLabel && (
        <span className="truncate max-w-[150px]">
          {name || username || config.label}
        </span>
      )}
    </div>
  );
}

// Icon-only variant for compact displays
interface PlatformIconProps {
  platform: PlatformType;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function PlatformIcon({ platform, size = "md", className }: PlatformIconProps) {
  const normalizedPlatform = platform.toLowerCase().replace(/\s+/g, "_");
  const config = PLATFORM_CONFIGS[normalizedPlatform] || DEFAULT_CONFIG;
  const Icon = config.icon;

  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full p-1.5",
        config.bgColor,
        config.textColor,
        className
      )}
    >
      <Icon className={sizeClasses[size]} />
    </div>
  );
}

// Get platform config for custom usage
export function getPlatformConfig(platform: PlatformType): PlatformConfig {
  const normalizedPlatform = platform.toLowerCase().replace(/\s+/g, "_");
  return PLATFORM_CONFIGS[normalizedPlatform] || DEFAULT_CONFIG;
}
